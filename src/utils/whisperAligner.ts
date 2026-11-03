import { WhisperWord } from './whisperWorker';
import { SubtitleCue } from '../types/subtitle';

/**
 * Decodes an audio Blob/File into 16kHz mono Float32Array for Whisper processing.
 */
export async function decodeAudioTo16kMono(audioBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  const targetSampleRate = 16000;
  const numChannels = decoded.numberOfChannels;
  const origLength = decoded.length;
  const origSampleRate = decoded.sampleRate;

  // Mixdown to mono
  const mono = new Float32Array(origLength);
  if (numChannels === 1) {
    mono.set(decoded.getChannelData(0));
  } else {
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    for (let i = 0; i < origLength; i++) {
      mono[i] = 0.5 * (left[i] + right[i]);
    }
  }

  // Resample to 16kHz if needed using OfflineAudioContext
  if (origSampleRate === targetSampleRate) {
    return mono;
  }

  const targetLength = Math.round((origLength * targetSampleRate) / origSampleRate);
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1,
    targetLength,
    targetSampleRate
  );

  const buffer = offlineCtx.createBuffer(1, origLength, origSampleRate);
  buffer.getChannelData(0).set(mono);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüýÿij]/g, '')
    .trim();
}

/**
 * Fuzzy similarity between two normalized words (Levenshtein distance based).
 */
function wordSimilarity(w1: string, w2: string): number {
  if (w1 === w2) return 1.0;
  if (!w1 || !w2) return 0;
  if (w1.includes(w2) || w2.includes(w1)) return 0.85;

  const m = w1.length;
  const n = w2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = w1[i - 1] === w2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  const maxLen = Math.max(m, n);
  return 1 - dp[m][n] / maxLen;
}

/**
 * Aligns Whisper recognized words to the user's lyrics lines.
 * Guarantees monotonic ordering, detects instrumental breaks and intros automatically!
 */
export function alignWhisperWordsToLyricLines(
  whisperWords: WhisperWord[],
  lyricLines: { id: number; text: string; originalText?: string }[],
  audioDuration: number
): {
  cues: SubtitleCue[];
  detectedIntroSilence: number;
  detectedBreaks: { start: number; end: number; duration: number }[];
} {
  if (lyricLines.length === 0) {
    return { cues: [], detectedIntroSilence: 0, detectedBreaks: [] };
  }

  // Filter valid whisper words
  const validWords = whisperWords
    .filter((w) => normalizeWord(w.text).length > 0 && w.start >= 0 && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const lineWords = lyricLines.map((line) => {
    return line.text
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 0);
  });

  interface LineSpan {
    id: number;
    text: string;
    originalText?: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }

  const spans: LineSpan[] = [];
  let curWordIdx = 0;

  for (let lineIdx = 0; lineIdx < lyricLines.length; lineIdx++) {
    const targetWords = lineWords[lineIdx];
    const lineObj = lyricLines[lineIdx];

    if (targetWords.length === 0 || curWordIdx >= validWords.length) {
      spans.push({
        id: lineObj.id,
        text: lineObj.text,
        originalText: lineObj.originalText,
        startTime: -1,
        endTime: -1,
        confidence: 0,
      });
      continue;
    }

    // Look ahead in whisper words within a search window (e.g. up to 45 words ahead)
    const searchWindow = Math.min(validWords.length, curWordIdx + 45);
    let bestStartIdx = -1;
    let bestEndIdx = -1;
    let bestScore = -1;
    let bestFirstMatchedTargetIdx = 0;
    let bestLastMatchedTargetIdx = 0;

    // Try finding the match of targetWords sequence starting at various positions in Whisper words
    for (let wStart = curWordIdx; wStart < searchWindow; wStart++) {
      let matchedCount = 0;
      let scoreSum = 0;
      let wPtr = wStart;
      let firstMatchedT = -1;
      let lastMatchedT = -1;

      for (let t = 0; t < targetWords.length && wPtr < searchWindow; t++) {
        const target = targetWords[t];
        // Look within next 3 Whisper words for this target word
        let foundWordInScan = false;
        for (let lookahead = 0; lookahead <= 2 && wPtr + lookahead < searchWindow; lookahead++) {
          const cand = normalizeWord(validWords[wPtr + lookahead].text);
          const sim = wordSimilarity(target, cand);
          if (sim >= 0.6) {
            matchedCount++;
            scoreSum += sim;
            if (firstMatchedT === -1) firstMatchedT = t;
            lastMatchedT = t;
            wPtr = wPtr + lookahead + 1;
            foundWordInScan = true;
            break;
          }
        }
      }

      const matchRatio = matchedCount / targetWords.length;
      if (matchRatio >= 0.35 && scoreSum > bestScore) {
        bestScore = scoreSum;
        bestStartIdx = wStart;
        bestEndIdx = Math.max(wStart, wPtr - 1);
        bestFirstMatchedTargetIdx = firstMatchedT >= 0 ? firstMatchedT : 0;
        bestLastMatchedTargetIdx = lastMatchedT >= 0 ? lastMatchedT : targetWords.length - 1;
      }
    }

    if (bestStartIdx >= 0 && bestEndIdx >= bestStartIdx) {
      let startTime = Math.round(validWords[bestStartIdx].start * 100) / 100;
      let endTime = Math.round((validWords[bestEndIdx].end + 0.25) * 100) / 100;

      // Expand backwards if leading words were missed (e.g. "The paso doble" missed before "strikes")
      if (bestFirstMatchedTargetIdx > 0) {
        const estimatedPreRoll = bestFirstMatchedTargetIdx * 0.45;
        startTime = Math.max(0, Math.round((startTime - estimatedPreRoll) * 100) / 100);
      }

      // Expand forwards if trailing words were missed
      const missingTrailing = (targetWords.length - 1) - bestLastMatchedTargetIdx;
      if (missingTrailing > 0) {
        const estimatedPostRoll = missingTrailing * 0.40;
        endTime = Math.round((endTime + estimatedPostRoll) * 100) / 100;
      }

      spans.push({
        id: lineObj.id,
        text: lineObj.text,
        originalText: lineObj.originalText,
        startTime,
        endTime,
        confidence: bestScore,
      });
      curWordIdx = bestEndIdx + 1;
    } else {
      spans.push({
        id: lineObj.id,
        text: lineObj.text,
        originalText: lineObj.originalText,
        startTime: -1,
        endTime: -1,
        confidence: 0,
      });
    }
  }

  // Post-processing: interpolate missing/unmatched lines between confident anchors
  // First, find the first confident anchor to know when the intro ends
  let firstAnchorStart = 0;
  for (const s of spans) {
    if (s.startTime >= 0) {
      firstAnchorStart = s.startTime;
      break;
    }
  }

  // Smooth unanchored lines
  let lastEnd = Math.max(0, firstAnchorStart);
  const cues: SubtitleCue[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const naturalDur = Math.max(2.0, Math.min(7.5, 1.4 + span.text.length * 0.12));

    if (span.startTime >= 0 && span.startTime >= lastEnd - 0.2) {
      // Anchored by Whisper!
      const finalStart = Math.max(lastEnd, span.startTime);
      const finalEnd = Math.max(finalStart + 1.2, span.endTime);
      cues.push({
        id: span.id,
        startTime: Math.round(finalStart * 100) / 100,
        endTime: Math.round(finalEnd * 100) / 100,
        text: span.text,
        originalText: span.originalText,
      });
      lastEnd = finalEnd + 0.15;
    } else {
      // Find next future anchor
      let nextAnchorTime: number | null = null;
      let missingSteps = 0;
      for (let j = i + 1; j < spans.length; j++) {
        if (spans[j].startTime > lastEnd + 1.0) {
          nextAnchorTime = spans[j].startTime;
          missingSteps = j - i;
          break;
        }
      }

      let finalStart = lastEnd + 0.15;
      let finalEnd = finalStart + naturalDur;

      if (nextAnchorTime !== null && missingSteps > 0) {
        const available = Math.max(1.0, nextAnchorTime - lastEnd);
        const slot = available / (missingSteps + 1);
        finalStart = Math.round((lastEnd + Math.max(0.1, slot * 0.1)) * 100) / 100;
        finalEnd = Math.round((finalStart + Math.max(1.4, Math.min(naturalDur, slot * 0.85))) * 100) / 100;
      }

      cues.push({
        id: span.id,
        startTime: Math.round(finalStart * 100) / 100,
        endTime: Math.round(finalEnd * 100) / 100,
        text: span.text,
        originalText: span.originalText,
      });
      lastEnd = finalEnd + 0.15;
    }
  }

  // Detect breaks between cues (where gap >= 3.0 seconds)
  const detectedBreaks: { start: number; end: number; duration: number }[] = [];
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = cues[i + 1].startTime - cues[i].endTime;
    if (gap >= 2.5) {
      detectedBreaks.push({
        start: cues[i].endTime,
        end: cues[i + 1].startTime,
        duration: Math.round(gap * 10) / 10,
      });
    }
  }

  return {
    cues,
    detectedIntroSilence: Math.round(firstAnchorStart * 10) / 10,
    detectedBreaks,
  };
}

/**
 * Runs the complete local Whisper transcription and alignment in the browser!
 */
export async function runLocalWhisperAlignment(
  audioBlob: Blob,
  lyricLines: { id: number; text: string; originalText?: string }[],
  audioDuration: number,
  language: 'nl' | 'en' = 'en',
  onProgress?: (percent: number, statusText: string) => void
): Promise<{
  cues: SubtitleCue[];
  detectedIntroSilence: number;
  detectedBreaks: { start: number; end: number; duration: number }[];
}> {
  onProgress?.(10, 'Audio converteren naar 16kHz mono...');
  const audioData = await decodeAudioTo16kMono(audioBlob);

  onProgress?.(25, 'Lokale Whisper AI initialiseren...');

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'status') {
        onProgress?.(35, data.text || 'Model laden...');
      } else if (data.type === 'model-progress') {
        const p = Math.round(25 + (data.progress || 0) * 0.2);
        onProgress?.(p, `Whisper model inladen (${Math.round((data.progress || 0) * 100)}%)...`);
      } else if (data.type === 'transcribe-progress') {
        const { done, total } = data;
        const p = Math.round(45 + (done / Math.max(1, total)) * 45);
        onProgress?.(p, `Zang beluisteren & transcriberen (${done}/${total} segmenten)...`);
      } else if (data.type === 'result') {
        onProgress?.(95, 'Tekstregels uitlijnen op herkende woorden...');
        try {
          const result = alignWhisperWordsToLyricLines(data.words || [], lyricLines, audioDuration);
          worker.terminate();
          resolve(result);
        } catch (alignErr) {
          worker.terminate();
          reject(alignErr);
        }
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message || 'Whisper transcriptiefout'));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`Whisper Worker error: ${err.message}`));
    };

    worker.postMessage({ audio: audioData, language }, [audioData.buffer]);
  });
}
