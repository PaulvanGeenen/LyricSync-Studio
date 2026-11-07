/**
 * Decodes an audio Blob or ArrayBuffer to extract normalized waveform amplitude peaks
 */
export async function extractWaveformPeaks(
  audioBlob: Blob,
  numBuckets = 600
): Promise<number[]> {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0);
    // Scale with duration to give ~15-20 peaks per second
    const targetBuckets = Math.max(120, Math.min(3000, Math.round((audioBuffer.duration || 30) * 15)));
    const actualBuckets = numBuckets === 120 ? 120 : targetBuckets;
    const bucketSize = Math.floor(channelData.length / actualBuckets);
    const peaks: number[] = [];

    for (let i = 0; i < actualBuckets; i++) {
      const start = i * bucketSize;
      const end = Math.min(channelData.length, start + bucketSize);
      let max = 0;
      for (let j = start; j < end; j += 4) {
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      peaks.push(max);
    }

    const absoluteMax = Math.max(...peaks, 0.01);
    const normalized = peaks.map((p) => Math.max(0.12, p / absoluteMax));

    await audioContext.close();
    return normalized;
  } catch (err) {
    console.warn('Failed to extract waveform peaks:', err);
    const fallbackCount = numBuckets || 600;
    return Array.from({ length: fallbackCount }, (_, i) => {
      const v = Math.sin(i * 0.15) * 0.4 + Math.cos(i * 0.35) * 0.3 + 0.4;
      return Math.max(0.15, Math.min(0.95, v));
    });
  }
}

/**
 * Estimates syllable count of a lyric line (works well for both English and Dutch)
 */
export function estimateSyllables(text: string): number {
  const clean = text
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .replace(/[^a-zàáâãäåèéêëìíîïòóôõöùúûüýÿij\s]/g, ' ')
    .trim();
  if (!clean) return 4;
  const words = clean.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    const vowelGroups = w.match(/[aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿ]+/g);
    let count = vowelGroups ? vowelGroups.length : 1;
    if (w.endsWith('e') && !w.endsWith('ee') && !w.endsWith('le') && count > 1) {
      count -= 0.4; // silent trailing e in English / soft schwa in Dutch
    }
    total += Math.max(1, Math.round(count));
  }
  return Math.max(2, total);
}

/**
 * Extracts a vocal-focused energy envelope (50 frames/sec = 20ms hop) using:
 * 1. Center-channel (Mid) extraction from stereo to emphasize centered lead vocals over panned instruments.
 * 2. OfflineAudioContext Bandpass filtering (280 Hz - 3500 Hz) to remove kick/bass (<250 Hz) and hi-hats (>4000 Hz).
 * 3. Transient suppression to ignore short percussive snare hits (<80ms) while preserving sustained sung vowels.
 */
export async function computeVocalEnergyEnvelope(
  audioBuffer: AudioBuffer,
  hopSec = 0.02
): Promise<{
  env: Float32Array;
  rawEnv: Float32Array;
  hopSec: number;
  totalDuration: number;
  maxEnergy: number;
  medianEnergy: number;
}> {
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const totalDuration = audioBuffer.duration;

  // Step 1: Build a mono buffer emphasizing the center channel (where vocals sit)
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1,
    length,
    sampleRate
  );
  const centerBuffer = offlineCtx.createBuffer(1, length, sampleRate);
  const centerData = centerBuffer.getChannelData(0);

  if (audioBuffer.numberOfChannels >= 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const mid = 0.5 * (left[i] + right[i]);
      const side = 0.5 * Math.abs(left[i] - right[i]);
      // Attenuate wide-panned stereo instruments to highlight center lead vocal
      centerData[i] = mid - side * 0.25;
    }
  } else {
    centerData.set(audioBuffer.getChannelData(0));
  }

  // Step 2: Filter to human vocal fundamental & formant range (280 Hz - 3500 Hz)
  let filteredData: Float32Array = centerData;
  try {
    const source = offlineCtx.createBufferSource();
    source.buffer = centerBuffer;

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 280;
    highpass.Q.value = 0.707;

    const presence = offlineCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1600;
    presence.Q.value = 1.0;
    presence.gain.value = 4.5;

    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3500;
    lowpass.Q.value = 0.707;

    source.connect(highpass);
    highpass.connect(presence);
    presence.connect(lowpass);
    lowpass.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    filteredData = rendered.getChannelData(0);
  } catch (_) {
    // Fallback to centerData if offline rendering fails
  }

  // Step 3: Compute RMS energy in 20ms frames
  const hopSamples = Math.max(1, Math.floor(sampleRate * hopSec));
  const frameCount = Math.max(1, Math.floor(length / hopSamples));
  const rawEnv = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSamples;
    const end = Math.min(length, start + hopSamples);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i += 2) {
      const v = filteredData[i];
      sumSq += v * v;
      count++;
    }
    rawEnv[f] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  // Step 4: Suppress 1-2 frame percussive drum transients with a 5-frame (100ms) median-like filter,
  // then smooth with a 7-frame (140ms) vocal phrase window
  const despiked = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const neighbors: number[] = [];
    for (let k = -2; k <= 2; k++) {
      const idx = Math.min(frameCount - 1, Math.max(0, f + k));
      neighbors.push(rawEnv[idx]);
    }
    neighbors.sort((a, b) => a - b);
    despiked[f] = neighbors[2]; // median of 5 frames (100ms)
  }

  const env = new Float32Array(frameCount);
  let maxEnergy = 0.001;
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    let count = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < frameCount) {
        sum += despiked[idx];
        count++;
      }
    }
    const val = count > 0 ? sum / count : despiked[f];
    env[f] = val;
    if (val > maxEnergy) maxEnergy = val;
  }

  // Normalize 0..1
  if (maxEnergy > 0) {
    for (let f = 0; f < frameCount; f++) {
      env[f] = env[f] / maxEnergy;
      rawEnv[f] = rawEnv[f] / maxEnergy;
    }
  }

  const sortedVals = Array.from(env).sort((a, b) => a - b);
  const medianEnergy = sortedVals[Math.floor(sortedVals.length * 0.5)] || 0.1;

  return {
    env,
    rawEnv,
    hopSec,
    totalDuration,
    maxEnergy: 1.0,
    medianEnergy,
  };
}

/**
 * Automatically detects the instrumental intro duration (when sustained vocals actually start)
 * directly from the AudioBlob or AudioBuffer, without needing any external API key.
 */
export async function detectVocalStartLocally(audioBlob: Blob): Promise<number> {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();

    const { env, hopSec, totalDuration, medianEnergy } = await computeVocalEnergyEnvelope(audioBuffer, 0.02);
    const maxIntroSearchSec = Math.min(totalDuration * 0.35, 45);
    const maxFrame = Math.min(env.length - 1, Math.floor(maxIntroSearchSec / hopSec));

    // Find sustained vocal phrase activity (at least 0.9s of sustained mid-band energy)
    const activeThreshold = Math.max(0.14, medianEnergy * 0.72);
    const requiredSustainedFrames = Math.floor(0.9 / hopSec); // 45 frames = 0.9s

    let consecutive = 0;
    let candidateStartFrame = 0;

    for (let f = 0; f < maxFrame; f++) {
      if (env[f] >= activeThreshold) {
        if (consecutive === 0) candidateStartFrame = f;
        consecutive++;
        if (consecutive >= requiredSustainedFrames) {
          // Walk slightly back to the exact onset edge of this phrase
          let onsetFrame = candidateStartFrame;
          while (onsetFrame > 0 && env[onsetFrame - 1] > activeThreshold * 0.45 && candidateStartFrame - onsetFrame < 18) {
            onsetFrame--;
          }
          const detectedSec = Math.round(onsetFrame * hopSec * 10) / 10;
          return detectedSec >= 1.2 ? detectedSec : 0;
        }
      } else {
        consecutive = 0;
      }
    }
    return 0;
  } catch (err) {
    console.warn('Local vocal start detection failed:', err);
    return 0;
  }
}

export interface AcousticValley {
  startSec: number;
  endSec: number;
  minTimeSec: number;
  durationSec: number;
  depthScore: number; // Higher means deeper and/or longer vocal pause
}

/**
 * Full Local Acoustic Alignment Engine (100% API-Key Free):
 * Analyzes the actual vocal frequency envelope of the song, detects all breath pauses,
 * phrase valleys, and instrumental breaks, and uses Dynamic Programming to align every
 * lyric line to its true acoustic vocal phrase in the audio!
 *
 * Results in:
 * - Natural, variable block lengths matching both the waveform and line syllable counts
 * - Real gaps between blocks where pauses, breaths, or instrumental breaks occur
 * - Accurate snapping to vocal onsets and phrase endings
 */
export async function alignLyricsToAudioAcoustically(
  audioBlob: Blob,
  rawLyricsText: string,
  pairs: { id: number; original: string; translated: string }[],
  userVocalStartTime = 0
): Promise<{
  cues: { id: number; startTime: number; endTime: number; text: string; originalText?: string }[];
  detectedIntroSilence: number;
  detectedBreaks: { start: number; end: number; duration: number }[];
}> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  const { env, rawEnv, hopSec, totalDuration, medianEnergy } = await computeVocalEnergyEnvelope(audioBuffer, 0.02);
  const frameCount = env.length;
  const numLines = pairs.length;

  if (numLines === 0) {
    return { cues: [], detectedIntroSilence: 0, detectedBreaks: [] };
  }

  // 1. Detect structural stanza breaks (blank lines or [Chorus]/[Verse] headers) from rawLyricsText
  // If rawLyricsText had a blank line or bracket header before line i, stanzaBreakBefore[i] = true
  const stanzaBreakBefore = new Array<boolean>(numLines).fill(false);
  const rawLines = rawLyricsText.split('\n');
  let cleanIdx = 0;
  let sawBreak = false;
  for (const rl of rawLines) {
    const trimmed = rl.trim();
    if (!trimmed || /^\[.*\]$/.test(trimmed)) {
      if (cleanIdx > 0) sawBreak = true;
    } else {
      const stripped = trimmed.replace(/\[.*?\]/g, '').trim();
      if (stripped.length > 0 && cleanIdx < numLines) {
        if (sawBreak) {
          stanzaBreakBefore[cleanIdx] = true;
          sawBreak = false;
        }
        cleanIdx++;
      }
    }
  }

  // 2. Determine Vocal Start (Intro) and Vocal End (Outro)
  const activeThreshold = Math.max(0.13, medianEnergy * 0.68);
  let effectiveStartSec = userVocalStartTime;

  if (effectiveStartSec <= 0.5) {
    const maxIntroFrame = Math.min(frameCount - 1, Math.floor(Math.min(totalDuration * 0.3, 40) / hopSec));
    let consec = 0;
    let candStart = 0;
    for (let f = 0; f < maxIntroFrame; f++) {
      if (env[f] >= activeThreshold) {
        if (consec === 0) candStart = f;
        consec++;
        if (consec >= 40) { // 0.8s sustained vocal
          while (candStart > 0 && env[candStart - 1] > activeThreshold * 0.45) candStart--;
          effectiveStartSec = Math.round(candStart * hopSec * 100) / 100;
          break;
        }
      } else {
        consec = 0;
      }
    }
  }

  // Find where vocals finish near the end of the track (outro detection)
  let effectiveEndSec = Math.max(effectiveStartSec + numLines * 2.0, totalDuration - 1.5);
  const minOutroSearchFrame = Math.floor(Math.max(effectiveStartSec + 10, totalDuration * 0.72) / hopSec);
  for (let f = frameCount - 1; f >= minOutroSearchFrame; f--) {
    if (env[f] >= activeThreshold * 0.85) {
      // Check it's not a single spike
      let activeCount = 0;
      for (let k = Math.max(0, f - 25); k <= f; k++) {
        if (env[k] >= activeThreshold * 0.75) activeCount++;
      }
      if (activeCount >= 15) {
        effectiveEndSec = Math.min(totalDuration - 0.3, (f + 15) * hopSec);
        break;
      }
    }
  }

  // 3. Detect all candidate Valleys (dips in vocal energy, breaths, pauses, and instrumental breaks)
  // between effectiveStartSec and effectiveEndSec
  const startFrame = Math.max(0, Math.floor(effectiveStartSec / hopSec));
  const endFrame = Math.min(frameCount - 1, Math.floor(effectiveEndSec / hopSec));

  // Compute a local prominence / dip curve so even subtle pauses between sung lines are caught
  const valleys: AcousticValley[] = [];
  const valleyThreshold = Math.max(0.08, medianEnergy * 0.78);

  let inValley = false;
  let vStart = startFrame;
  let vMinFrame = startFrame;
  let vMinVal = 1.0;

  for (let f = startFrame + 25; f < endFrame - 25; f++) {
    // Compute local surrounding peak energy (+/- 1.2s)
    let localPeak = 0.15;
    const winStart = Math.max(startFrame, f - 60);
    const winEnd = Math.min(endFrame, f + 60);
    for (let k = winStart; k <= winEnd; k += 3) {
      if (env[k] > localPeak) localPeak = env[k];
    }

    const relEnergy = env[f] / localPeak;
    const isDip = env[f] < valleyThreshold || relEnergy < 0.52;

    if (isDip) {
      if (!inValley) {
        inValley = true;
        vStart = f;
        vMinFrame = f;
        vMinVal = env[f];
      } else if (env[f] < vMinVal) {
        vMinVal = env[f];
        vMinFrame = f;
      }
    } else if (inValley) {
      const vEnd = f - 1;
      const durFrames = vEnd - vStart + 1;
      // Consider any dip of at least 120ms (6 frames)
      if (durFrames >= 6) {
        const startSec = vStart * hopSec;
        const endSec = vEnd * hopSec;
        const durationSec = durFrames * hopSec;
        const depth = Math.max(0.05, 1.0 - vMinVal / Math.max(0.2, localPeak));
        const depthScore = depth * (1 + Math.min(6.0, durationSec * 1.4));
        valleys.push({
          startSec,
          endSec,
          minTimeSec: vMinFrame * hopSec,
          durationSec,
          depthScore,
        });
      }
      inValley = false;
    }
  }

  // Also add fine local minima (for fast consecutive lines where singer barely pauses)
  for (let f = startFrame + 40; f < endFrame - 40; f += 15) {
    const tSec = f * hopSec;
    const alreadyCovered = valleys.some((v) => tSec >= v.startSec - 0.35 && tSec <= v.endSec + 0.35);
    if (!alreadyCovered) {
      // Find lowest point in a 0.5s window
      let minF = f;
      let minV = env[f];
      for (let k = f - 12; k <= f + 12; k++) {
        if (env[k] < minV) {
          minV = env[k];
          minF = k;
        }
      }
      if (env[minF] <= env[minF - 8] && env[minF] <= env[minF + 8]) {
        const depth = Math.max(0.02, 0.65 - env[minF] * 0.5);
        valleys.push({
          startSec: (minF - 3) * hopSec,
          endSec: (minF + 3) * hopSec,
          minTimeSec: minF * hopSec,
          durationSec: 0.12,
          depthScore: depth * 0.45,
        });
      }
    }
  }

  valleys.sort((a, b) => a.minTimeSec - b.minTimeSec);

  // Extract major instrumental breaks (>= 2.2s quiet vocal intervals) for reporting
  const detectedBreaks = valleys
    .filter((v) => v.durationSec >= 2.2 && v.depthScore >= 0.8)
    .map((v) => ({
      start: Math.round(v.startSec * 100) / 100,
      end: Math.round(v.endSec * 100) / 100,
      duration: Math.round(v.durationSec * 100) / 100,
    }));

  // 4. Compute expected relative duration weights for each lyric line based on syllables
  // and stanza breaks
  const syllables = pairs.map((p) => estimateSyllables(p.original || p.translated));
  const totalSyllables = syllables.reduce((acc, s) => acc + s, 0);

  // Estimate total active singing time vs pause time
  const totalSpanSec = Math.max(numLines * 2.2, effectiveEndSec - effectiveStartSec);
  const totalMajorBreakSec = detectedBreaks.reduce((acc, b) => acc + Math.min(12, b.duration), 0);
  const activeSingingBudgetSec = Math.max(numLines * 1.8, totalSpanSec - totalMajorBreakSec - numLines * 0.45);

  const expectedLineDurSec = syllables.map((s) => {
    const raw = (s / Math.max(1, totalSyllables)) * activeSingingBudgetSec;
    return Math.max(1.6, Math.min(7.2, raw));
  });

  // 5. Dynamic Programming Alignment:
  // Choose N-1 optimal split valleys V_{k_1}, V_{k_2}, ..., V_{k_{N-1}} from `valleys`
  // so that each line i (0..N-1) spans between boundary i and boundary i+1.
  // Boundary 0 is fixed at effectiveStartSec, Boundary N is fixed at effectiveEndSec.
  interface BoundaryNode {
    startSec: number; // end of previous phrase (start of pause/valley)
    endSec: number;   // start of next phrase (end of pause/valley)
    midSec: number;
    depthScore: number;
    gapDuration: number;
  }

  const nodes: BoundaryNode[] = [
    {
      startSec: effectiveStartSec,
      endSec: effectiveStartSec,
      midSec: effectiveStartSec,
      depthScore: 2.0,
      gapDuration: 0,
    },
    ...valleys.map((v) => ({
      startSec: v.startSec,
      endSec: v.endSec,
      midSec: v.minTimeSec,
      depthScore: v.depthScore,
      gapDuration: v.durationSec,
    })),
    {
      startSec: effectiveEndSec,
      endSec: effectiveEndSec,
      midSec: effectiveEndSec,
      depthScore: 2.0,
      gapDuration: 0,
    },
  ];

  const M = nodes.length;
  // If for any reason there are fewer candidate nodes than numLines + 1, synthesize fine grid nodes
  if (M < numLines + 2) {
    const step = totalSpanSec / numLines;
    const fallbackCues = pairs.map((p, i) => {
      const st = Math.round((effectiveStartSec + i * step) * 100) / 100;
      const dur = Math.min(step - 0.3, expectedLineDurSec[i]);
      return {
        id: p.id,
        startTime: st,
        endTime: Math.round((st + Math.max(1.5, dur)) * 100) / 100,
        text: p.translated,
        originalText: p.original !== p.translated ? p.original : undefined,
      };
    });
    return { cues: fallbackCues, detectedIntroSilence: effectiveStartSec, detectedBreaks };
  }

  // DP table: dp[i][m] = minimum cost to place boundary `i` (0..numLines) at node `m` (0..M-1)
  // where boundary 0 is at m=0 and boundary numLines is at m=M-1.
  const INF = 1e12;
  const dp: Float64Array[] = Array.from({ length: numLines + 1 }, () => new Float64Array(M).fill(INF));
  const parent: Int32Array[] = Array.from({ length: numLines + 1 }, () => new Int32Array(M).fill(-1));

  dp[0][0] = 0;

  // Cumulative expected progress for rough global anchor guide
  const cumWeight = new Float64Array(numLines + 1);
  for (let i = 0; i < numLines; i++) {
    const pauseExtra = stanzaBreakBefore[i] ? 2.2 : 0.45;
    cumWeight[i + 1] = cumWeight[i] + expectedLineDurSec[i] + pauseExtra;
  }
  const totalWeight = cumWeight[numLines] || 1;

  for (let i = 1; i <= numLines; i++) {
    const lineIdx = i - 1;
    const expDur = expectedLineDurSec[lineIdx];
    const hasStanzaBreakBefore = stanzaBreakBefore[lineIdx];
    const isLastBoundary = i === numLines;
    const expectedGlobalTime = effectiveStartSec + (cumWeight[i] / totalWeight) * totalSpanSec;

    const mStart = isLastBoundary ? M - 1 : i;
    const mEnd = isLastBoundary ? M - 1 : M - (numLines - i) - 1;

    for (let m = mStart; m <= mEnd; m++) {
      const curNode = nodes[m];

      // Global drift penalty (soft anchor so lines stay in their general song region)
      const globalDrift = Math.abs(curNode.midSec - expectedGlobalTime) / Math.max(12, totalSpanSec * 0.14);
      const driftCost = globalDrift * globalDrift * 1.1;

      // Reward choosing strong acoustic valleys as boundaries
      const valleyReward = Math.min(3.5, curNode.depthScore * 0.9);

      for (let prevM = i - 1; prevM < m; prevM++) {
        const prevCost = dp[i - 1][prevM];
        if (prevCost >= INF) continue;

        const prevNode = nodes[prevM];
        // The singing phrase for lineIdx starts after prevNode.endSec (or midSec) and ends at curNode.startSec (or midSec)
        const phraseStart = hasStanzaBreakBefore
          ? Math.max(prevNode.midSec, prevNode.endSec)
          : prevNode.midSec + Math.min(0.35, prevNode.gapDuration * 0.35);
        const phraseEnd = curNode.midSec - Math.min(0.25, curNode.gapDuration * 0.25);
        const spanDur = phraseEnd - phraseStart;

        if (spanDur < 1.15) continue; // A sung line cannot be shorter than 1.15s
        if (spanDur > 18.0 && !hasStanzaBreakBefore) continue;

        // Compute actual vocal energy inside [phraseStart, phraseEnd]
        const f1 = Math.max(0, Math.floor(phraseStart / hopSec));
        const f2 = Math.min(frameCount - 1, Math.floor(phraseEnd / hopSec));
        let activeFrames = 0;
        let energySum = 0;
        const totalFrames = Math.max(1, f2 - f1 + 1);
        for (let f = f1; f <= f2; f += 2) {
          energySum += env[f];
          if (env[f] >= activeThreshold * 0.8) activeFrames += 2;
        }
        const activeDurSec = Math.min(spanDur, activeFrames * hopSec);
        const meanEnergy = energySum / Math.ceil(totalFrames / 2);

        // Duration match cost: active vocal duration should roughly match expected syllable duration
        const durDiff = activeDurSec - expDur;
        const durCost = (durDiff * durDiff) / (expDur * 1.4);

        // Penalty if the chosen span is mostly dead silence (no singing during this line!)
        const silencePenalty = meanEnergy < activeThreshold * 0.65 ? 4.5 : 0;

        // Bonus if there is a stanza break before this line and prevNode was a wide instrumental gap!
        const stanzaBonus =
          hasStanzaBreakBefore && prevNode.gapDuration >= 1.2
            ? -Math.min(2.8, prevNode.gapDuration * 0.7)
            : 0;

        const stepCost = durCost + driftCost + silencePenalty - valleyReward + stanzaBonus;
        const totalCost = prevCost + stepCost;

        if (totalCost < dp[i][m]) {
          dp[i][m] = totalCost;
          parent[i][m] = prevM;
        }
      }
    }
  }

  // Backtrack to recover the optimal boundary nodes
  const chosenNodeIndices = new Array<number>(numLines + 1);
  chosenNodeIndices[numLines] = M - 1;

  // If DP couldn't reach M-1 due to strict constraints, find best reachable final node
  if (dp[numLines][M - 1] >= INF) {
    let bestM = M - 1;
    let bestVal = INF;
    for (let m = numLines; m < M; m++) {
      if (dp[numLines][m] < bestVal) {
        bestVal = dp[numLines][m];
        bestM = m;
      }
    }
    chosenNodeIndices[numLines] = bestM;
  }

  for (let i = numLines; i >= 1; i--) {
    const p = parent[i][chosenNodeIndices[i]];
    chosenNodeIndices[i - 1] = p >= 0 ? p : Math.max(0, i - 1);
  }

  // 6. Refine exact startTime (vocal onset) and endTime (vocal phrase end) for every single line
  // within its assigned acoustic window [node[i], node[i+1]]
  const resultCues: { id: number; startTime: number; endTime: number; text: string; originalText?: string }[] = [];
  let runningEnd = effectiveStartSec;

  for (let i = 0; i < numLines; i++) {
    const pair = pairs[i];
    const leftNode = nodes[chosenNodeIndices[i]];
    const rightNode = nodes[chosenNodeIndices[i + 1]];
    const expDur = expectedLineDurSec[i];

    // Window where this line's vocal phrase lives
    // If leftNode is a wide valley/break, the new line starts near leftNode.endSec (after the pause!)
    const windowStartSec = Math.max(
      runningEnd + (i === 0 ? 0 : 0.15),
      leftNode.gapDuration >= 0.8 ? leftNode.endSec - 0.15 : leftNode.midSec
    );
    const windowEndSec = Math.max(
      windowStartSec + 1.4,
      rightNode.gapDuration >= 0.8 ? rightNode.startSec + 0.15 : rightNode.midSec
    );

    const wStartFrame = Math.max(0, Math.floor(windowStartSec / hopSec));
    const wEndFrame = Math.min(frameCount - 1, Math.floor(windowEndSec / hopSec));

    // Find exact vocal onset (where vocal energy rises above local floor at the start of the phrase)
    let localMax = 0.05;
    let localMin = 1.0;
    for (let f = wStartFrame; f <= wEndFrame; f++) {
      if (env[f] > localMax) localMax = env[f];
      if (env[f] < localMin) localMin = env[f];
    }

    const onsetThreshold = Math.max(activeThreshold * 0.72, localMin + (localMax - localMin) * 0.28);
    let onsetFrame = wStartFrame;
    // Search in first 60% of window for the first strong vocal attack
    const maxOnsetSearch = Math.min(wEndFrame - 20, wStartFrame + Math.floor((wEndFrame - wStartFrame) * 0.65));
    for (let f = wStartFrame; f <= maxOnsetSearch; f++) {
      const slope = f >= 2 ? rawEnv[f] - rawEnv[f - 2] : 0;
      if (env[f] >= onsetThreshold || (rawEnv[f] >= onsetThreshold && slope > 0.03)) {
        // Step back slightly (60ms) to catch initial consonant
        onsetFrame = Math.max(wStartFrame, f - 3);
        break;
      }
    }

    let cueStart = Math.round(onsetFrame * hopSec * 100) / 100;
    if (cueStart < runningEnd + (i === 0 ? 0 : 0.12)) {
      cueStart = Math.round((runningEnd + (i === 0 ? 0 : 0.12)) * 100) / 100;
    }

    // Find exact vocal offset (where singing ends before the next breath/pause)
    const minPhraseFrames = Math.floor(Math.max(1.3, Math.min(2.4, expDur * 0.55)) / hopSec);
    const maxPhraseFrames = Math.floor(Math.min(7.8, Math.max(expDur * 1.55, 3.2)) / hopSec);
    const offsetSearchStart = Math.min(wEndFrame, onsetFrame + minPhraseFrames);
    const offsetSearchEnd = Math.min(wEndFrame, onsetFrame + maxPhraseFrames);

    const sustainThreshold = Math.max(activeThreshold * 0.62, localMin + (localMax - localMin) * 0.22);
    let lastVocalFrame = offsetSearchStart;
    let quietStreak = 0;

    for (let f = offsetSearchStart; f <= offsetSearchEnd; f++) {
      if (env[f] >= sustainThreshold) {
        lastVocalFrame = f;
        quietStreak = 0;
      } else {
        quietStreak++;
        // If vocal energy drops into a quiet valley for >= 280ms (14 frames), the sung line has ended!
        if (quietStreak >= 14) {
          break;
        }
      }
    }

    // Add 0.28s natural reading & vowel decay tail, clamped to windowEndSec
    let cueEnd = Math.min(windowEndSec, lastVocalFrame * hopSec + 0.28);
    if (cueEnd - cueStart < 1.35) {
      cueEnd = Math.min(totalDuration, Math.min(windowEndSec + 0.2, cueStart + Math.max(1.5, expDur * 0.75)));
    }
    cueEnd = Math.round(cueEnd * 100) / 100;

    resultCues.push({
      id: pair.id,
      startTime: cueStart,
      endTime: cueEnd,
      text: pair.translated,
      originalText: pair.original !== pair.translated ? pair.original : undefined,
    });

    runningEnd = cueEnd;
  }

  return {
    cues: resultCues,
    detectedIntroSilence: effectiveStartSec,
    detectedBreaks,
  };
}

/**
 * Synchronous, high-resolution (10ms = 100Hz) Vocal + Visual Envelope & Local Prominence builder.
 * Combines:
 * 1. Center-channel lead vocal extraction (mid - 0.22 * side) + 280Hz–3400Hz vocal bandpass filter
 * 2. True visual peak amplitude (matching what the waveform canvas renders)
 * 3. Local contrast normalization (`prominence` in 0..1) so breath valleys between phrases are
 *    detected with sub-10ms precision even when backing instruments are playing.
 */
function buildPrecisionEnvelope10ms(audioBuffer: AudioBuffer): {
  env: Float32Array;
  prominence: Float32Array;
  frameCount: number;
  hopSec: number;
  totalDuration: number;
  maxEnergy: number;
} {
  const sampleRate = audioBuffer.sampleRate;
  const totalDuration = audioBuffer.duration;
  const length = audioBuffer.length;
  const hopSec = 0.01; // 10ms frames
  const hopSize = Math.max(1, Math.floor(sampleRate * hopSec));
  const frameCount = Math.max(1, Math.floor(length / hopSize));

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels >= 2 ? audioBuffer.getChannelData(1) : null;

  // Fast 1st-order vocal bandpass coefficients (280 Hz highpass + 3400 Hz lowpass)
  const dt = 1 / sampleRate;
  const rcHigh = 1 / (2 * Math.PI * 280);
  const alphaHigh = rcHigh / (rcHigh + dt);
  const rcLow = 1 / (2 * Math.PI * 3400);
  const alphaLow = dt / (rcLow + dt);

  const vocalRms = new Float32Array(frameCount);
  const visualPeak = new Float32Array(frameCount);

  let prevX = 0;
  let prevHp = 0;
  let prevLp = 0;
  let maxVocal = 0.001;
  let maxVisual = 0.001;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    const end = Math.min(length, start + hopSize);
    let sumSq = 0;
    let count = 0;
    let peak = 0;

    for (let i = start; i < end; i += 2) {
      const l = left[i];
      const rawAbs = Math.abs(l);
      if (rawAbs > peak) peak = rawAbs;

      const x = right ? 0.5 * (l + right[i]) - 0.22 * Math.abs(l - right[i]) : l;
      const hp = alphaHigh * (prevHp + x - prevX);
      prevX = x;
      prevHp = hp;
      const lp = prevLp + alphaLow * (hp - prevLp);
      prevLp = lp;

      sumSq += lp * lp;
      count++;
    }

    const vRms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    vocalRms[f] = vRms;
    visualPeak[f] = peak;
    if (vRms > maxVocal) maxVocal = vRms;
    if (peak > maxVisual) maxVisual = peak;
  }

  // Combine normalized vocal-band RMS (65%) + visual canvas peak (35%)
  const combined = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    combined[f] = 0.65 * (vocalRms[f] / maxVocal) + 0.35 * (visualPeak[f] / maxVisual);
  }

  // 5-frame (50ms) median despike + 5-frame moving average smoothing
  const despiked = new Float32Array(frameCount);
  const tmp5 = [0, 0, 0, 0, 0];
  for (let f = 0; f < frameCount; f++) {
    for (let k = -2; k <= 2; k++) {
      const idx = Math.max(0, Math.min(frameCount - 1, f + k));
      tmp5[k + 2] = combined[idx];
    }
    tmp5.sort((a, b) => a - b);
    despiked[f] = tmp5[2];
  }

  const env = new Float32Array(frameCount);
  let maxEnergy = 0.001;
  for (let f = 0; f < frameCount; f++) {
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < frameCount) {
        s += despiked[idx];
        c++;
      }
    }
    const val = c > 0 ? s / c : despiked[f];
    env[f] = val;
    if (val > maxEnergy) maxEnergy = val;
  }

  // Compute local contrast prominence (0..1) over a +-1.6s window
  // so valleys between vocal phrases drop cleanly toward 0 even with background instruments
  const prominence = new Float32Array(frameCount);
  const winRadius = 160; // 1.6s
  const step = 8; // Compute percentiles every 80ms and interpolate
  const sampleBuf: number[] = [];

  let prevFloor = 0.02;
  let prevCeil = 0.5;

  for (let f = 0; f < frameCount; f++) {
    if (f % step === 0) {
      sampleBuf.length = 0;
      const wStart = Math.max(0, f - winRadius);
      const wEnd = Math.min(frameCount - 1, f + winRadius);
      for (let j = wStart; j <= wEnd; j += 4) {
        sampleBuf.push(env[j]);
      }
      sampleBuf.sort((a, b) => a - b);
      prevFloor = sampleBuf[Math.floor(sampleBuf.length * 0.14)] || 0.02;
      prevCeil = Math.max(prevFloor + 0.06, sampleBuf[Math.floor(sampleBuf.length * 0.88)] || 0.3);
    }

    if (env[f] < maxEnergy * 0.07) {
      prominence[f] = 0;
    } else {
      const norm = (env[f] - prevFloor) / Math.max(0.05, prevCeil - prevFloor);
      prominence[f] = Math.max(0, Math.min(1, norm));
    }
  }

  return { env, prominence, frameCount, hopSec, totalDuration, maxEnergy };
}

/**
 * Extracts measured acoustic vocal phrase islands and instrumental breaks from an AudioBlob.
 * Used to give the server / Gemini exact millisecond waveform landmarks before alignment.
 */
export async function extractAcousticPhraseMap(
  audioBlob: Blob,
  userVocalStartTime = 0
): Promise<{
  detectedIntroSilence: number;
  detectedBreaks: { start: number; end: number; duration: number }[];
  phrases: { start: number; end: number; duration: number }[];
}> {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();

    const { env, prominence, frameCount, hopSec, totalDuration, maxEnergy } =
      buildPrecisionEnvelope10ms(audioBuffer);

    // 1. Detect vocal intro if not manually specified
    let effectiveIntro = userVocalStartTime;
    if (effectiveIntro <= 0.5) {
      const maxIntroFrame = Math.min(frameCount - 1, Math.floor(Math.min(totalDuration * 0.35, 45) / hopSec));
      let activeRun = 0;
      let startCandidate = 0;
      for (let f = 0; f < maxIntroFrame; f++) {
        if (prominence[f] >= 0.38 && env[f] >= maxEnergy * 0.16) {
          if (activeRun === 0) startCandidate = f;
          activeRun++;
          if (activeRun >= 85) {
            // 0.85s of sustained vocal presence
            let onset = startCandidate;
            while (onset > 0 && prominence[onset - 1] > 0.16 && startCandidate - onset < 35) {
              onset--;
            }
            effectiveIntro = Math.round(onset * hopSec * 10) / 10;
            break;
          }
        } else {
          activeRun = 0;
        }
      }
    }

    // 2. Segment into discrete vocal phrase mountains after effectiveIntro
    const startScanFrame = Math.max(0, Math.floor(effectiveIntro / hopSec));
    const phrases: { start: number; end: number; duration: number }[] = [];
    let inPhrase = false;
    let phraseStartFrame = startScanFrame;
    let quietFrames = 0;

    for (let f = startScanFrame; f < frameCount; f++) {
      const isVocal = prominence[f] >= 0.28 && env[f] >= maxEnergy * 0.11;
      if (!inPhrase) {
        if (isVocal) {
          // Walk back up to 250ms to catch the gentle onset rise out of the valley
          let onset = f;
          while (onset > startScanFrame && prominence[onset - 1] > 0.15 && f - onset < 25) {
            onset--;
          }
          phraseStartFrame = onset;
          inPhrase = true;
          quietFrames = 0;
        }
      } else {
        if (isVocal) {
          quietFrames = 0;
        } else {
          quietFrames++;
          // A valley of >= 160ms (16 frames) separates distinct vocal phrases
          if (quietFrames >= 16) {
            const phraseEndFrame = f - quietFrames + 4; // +40ms vowel decay tail
            const dur = (phraseEndFrame - phraseStartFrame) * hopSec;
            if (dur >= 0.9) {
              phrases.push({
                start: Math.round(phraseStartFrame * hopSec * 100) / 100,
                end: Math.round(phraseEndFrame * hopSec * 100) / 100,
                duration: Math.round(dur * 100) / 100,
              });
            }
            inPhrase = false;
            quietFrames = 0;
          }
        }
      }
    }

    if (inPhrase) {
      const dur = (frameCount - 1 - phraseStartFrame) * hopSec;
      if (dur >= 0.9) {
        phrases.push({
          start: Math.round(phraseStartFrame * hopSec * 100) / 100,
          end: Math.round((frameCount - 1) * hopSec * 100) / 100,
          duration: Math.round(dur * 100) / 100,
        });
      }
    }

    // 3. Extract instrumental breaks / inter-verse pauses (>= 2.2s between vocal phrases)
    const detectedBreaks: { start: number; end: number; duration: number }[] = [];
    for (let i = 0; i < phrases.length - 1; i++) {
      const gap = phrases[i + 1].start - phrases[i].end;
      if (gap >= 2.2) {
        detectedBreaks.push({
          start: phrases[i].end,
          end: phrases[i + 1].start,
          duration: Math.round(gap * 100) / 100,
        });
      }
    }

    return {
      detectedIntroSilence: effectiveIntro,
      detectedBreaks,
      phrases,
    };
  } catch (err) {
    console.warn('extractAcousticPhraseMap failed:', err);
    return { detectedIntroSilence: userVocalStartTime, detectedBreaks: [], phrases: [] };
  }
}

/**
 * Finds the nearest acoustic onset / vocal attack within a search window (default up to 3.5s)
 * around targetTime. Walks down the leading slope to the exact valley-to-mountain onset edge.
 */
export function findNearestAcousticOnset(
  audioBuffer: AudioBuffer,
  targetTime: number,
  searchWindowSeconds = 3.5
): number | null {
  if (!audioBuffer) return null;
  const { env, prominence, frameCount, hopSec, maxEnergy } = buildPrecisionEnvelope10ms(audioBuffer);

  const minFrame = Math.max(2, Math.floor(Math.max(0, targetTime - 1.5) / hopSec));
  const maxFrame = Math.min(frameCount - 3, Math.floor((targetTime + searchWindowSeconds) / hopSec));
  if (maxFrame <= minFrame + 5) return null;

  const targetFrame = Math.floor(targetTime / hopSec);

  // If targetTime is already inside an active vocal mountain, walk back to the valley floor
  if (targetFrame >= minFrame && targetFrame <= maxFrame && prominence[targetFrame] >= 0.32) {
    let onset = targetFrame;
    const maxWalkBack = Math.max(minFrame, targetFrame - 95); // up to 0.95s back
    while (onset > maxWalkBack && prominence[onset - 1] > 0.16) {
      if (env[onset] <= env[onset - 1] && env[onset] <= env[onset + 1] && prominence[onset] < 0.28) {
        break;
      }
      onset--;
    }
    return Math.round(Math.max(0, onset - 2) * hopSec * 100) / 100;
  }

  let bestScore = -1;
  let bestRiseFrame = -1;
  for (let f = minFrame; f <= maxFrame - 10; f++) {
    const slope = prominence[f + 2] - prominence[f - 2];
    if (slope > 0.08 && prominence[f + 2] >= 0.35 && env[f + 2] >= maxEnergy * 0.1) {
      const distSec = Math.abs(f * hopSec - targetTime);
      const proximity = 1 / (1 + distSec * 0.45);
      const score = slope * proximity * prominence[f + 2];
      if (score > bestScore) {
        bestScore = score;
        bestRiseFrame = f;
      }
    }
  }

  if (bestRiseFrame > 0) {
    let onset = bestRiseFrame;
    const maxWalkBack = Math.max(minFrame, bestRiseFrame - 35);
    while (onset > maxWalkBack && prominence[onset - 1] > 0.15) {
      onset--;
    }
    return Math.round(Math.max(0, onset - 2) * hopSec * 100) / 100;
  }

  return null;
}

export interface CueDoubleCheckAdjustment {
  id: number;
  oldStart: number;
  newStart: number;
  oldEnd: number;
  newEnd: number;
  startDelta: number;
  endDelta: number;
}

export interface CueDoubleCheckResult<T> {
  cues: T[];
  correctedCount: number;
  adjustments: CueDoubleCheckAdjustment[];
}

/**
 * Post-Placement Acoustic Double Check & Self-Correction (`doubleCheckAndCorrectCues`):
 * Inspects every placed subtitle block against the 10ms vocal-band + visual waveform envelope:
 *
 * Stage A (Verify & Correct `startTime` for all cues):
 *   - Measures each cue's core vocal energy (`coreEnv`, 68th percentile in the middle of the block).
 *   - Check 1 (Too-Early Start in Inter-Line Pause): If the initial 250ms at `startTime` is sitting in a
 *     quiet pause/turnaround (`initialEnv < onsetThreshold`), scans forward (up to +1.75s) to find the exact
 *     frame where 180ms-sustained vocal energy rises above `onsetThreshold`, and advances `startTime` (-40ms pre-roll).
 *   - Check 2 (Slightly-Late Start / Clipped First Word): If `startTime` is already inside high vocal energy
 *     (`initialEnv >= highThreshold`), walks backward along that same vocal attack slope (at most 0.45s back,
 *     and never closer than `prevEnd + 0.55s`) so the first consonant is never clipped.
 *   - NEVER pulls a cue backward across an inter-line pause onto the previous cue!
 *
 * Stage B (Verify & Correct `endTime` for all cues using verified `startTime`s):
 *   - Finds where the vocal phrase drops into the pause trough at the end of the line, and adds a
 *     `+0.38s` post-vocal sustain tail ("stem ijlt nog even door") so the subtitle never cuts off abruptly,
 *     while keeping at least a `0.22s` gap before the next cue's verified `startTime`.
 */
export function doubleCheckAndCorrectCues<T extends { id: number; startTime: number; endTime: number; text?: string }>(
  audioBuffer: AudioBuffer,
  cues: T[],
  vocalStartTime = 0
): CueDoubleCheckResult<T> {
  if (!audioBuffer || cues.length === 0) {
    return { cues, correctedCount: 0, adjustments: [] };
  }

  const { env, prominence, frameCount, hopSec, totalDuration } =
    buildPrecisionEnvelope10ms(audioBuffer);

  const sorted = [...cues].sort((a, b) => a.id - b.id).map((c) => ({ ...c }));
  const numCues = sorted.length;
  const adjustments: CueDoubleCheckAdjustment[] = [];

  const origStarts = sorted.map((c) => c.startTime);
  const origEnds = sorted.map((c) => c.endTime);

  // Helper: average env over [fStart, fEnd] inclusive
  const avgEnvInRange = (fStart: number, fEnd: number): number => {
    const s = Math.max(0, Math.min(frameCount - 1, fStart));
    const e = Math.max(s, Math.min(frameCount - 1, fEnd));
    let sum = 0;
    let cnt = 0;
    for (let f = s; f <= e; f++) {
      sum += env[f];
      cnt++;
    }
    return cnt > 0 ? sum / cnt : 0;
  };

  // Helper: compute percentile of env in [fStart, fEnd]
  const percentileEnv = (fStart: number, fEnd: number, p: number): number => {
    const s = Math.max(0, Math.min(frameCount - 1, fStart));
    const e = Math.max(s, Math.min(frameCount - 1, fEnd));
    const vals: number[] = [];
    for (let f = s; f <= e; f++) {
      vals.push(env[f]);
    }
    if (vals.length === 0) return 0.1;
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
  };

  // =========================================================================
  // STAGE A: Verify & Correct `startTime` of every cue independently
  // =========================================================================
  const coreEnvPerCue = new Float32Array(numCues);
  const troughEnvPerCue = new Float32Array(numCues);

  for (let i = 0; i < numCues; i++) {
    const cur = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const dur = Math.max(1.8, cur.endTime - cur.startTime);

    // 1. Measure core vocal energy in the middle of the cue (where the singer is actively singing)
    const coreStartSec = cur.startTime + Math.min(1.25, dur * 0.25);
    const coreEndSec = Math.max(coreStartSec + 0.8, cur.endTime - Math.min(0.75, dur * 0.18));
    const coreStartF = Math.floor(coreStartSec / hopSec);
    const coreEndF = Math.floor(coreEndSec / hopSec);
    const coreEnv = percentileEnv(coreStartF, coreEndF, 0.68);
    coreEnvPerCue[i] = coreEnv;

    // 2. Find trough floor energy around the transition before this cue's core
    const troughSearchStartSec =
      i === 0
        ? Math.max(0, cur.startTime - 0.8)
        : Math.max(prev!.startTime + 1.8, Math.min(prev!.endTime - 0.3, cur.startTime - 0.5));
    const troughSearchEndSec = Math.min(cur.endTime - 1.5, cur.startTime + 1.35);
    const tStartF = Math.max(0, Math.floor(troughSearchStartSec / hopSec));
    const tEndF = Math.min(frameCount - 16, Math.floor(troughSearchEndSec / hopSec));

    let troughEnv = percentileEnv(tStartF, Math.max(tStartF + 5, tEndF), 0.18);
    let troughMinF = Math.floor(cur.startTime / hopSec);
    let minWinAvg = Infinity;

    // Find the quietest 160ms (16-frame) pause window before the core vocal
    for (let f = tStartF; f <= tEndF; f++) {
      const wAvg = avgEnvInRange(f, f + 15);
      if (wAvg < minWinAvg) {
        minWinAvg = wAvg;
        troughMinF = f + 8;
      }
    }
    if (minWinAvg < Infinity) {
      troughEnv = Math.min(troughEnv, minWinAvg);
    }
    troughEnvPerCue[i] = troughEnv;

    const dynamicRange = Math.max(0.04, coreEnv - troughEnv);
    // Only adjust if there is clear acoustic contrast between the pause trough and the sung phrase
    if (coreEnv <= troughEnv * 1.25) {
      continue;
    }

    const startF = Math.floor(cur.startTime / hopSec);
    const initial240msEnv = avgEnvInRange(startF, startF + 24);
    const onsetThreshold = troughEnv + 0.42 * dynamicRange;
    const sustainThreshold = troughEnv + 0.45 * dynamicRange;

    if (initial240msEnv < onsetThreshold) {
      // CASE 1: Block starts TOO EARLY (sitting inside the quiet pause/turnaround before the voice enters)
      // Scan forward from max(startF, troughMinF) up to +1.75s (leaving at least 2.1s duration for the cue)
      const scanStartF = Math.max(
        i === 0 ? Math.floor(Math.max(0, vocalStartTime - 0.3) / hopSec) : startF,
        troughMinF
      );
      const maxForwardSec = Math.min(cur.endTime - 2.0, cur.startTime + 1.75);
      const scanEndF = Math.min(frameCount - 20, Math.floor(maxForwardSec / hopSec));

      let foundOnsetF = -1;
      for (let f = scanStartF; f <= scanEndF; f++) {
        if (env[f] >= onsetThreshold && prominence[f] >= 0.24) {
          // Verify that this is a sustained vocal entrance (180ms = 18 frames) and not a brief guitar pluck
          const sustained180ms = avgEnvInRange(f, f + 17);
          if (sustained180ms >= sustainThreshold) {
            foundOnsetF = f;
            break;
          }
        }
      }

      if (foundOnsetF > startF) {
        // Walk back up to 4 frames (40ms) down the attack slope to capture the initial consonant
        let refinedF = foundOnsetF;
        const slopeFloor = troughEnv + 0.18 * dynamicRange;
        while (refinedF > startF && foundOnsetF - refinedF < 4 && env[refinedF - 1] >= slopeFloor) {
          refinedF--;
        }
        const newStartSec = Math.round(refinedF * hopSec * 100) / 100;
        if (newStartSec > cur.startTime + 0.06 && newStartSec < cur.endTime - 1.8) {
          cur.startTime = newStartSec;
        }
      }
    } else if (initial240msEnv >= troughEnv + 0.70 * dynamicRange) {
      // CASE 2: Block starts SLIGHTLY LATE (already inside strong vocal energy at `startTime`)
      // Walk backward along this same vocal phrase's attack slope, at most 0.42s back,
      // and NEVER closer than `prev.endTime + 0.55s` so we never collapse inter-line pauses!
      const minAllowedSec =
        i === 0
          ? Math.max(0, vocalStartTime - 0.3, cur.startTime - 0.42)
          : Math.max(prev!.endTime + 0.55, cur.startTime - 0.42);
      const minAllowedF = Math.max(1, Math.floor(minAllowedSec / hopSec));

      if (startF > minAllowedF + 3) {
        let walkF = startF;
        const attackFloor = troughEnv + 0.24 * dynamicRange;
        while (walkF > minAllowedF && env[walkF - 1] >= attackFloor && prominence[walkF - 1] >= 0.20) {
          walkF--;
        }
        // Only apply if we actually reached a quieter onset edge before startF
        if (walkF < startF - 3 && env[walkF] < initial240msEnv * 0.78) {
          const newStartSec = Math.round(walkF * hopSec * 100) / 100;
          if (cur.startTime - newStartSec >= 0.06) {
            cur.startTime = newStartSec;
          }
        }
      }
    }
  }

  // =========================================================================
  // STAGE B: Verify & Correct `endTime` of every cue (with +0.38s vocal sustain tail)
  // =========================================================================
  for (let i = 0; i < numCues; i++) {
    const cur = sorted[i];
    const next = i < numCues - 1 ? sorted[i + 1] : null;
    const coreEnv = coreEnvPerCue[i];
    const troughEnv = troughEnvPerCue[i];
    const dynamicRange = Math.max(0.04, coreEnv - troughEnv);

    const maxAllowedEndSec = next
      ? Math.max(cur.startTime + 1.8, next.startTime - 0.22)
      : Math.min(totalDuration, cur.endTime + 1.5);

    // Search around cur.endTime for where the vocal sustain drops into the pause trough
    const searchStartSec = Math.max(cur.startTime + 2.0, cur.endTime - 1.15);
    const searchEndSec = Math.min(maxAllowedEndSec, Math.max(cur.endTime + 0.9, cur.startTime + 3.2));

    const sF = Math.max(0, Math.floor(searchStartSec / hopSec));
    const eF = Math.min(frameCount - 1, Math.floor(searchEndSec / hopSec));

    if (eF > sF + 12 && coreEnv > troughEnv * 1.22) {
      const tailActiveThreshold = troughEnv + 0.26 * dynamicRange;
      let lastVocalF = -1;

      for (let f = sF; f <= eF; f++) {
        // Check if 60ms local window still has vocal energy
        const localEnv = avgEnvInRange(Math.max(0, f - 3), Math.min(frameCount - 1, f + 3));
        if (localEnv >= tailActiveThreshold && prominence[f] >= 0.18) {
          lastVocalF = f;
        }
      }

      if (lastVocalF > sF) {
        // Add +0.38s post-vocal sustain tail ("stem ijlt nog even door") so the block never cuts off abruptly
        const sustainedEndSec = Math.min(maxAllowedEndSec, (lastVocalF + 38) * hopSec);
        const roundedEnd = Math.round(sustainedEndSec * 100) / 100;
        if (roundedEnd >= cur.startTime + 2.0 && Math.abs(roundedEnd - cur.endTime) >= 0.08) {
          cur.endTime = roundedEnd;
        }
      }
    }

    // Final safety clamp against next cue's verified startTime
    if (next && cur.endTime > next.startTime - 0.18) {
      cur.endTime = Math.max(
        Math.round((cur.startTime + 1.5) * 100) / 100,
        Math.round((next.startTime - 0.18) * 100) / 100
      );
    }
  }

  // Record all adjustments for the Double Check audit report
  for (let i = 0; i < numCues; i++) {
    const startDelta = Math.round((sorted[i].startTime - origStarts[i]) * 100) / 100;
    const endDelta = Math.round((sorted[i].endTime - origEnds[i]) * 100) / 100;
    if (Math.abs(startDelta) >= 0.05 || Math.abs(endDelta) >= 0.05) {
      adjustments.push({
        id: sorted[i].id,
        oldStart: origStarts[i],
        newStart: sorted[i].startTime,
        oldEnd: origEnds[i],
        newEnd: sorted[i].endTime,
        startDelta,
        endDelta,
      });
    }
  }

  return {
    cues: sorted,
    correctedCount: adjustments.length,
    adjustments,
  };
}

/**
 * Wrapper around `doubleCheckAndCorrectCues` for callers expecting the corrected cues array directly.
 */
export function alignCuesWithAcousticWaveform<T extends { id: number; startTime: number; endTime: number; text?: string }>(
  audioBuffer: AudioBuffer,
  cues: T[],
  vocalStartTime = 0
): T[] {
  return doubleCheckAndCorrectCues(audioBuffer, cues, vocalStartTime).cues;
}

/**
 * Finds the natural end of a vocal phrase (including vocal sustain/decay tail) for a specific cue.
 */
export function findVocalPhraseEnd(
  audioBuffer: AudioBuffer,
  startTime: number,
  maxEndSec: number,
  minDuration = 1.8
): number | null {
  if (!audioBuffer) return null;
  const { env, prominence, frameCount, hopSec, totalDuration, maxEnergy } =
    buildPrecisionEnvelope10ms(audioBuffer);

  const startFrame = Math.max(0, Math.floor(startTime / hopSec));
  const minFrames = Math.floor(minDuration / hopSec);
  const endFrame = Math.min(frameCount - 1, Math.floor(Math.min(totalDuration, maxEndSec) / hopSec));

  if (endFrame <= startFrame + 10) return null;

  let lastActiveFrame = Math.min(endFrame, startFrame + minFrames);
  let quietCount = 0;

  for (let f = Math.min(endFrame, startFrame + Math.floor(minFrames * 0.8)); f <= endFrame; f++) {
    if (prominence[f] >= 0.22 || env[f] >= maxEnergy * 0.14) {
      lastActiveFrame = f;
      quietCount = 0;
    } else {
      quietCount++;
      if (quietCount >= 22 && f >= startFrame + minFrames) {
        break;
      }
    }
  }

  // Add +0.40s post-vocal sustain tail ("stem ijlt nog even door")
  const detectedVocalEnd = lastActiveFrame * hopSec + 0.40;
  const clamped = Math.min(maxEndSec, Math.min(totalDuration, detectedVocalEnd));
  return Math.round(clamped * 100) / 100;
}

/**
 * Snaps all subtitle cues to their nearest acoustic onset & valley offset,
 * maintaining chronological ordering and avoiding overlap.
 */
export function snapCuesToAudioOnsets<T extends { id: number; startTime: number; endTime: number; text?: string }>(
  audioBuffer: AudioBuffer,
  cues: T[],
  vocalStartTime = 0
): T[] {
  return alignCuesWithAcousticWaveform(audioBuffer, cues, vocalStartTime);
}
