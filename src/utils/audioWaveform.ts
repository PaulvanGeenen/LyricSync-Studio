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
 * Finds the nearest acoustic onset / vocal attack within a search window (default up to 3.5s)
 * around targetTime. Detects where vocal energy rises sharply above local background silence / valley floor.
 */
export function findNearestAcousticOnset(
  audioBuffer: AudioBuffer,
  targetTime: number,
  searchWindowSeconds = 3.5
): number | null {
  if (!audioBuffer) return null;
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalDuration = audioBuffer.duration;

  const minTime = Math.max(0, targetTime - 1.5);
  const maxTime = Math.min(totalDuration, targetTime + searchWindowSeconds);

  const startSample = Math.floor(minTime * sampleRate);
  const endSample = Math.min(channelData.length, Math.floor(maxTime * sampleRate));

  const hopSize = Math.floor(sampleRate * 0.01); // 10ms
  const hopCount = Math.floor((endSample - startSample) / hopSize);
  if (hopCount < 5) return null;

  const rawEnergies: number[] = new Array(hopCount);
  for (let h = 0; h < hopCount; h++) {
    const s = startSample + h * hopSize;
    let sum = 0;
    const end = Math.min(channelData.length, s + hopSize);
    for (let k = s; k < end; k += 2) {
      const v = channelData[k];
      sum += v * v;
    }
    rawEnergies[h] = Math.sqrt(sum / (hopSize / 2));
  }

  const energies: number[] = new Array(hopCount);
  for (let h = 0; h < hopCount; h++) {
    let s = 0;
    let count = 0;
    for (let k = -1; k <= 1; k++) {
      const idx = h + k;
      if (idx >= 0 && idx < hopCount) {
        s += rawEnergies[idx];
        count++;
      }
    }
    energies[h] = s / count;
  }

  let maxEnergy = 0.005;
  for (let h = 0; h < hopCount; h++) {
    if (energies[h] > maxEnergy) maxEnergy = energies[h];
  }

  let valleyFloorSum = 0;
  const valleyFrames = Math.min(25, hopCount);
  for (let h = 0; h < valleyFrames; h++) {
    valleyFloorSum += energies[h];
  }
  const valleyFloor = valleyFloorSum / valleyFrames;
  const threshold = Math.max(0.012, valleyFloor * 1.55);

  let maxScore = -1;
  let bestHop = -1;
  for (let h = 2; h < hopCount - 1; h++) {
    const slope = energies[h] - energies[h - 2];
    const curVal = energies[h];
    if (slope > 0.006 && curVal >= threshold) {
      const hopTime = minTime + (h * hopSize) / sampleRate;
      const dist = Math.abs(hopTime - targetTime);
      const proximityWeight = 1 / (1 + dist * 0.4);
      const score = slope * proximityWeight * (curVal / maxEnergy);
      if (score > maxScore) {
        maxScore = score;
        bestHop = h;
      }
    }
  }

  if (bestHop > 0) {
    const onsetTime = minTime + (bestHop * hopSize) / sampleRate;
    return Math.round(onsetTime * 100) / 100;
  }

  return null;
}

/**
 * High-precision Acoustic Waveform Phrase Aligner:
 * Scans the actual audio waveform amplitude & energy envelope directly from the decoded AudioBuffer,
 * matching how a human visually spots the start of sung phrases after quiet valleys on the waveform.
 */
export function alignCuesWithAcousticWaveform<T extends { id: number; startTime: number; endTime: number; text?: string }>(
  audioBuffer: AudioBuffer,
  cues: T[],
  vocalStartTime = 0
): T[] {
  if (!audioBuffer || cues.length === 0) return cues;

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalDuration = audioBuffer.duration;

  const hopSize = Math.floor(sampleRate * 0.01); // 10ms
  const frameCount = Math.floor(channelData.length / hopSize);
  const rawEnv = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    let sum = 0;
    const end = Math.min(channelData.length, start + hopSize);
    for (let j = start; j < end; j += 2) {
      const v = channelData[j];
      sum += v * v;
    }
    rawEnv[f] = Math.sqrt(sum / (hopSize / 2));
  }

  const env = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let s = 0;
    let count = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < frameCount) {
        s += rawEnv[idx];
        count++;
      }
    }
    env[f] = count > 0 ? s / count : rawEnv[f];
  }

  let maxEnergy = 0.01;
  for (let f = 0; f < frameCount; f++) {
    if (env[f] > maxEnergy) maxEnergy = env[f];
  }
  const minActiveThreshold = maxEnergy * 0.12;

  const sorted = [...cues].sort((a, b) => a.id - b.id);
  let lastEnd = Math.max(0, vocalStartTime);

  return sorted.map((cue, idx) => {
    const syllables = estimateSyllables(cue.text || '');
    const expectedDur = Math.max(1.6, Math.min(6.8, 0.9 + syllables * 0.34));
    const targetStart = cue.startTime;

    const searchStartSec = Math.max(lastEnd, Math.max(0, targetStart - 2.5));
    const searchEndSec = Math.min(totalDuration, Math.max(targetStart + 5.5, lastEnd + 8.5));

    const startFrame = Math.floor(searchStartSec / 0.01);
    const endFrame = Math.floor(searchEndSec / 0.01);

    let valleySum = 0;
    let valleyCount = 0;
    const valleySampleEnd = Math.min(endFrame, startFrame + 40);
    for (let f = startFrame; f < valleySampleEnd; f++) {
      valleySum += env[f];
      valleyCount++;
    }
    const localFloor = valleyCount > 0 ? valleySum / valleyCount : 0.01;
    const onsetThreshold = Math.max(minActiveThreshold, localFloor * 1.5);

    let detectedOnsetSec: number | null = null;
    let bestScore = -1;

    for (let f = startFrame + 2; f < endFrame - 2; f++) {
      const slope = env[f] - env[f - 3];
      const curEnergy = env[f];
      const timeSec = f * 0.01;

      if (slope > 0.006 && curEnergy >= onsetThreshold) {
        const distFromTarget = Math.abs(timeSec - targetStart);
        const proximityWeight = 1 / (1 + distFromTarget * 0.35);
        const score = slope * proximityWeight * (curEnergy / maxEnergy);

        if (score > bestScore) {
          bestScore = score;
          detectedOnsetSec = timeSec;
        }
      }
    }

    let finalStart = targetStart;
    if (detectedOnsetSec !== null && detectedOnsetSec >= lastEnd + 0.1) {
      finalStart = detectedOnsetSec;
    } else if (finalStart < lastEnd) {
      finalStart = lastEnd + 0.15;
    }

    finalStart = Math.round(finalStart * 100) / 100;

    const nextCue = sorted[idx + 1];
    const nextCueStart = nextCue ? nextCue.startTime : totalDuration;
    const maxAllowedEndSec = nextCueStart > finalStart + 1.2
      ? Math.min(totalDuration, nextCueStart - 0.15)
      : Math.min(totalDuration, finalStart + 8.5);

    const onsetFrame = Math.floor(finalStart / 0.01);
    const maxFrame = Math.min(frameCount - 1, Math.floor(maxAllowedEndSec / 0.01));
    const minPhraseFrames = Math.floor(Math.max(1.3, expectedDur * 0.55) / 0.01);
    const vocalActiveThreshold = Math.max(minActiveThreshold * 0.85, localFloor * 1.35);

    let lastActiveVocalFrame = onsetFrame + minPhraseFrames;
    let consecutiveQuietFrames = 0;
    const quietValleyRequirement = 22; // 220ms of low energy confirms end of phrase

    for (let f = onsetFrame + Math.min(minPhraseFrames, 110); f <= maxFrame; f++) {
      const cur = env[f];
      if (cur >= vocalActiveThreshold) {
        lastActiveVocalFrame = f;
        consecutiveQuietFrames = 0;
      } else {
        consecutiveQuietFrames++;
        if (consecutiveQuietFrames >= quietValleyRequirement && f >= onsetFrame + minPhraseFrames) {
          break;
        }
      }
    }

    const vocalEndSec = Math.max(finalStart + 1.35, lastActiveVocalFrame * 0.01);
    let finalEnd = vocalEndSec + 0.28;

    if (nextCueStart > finalStart + 1.2) {
      finalEnd = Math.min(finalEnd, nextCueStart - 0.15);
    }

    finalEnd = Math.min(finalEnd, totalDuration);
    finalEnd = Math.min(finalEnd, finalStart + Math.max(3.5, expectedDur * 1.45));
    if (finalEnd <= finalStart + 1.2) {
      finalEnd = Math.min(totalDuration, finalStart + expectedDur);
    }

    finalEnd = Math.round(finalEnd * 100) / 100;
    lastEnd = finalEnd + 0.15;

    return {
      ...cue,
      startTime: finalStart,
      endTime: finalEnd,
    };
  });
}

/**
 * Finds the natural end of a vocal phrase for a specific cue using acoustic envelope analysis.
 */
export function findVocalPhraseEnd(
  audioBuffer: AudioBuffer,
  startTime: number,
  maxEndSec: number,
  minDuration = 1.8
): number | null {
  if (!audioBuffer) return null;
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalDuration = audioBuffer.duration;

  const hopSize = Math.floor(sampleRate * 0.01);
  const startFrame = Math.max(0, Math.floor(startTime / 0.01));
  const maxSearchSec = Math.min(totalDuration, Math.max(startTime + minDuration, maxEndSec));
  const endFrame = Math.min(Math.floor(channelData.length / hopSize), Math.floor(maxSearchSec / 0.01));

  if (endFrame <= startFrame + 10) return null;

  const frameCount = endFrame - startFrame;
  const env = new Float32Array(frameCount);
  let maxLocal = 0.01;

  for (let i = 0; i < frameCount; i++) {
    const s = (startFrame + i) * hopSize;
    let sum = 0;
    const end = Math.min(channelData.length, s + hopSize);
    for (let j = s; j < end; j += 2) {
      const v = channelData[j];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (hopSize / 2));
    env[i] = rms;
    if (rms > maxLocal) maxLocal = rms;
  }

  const quietThreshold = maxLocal * 0.22;
  const minFrames = Math.floor(minDuration / 0.01);
  let lastActiveIdx = Math.min(frameCount - 1, minFrames);
  let quietCount = 0;

  for (let i = Math.min(minFrames, 80); i < frameCount; i++) {
    if (env[i] >= quietThreshold) {
      lastActiveIdx = i;
      quietCount = 0;
    } else {
      quietCount++;
      if (quietCount >= 25 && i >= minFrames) {
        break;
      }
    }
  }

  const detectedVocalEnd = startTime + lastActiveIdx * 0.01;
  const withPad = detectedVocalEnd + 0.35;
  const clamped = Math.min(maxEndSec, Math.min(totalDuration, withPad));
  return Math.round(clamped * 100) / 100;
}

/**
 * Snaps all subtitle cues to their nearest acoustic onset,
 * maintaining chronological ordering and avoiding overlap.
 */
export function snapCuesToAudioOnsets<T extends { id: number; startTime: number; endTime: number; text?: string }>(
  audioBuffer: AudioBuffer,
  cues: T[],
  vocalStartTime = 0
): T[] {
  return alignCuesWithAcousticWaveform(audioBuffer, cues, vocalStartTime);
}
