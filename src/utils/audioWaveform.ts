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
    // If numBuckets not specified or default 600, scale with duration to give ~15-20 peaks per second
    const targetBuckets = Math.max(120, Math.min(3000, Math.round((audioBuffer.duration || 30) * 15)));
    const actualBuckets = numBuckets === 120 ? 120 : targetBuckets;
    const bucketSize = Math.floor(channelData.length / actualBuckets);
    const peaks: number[] = [];

    for (let i = 0; i < actualBuckets; i++) {
      const start = i * bucketSize;
      const end = Math.min(channelData.length, start + bucketSize);
      let max = 0;
      for (let j = start; j < end; j += 4) { // sampling step for speed
        const val = Math.abs(channelData[j]);
        if (val > max) max = val;
      }
      peaks.push(max);
    }

    // Normalize peaks between 0.12 and 1.0
    const absoluteMax = Math.max(...peaks, 0.01);
    const normalized = peaks.map((p) => Math.max(0.12, p / absoluteMax));

    audioContext.close();
    return normalized;
  } catch (err) {
    console.warn('Failed to extract waveform peaks:', err);
    // Return aesthetic simulated waveform fallback
    const fallbackCount = numBuckets || 600;
    return Array.from({ length: fallbackCount }, (_, i) => {
      const v = Math.sin(i * 0.15) * 0.4 + Math.cos(i * 0.35) * 0.3 + 0.4;
      return Math.max(0.15, Math.min(0.95, v));
    });
  }
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

  // Search window from slightly before targetTime up to searchWindowSeconds ahead
  const minTime = Math.max(0, targetTime - 1.5);
  const maxTime = Math.min(totalDuration, targetTime + searchWindowSeconds);

  const startSample = Math.floor(minTime * sampleRate);
  const endSample = Math.min(channelData.length, Math.floor(maxTime * sampleRate));

  // Compute short-term energy envelopes in 10ms hops (e.g. 441 samples at 44.1kHz)
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

  // Smooth energy envelope (30ms moving average)
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

  // Find local floor and maximum energy
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

  // Find maximum positive energy derivative (onset attack)
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

  // 1. Compute 10ms energy envelope across the entire song
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

  // 2. Smooth envelope with a 50ms window (5 frames)
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

  // 3. Find track-wide peak
  let maxEnergy = 0.01;
  for (let f = 0; f < frameCount; f++) {
    if (env[f] > maxEnergy) maxEnergy = env[f];
  }
  const minActiveThreshold = maxEnergy * 0.12;

  const sorted = [...cues].sort((a, b) => a.id - b.id);
  let lastEnd = Math.max(0, vocalStartTime);

  return sorted.map((cue, idx) => {
    const rawDur = Math.max(1.8, Math.min(8.0, cue.endTime - cue.startTime));
    const targetStart = cue.startTime;

    // Search window: look starting from lastEnd up to Math.max(targetStart + 5.0, lastEnd + 8.5)
    const searchStartSec = Math.max(lastEnd, Math.max(0, targetStart - 2.5));
    const searchEndSec = Math.min(totalDuration, Math.max(targetStart + 5.5, lastEnd + 8.5));

    const startFrame = Math.floor(searchStartSec / 0.01);
    const endFrame = Math.floor(searchEndSec / 0.01);

    // Compute baseline valley floor in the quiet area right after lastEnd
    let valleySum = 0;
    let valleyCount = 0;
    const valleySampleEnd = Math.min(endFrame, startFrame + 40); // 400ms
    for (let f = startFrame; f < valleySampleEnd; f++) {
      valleySum += env[f];
      valleyCount++;
    }
    const localFloor = valleyCount > 0 ? valleySum / valleyCount : 0.01;
    const onsetThreshold = Math.max(minActiveThreshold, localFloor * 1.55);

    let detectedOnsetSec: number | null = null;
    let bestScore = -1;

    for (let f = startFrame + 2; f < endFrame - 2; f++) {
      const slope = env[f] - env[f - 3];
      const curEnergy = env[f];
      const timeSec = f * 0.01;

      // Positive rising edge bursting out of a quiet valley
      if (slope > 0.007 && curEnergy >= onsetThreshold) {
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

    // Determine upper search boundary for phrase end (stop before next cue's estimated start)
    const nextCue = sorted[idx + 1];
    const nextCueStart = nextCue ? nextCue.startTime : totalDuration;
    const maxAllowedEndSec = nextCueStart > finalStart + 1.2
      ? Math.min(totalDuration, nextCueStart - 0.15)
      : Math.min(totalDuration, finalStart + 9.5);

    const onsetFrame = Math.floor(finalStart / 0.01);
    const maxFrame = Math.min(frameCount - 1, Math.floor(maxAllowedEndSec / 0.01));
    const minPhraseFrames = Math.floor(1.6 / 0.01); // At least 1.6s before phrase can end
    const vocalActiveThreshold = Math.max(minActiveThreshold * 0.85, localFloor * 1.35);

    let lastActiveVocalFrame = onsetFrame + minPhraseFrames;
    let consecutiveQuietFrames = 0;
    const quietValleyRequirement = 25; // 250ms of sustained low energy required to confirm end of phrase

    for (let f = onsetFrame + Math.min(minPhraseFrames, 120); f <= maxFrame; f++) {
      const cur = env[f];
      if (cur >= vocalActiveThreshold) {
        lastActiveVocalFrame = f;
        consecutiveQuietFrames = 0;
      } else {
        consecutiveQuietFrames++;
        // If we hit a sustained quiet valley of >= 250ms after the minimum duration, phrase has genuinely ended
        if (consecutiveQuietFrames >= quietValleyRequirement && f >= onsetFrame + minPhraseFrames) {
          break;
        }
      }
    }

    // Add a natural vocal decay & reading hold padding (+0.50s) so the subtitle stays visible
    // comfortably while the singer finishes the final syllable and the note decays
    const vocalEndSec = Math.max(finalStart + 1.5, lastActiveVocalFrame * 0.01);
    const readingHoldPad = 0.50; // 500ms post-vocal reading comfort
    let finalEnd = vocalEndSec + readingHoldPad;

    // If the original cue duration was longer and fits in the phrase slot, don't shrink prematurely
    if (finalEnd < finalStart + rawDur && finalStart + rawDur <= maxAllowedEndSec) {
      finalEnd = finalStart + rawDur;
    }

    // Ensure it does not collide with the next cue
    if (nextCueStart > finalStart + 1.2) {
      finalEnd = Math.min(finalEnd, nextCueStart - 0.15);
    }

    // Enforce overall constraints
    finalEnd = Math.min(finalEnd, totalDuration);
    finalEnd = Math.min(finalEnd, finalStart + 9.5);
    if (finalEnd <= finalStart + 1.2) {
      finalEnd = Math.min(totalDuration, finalStart + Math.max(2.0, rawDur));
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
 * Scans forward from cue.startTime to find where vocal energy genuinely dies down into a valley,
 * plus 500ms of reading hold padding.
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

  const hopSize = Math.floor(sampleRate * 0.01); // 10ms
  const startFrame = Math.max(0, Math.floor(startTime / 0.01));
  const maxSearchSec = Math.min(totalDuration, Math.max(startTime + minDuration, maxEndSec));
  const endFrame = Math.min(Math.floor(channelData.length / hopSize), Math.floor(maxSearchSec / 0.01));

  if (endFrame <= startFrame + 10) return null;

  // Local envelope
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
  const withPad = detectedVocalEnd + 0.50; // +500ms sustain & reading comfort
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


