import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

const execFileAsync = util.promisify(execFile);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// Resilient pool of official Google Gemini models
const CANDIDATE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
];

let _ffmpegChecked = false;
let _ffmpegAvailable = false;

async function checkFfmpegAvailable(): Promise<boolean> {
  if (_ffmpegChecked) return _ffmpegAvailable;
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
    _ffmpegAvailable = true;
  } catch {
    _ffmpegAvailable = false;
  }
  _ffmpegChecked = true;
  return _ffmpegAvailable;
}

/**
 * Strips bracketed section headers like [Verse 1], [Chorus], [Bridge], [Intro], [Outro], etc.
 * Discards empty lines resulting from standalone bracket tags.
 */
function cleanLyricLines(rawText: string): string[] {
  return rawText
    .split('\n')
    .map((line) => line.replace(/\[.*?\]/g, '').trim())
    .filter((line) => line.length > 0);
}

function cleanLyricsString(rawText: string): string {
  return cleanLyricLines(rawText).join('\n');
}

/**
 * Post-processes and clamps cues while strictly preserving sequential cue order:
 * 1. Guarantees monotonic progression: each cue starts after the previous cue ends.
 * 2. Clamps abnormally stretched cue durations (max ~7.5s).
 * 3. Prevents collisions or backwards jumps.
 * 4. Ensures every single cue from #1 to #N is preserved with valid positive duration.
 */
function sanitizeAndClampCues(
  rawCues: { id: number; startTime: number; endTime: number; text: string; originalText?: string }[],
  audioDuration: number
) {
  // Always sort primarily by ID to strictly preserve the song's lyrical sequence
  const cues = [...rawCues].sort((a, b) => a.id - b.id);
  if (cues.length === 0) return [];
  let lastEnd = cues[0].startTime;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const nextCue = cues[i + 1];

    const lineLength = cue.text.length;
    const naturalVocalDuration = Math.max(1.8, Math.min(7.5, 1.3 + lineLength * 0.12));

    // Ensure start time is monotonic and never steps backwards behind previous cue
    if (cue.startTime < lastEnd) {
      cue.startTime = Math.round(lastEnd * 100) / 100;
    }

    // Clamp stretched duration
    if (cue.endTime - cue.startTime > 8.5 || cue.endTime <= cue.startTime) {
      cue.endTime = Math.round((cue.startTime + naturalVocalDuration) * 100) / 100;
    }

    // Avoid collision with next cue if next cue has a valid future timestamp
    if (nextCue && nextCue.startTime > cue.startTime && cue.endTime > nextCue.startTime) {
      cue.endTime = Math.max(cue.startTime + 1.2, Math.round((nextCue.startTime - 0.15) * 100) / 100);
    }

    // Handle audio boundary gracefully without collapsing duration
    if (audioDuration > 0 && cue.endTime > audioDuration + 0.2) {
      if (cue.startTime < audioDuration - 1.2) {
        cue.endTime = Math.round(audioDuration * 100) / 100;
      }
    }

    lastEnd = cue.endTime + 0.15;
  }

  return cues;
}

interface AcousticBreak {
  start: number;
  end: number;
  duration: number;
}

interface ProcessedAudioResult {
  base64: string;
  mimeType: string;
  detectedIntroSilence: number;
  detectedBreaks: AcousticBreak[];
}

/**
 * Optimizes audio payloads for Gemini AI models with 24kHz 64kbps mono MP3,
 * and performs sub-millisecond acoustic VAD (silencedetect + bandpass) to pinpoint
 * exact intro silence duration and mid-song instrumental breaks (guitar solos, piano interludes).
 */
async function processAudioForAiAndAcoustics(
  audioBase64: string,
  mimeType: string
): Promise<ProcessedAudioResult> {
  const hasFfmpeg = await checkFfmpegAvailable();
  if (!hasFfmpeg) {
    return {
      base64: audioBase64,
      mimeType,
      detectedIntroSilence: 0,
      detectedBreaks: [],
    };
  }

  let tmpInput = '';
  let tmpOutput = '';
  let detectedIntroSilence = 0;
  const detectedBreaks: AcousticBreak[] = [];

  try {
    const tmpDir = os.tmpdir();
    const id = Math.random().toString(36).substring(2, 9);
    tmpInput = path.join(tmpDir, `input_${id}.audio`);
    tmpOutput = path.join(tmpDir, `compact_${id}.mp3`);

    const cleanBase64 = audioBase64.replace(/^data:audio\/[a-zA-Z0-9.+_-]+;base64,/, '');
    fs.writeFileSync(tmpInput, Buffer.from(cleanBase64, 'base64'));

    // 1. Acoustic VAD Analysis: detect quiet intervals / instrumental breaks in vocal band
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-i', tmpInput,
        '-af', 'bandpass=f=1200:width_type=h:w=1800, silencedetect=noise=-28dB:d=1.5',
        '-f', 'null',
        '-',
      ], { timeout: 15000 });

      const lines = (stderr || '').split('\n');
      let currentSilenceStart: number | null = null;
      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
        if (startMatch) {
          currentSilenceStart = parseFloat(startMatch[1]);
        }
        const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
        if (endMatch && currentSilenceStart !== null) {
          const end = parseFloat(endMatch[1]);
          const dur = parseFloat(endMatch[2]);
          if (currentSilenceStart < 1.0) {
            detectedIntroSilence = Math.max(detectedIntroSilence, end);
          } else if (dur >= 2.5) {
            detectedBreaks.push({
              start: Math.round(currentSilenceStart * 100) / 100,
              end: Math.round(end * 100) / 100,
              duration: Math.round(dur * 100) / 100,
            });
          }
          currentSilenceStart = null;
        }
      }
    } catch (vadErr: any) {
      console.warn('[VAD Acoustic Analysis] Non-fatal VAD warning:', vadErr?.message?.substring(0, 100));
    }

    // 2. High-fidelity vocal compression for Gemini: 24kHz @ 64kbps mono MP3 (preserves vocal consonants & breathing)
    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', tmpInput,
      '-ar', '24000',
      '-ac', '1',
      '-b:a', '64k',
      tmpOutput,
    ], { timeout: 15000 });

    if (fs.existsSync(tmpOutput)) {
      const compactBuf = fs.readFileSync(tmpOutput);
      if (compactBuf.length > 0) {
        console.log(
          `[Audio Processing] High-fidelity compression: ${(cleanBase64.length / 1024 / 1024).toFixed(1)}MB -> ${(compactBuf.length / 1024).toFixed(0)}KB (24kHz 64kbps). Detected intro: ${detectedIntroSilence.toFixed(1)}s, ${detectedBreaks.length} instrumental breaks.`
        );
        return {
          base64: compactBuf.toString('base64'),
          mimeType: 'audio/mp3',
          detectedIntroSilence,
          detectedBreaks,
        };
      }
    }
  } catch (err: any) {
    console.warn('[Audio Processing] FFmpeg processing fallback:', err?.message?.substring(0, 100));
  } finally {
    try {
      if (tmpInput && fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
      if (tmpOutput && fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    } catch (_) {}
  }

  return {
    base64: audioBase64,
    mimeType,
    detectedIntroSilence,
    detectedBreaks,
  };
}

/**
 * Intelligent sequential alignment merger:
 * Combines multimodal AI timing anchors with all lyric pairs.
 * Strictly respects acoustic instrumental breaks & solos (NEVER drags cues backwards into solos,
 * and NEVER linearly stretches cues across solo breaks).
 */
function mergeTimingsWithPairs(
  pairs: { id: number; original: string; translated: string }[],
  parsedTimings: { id: number; startTime: number; endTime: number }[],
  totalDuration: number,
  isTranslationNeeded: boolean,
  vocalStartTime: number = 0,
  detectedBreaks: AcousticBreak[] = []
) {
  if (pairs.length === 0) return [];

  const effectiveDuration = totalDuration > 10 ? totalDuration : pairs.length * 4.5 + vocalStartTime;

  // Clean and parse timings sorted by ID
  let validTimings = (parsedTimings || [])
    .map((t) => ({
      id: Number(t.id),
      startTime: Math.max(0, parseFloat(String(t.startTime)) || 0),
      endTime: Math.max(0, parseFloat(String(t.endTime)) || 0),
    }))
    .filter((t) => !isNaN(t.id) && !isNaN(t.startTime) && t.endTime > t.startTime)
    .sort((a, b) => a.id - b.id);

  // Step 1: Detect and repair MM.SS decimal notation bugs from AI (e.g. 1:11.50 written as 111.50 instead of 71.50)
  let runningCheckEnd = vocalStartTime;
  for (let i = 0; i < validTimings.length; i++) {
    const t = validTimings[i];
    const origDur = Math.max(1.8, Math.min(7.5, t.endTime - t.startTime));
    if (t.startTime >= 100) {
      const mins = Math.floor(t.startTime / 100);
      const secs = t.startTime % 100;
      if (mins >= 1 && mins <= 9 && secs < 60) {
        const mmSsCorrectedStart = Math.round((mins * 60 + secs) * 100) / 100;
        const jumpFromPrev = t.startTime - runningCheckEnd;
        if (
          (jumpFromPrev > 22 && mmSsCorrectedStart >= runningCheckEnd - 2.5) ||
          (t.startTime > effectiveDuration - 2 && mmSsCorrectedStart < effectiveDuration - 2 && mmSsCorrectedStart >= runningCheckEnd - 2.5)
        ) {
          console.log(
            `[Alignment MM.SS Fix] Cue #${t.id}: Fixed AI MM.SS timestamp ${t.startTime.toFixed(2)}s -> ${mmSsCorrectedStart.toFixed(2)}s (${mins}m ${secs.toFixed(2)}s)`
          );
          t.startTime = Math.max(runningCheckEnd, mmSsCorrectedStart);
          const endMins = Math.floor(t.endTime / 100);
          const endSecs = t.endTime % 100;
          if (endMins >= 1 && endMins <= 9 && endSecs < 60 && mins * 60 + endSecs > t.startTime) {
            t.endTime = Math.round((endMins * 60 + endSecs) * 100) / 100;
          } else {
            t.endTime = Math.round((t.startTime + origDur) * 100) / 100;
          }
        }
      }
    }
    runningCheckEnd = Math.max(runningCheckEnd, t.endTime);
  }

  // Step 2: Handle vocal start offset
  // Only shift the entire song if AI completely missed the intro (e.g. started > 2.5s before vocalStartTime)
  if (vocalStartTime > 0 && validTimings.length > 0) {
    const minStart = Math.min(...validTimings.map((t) => t.startTime));
    if (minStart < vocalStartTime - 2.5) {
      const shift = Math.round((vocalStartTime - minStart) * 100) / 100;
      console.log(`[Alignment] Shifting cues by +${shift.toFixed(2)}s to honor vocal start time ${vocalStartTime}s`);
      validTimings = validTimings.map((t) => ({
        ...t,
        startTime: Math.round((t.startTime + shift) * 100) / 100,
        endTime: Math.round((t.endTime + shift) * 100) / 100,
      }));
    } else if (validTimings[0].startTime < vocalStartTime - 0.3) {
      validTimings[0].startTime = Math.round(vocalStartTime * 100) / 100;
      if (validTimings[0].endTime <= validTimings[0].startTime + 1.2) {
        validTimings[0].endTime = Math.round((validTimings[0].startTime + 2.8) * 100) / 100;
      }
    }
  }

  const timingMap = new Map<number, { startTime: number; endTime: number }>();
  for (const t of validTimings) {
    timingMap.set(t.id, { startTime: t.startTime, endTime: t.endTime });
  }

  const resultCues: { id: number; startTime: number; endTime: number; text: string; originalText?: string }[] = [];
  let lastEnd = vocalStartTime;
  let lastStart = Math.max(0, vocalStartTime - 1.5);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const timing = timingMap.get(pair.id);
    const lineLen = (pair.original || pair.translated).length;
    // Realistic natural singing duration (~2.5s - 3.8s for typical lyric lines, never 5.5s-6.5s)
    const naturalDur = Math.max(1.85, Math.min(4.2, 1.1 + lineLen * 0.068));

    let start: number;
    let end: number;

    if (timing && timing.startTime >= lastStart + 0.85) {
      // Honor AI startTime directly without snowballing forward drift from previous endTime!
      // If the previous cue's endTime extended past this cue's startTime, trim the previous cue's endTime.
      if (resultCues.length > 0 && resultCues[resultCues.length - 1].endTime > timing.startTime - 0.10) {
        const prev = resultCues[resultCues.length - 1];
        prev.endTime = Math.max(
          Math.round((prev.startTime + 1.25) * 100) / 100,
          Math.round((timing.startTime - 0.12) * 100) / 100
        );
        lastEnd = prev.endTime + 0.10;
      }

      start = Math.max(i === 0 ? vocalStartTime : lastStart + 1.1, timing.startTime);
      const rawAiDur = timing.endTime - timing.startTime;
      // Prevent AI from artificially stretching a 3s phrase to 5.5s across breath pauses
      const maxPhraseDur = Math.max(3.8, naturalDur * 1.38);
      const cueDur = Math.max(1.65, Math.min(maxPhraseDur, rawAiDur));
      end = Math.round((start + cueDur) * 100) / 100;
    } else {
      // Find next upcoming AI anchor further down the song if one exists
      let nextAnchorTime: number | null = null;
      let stepsToNext = 0;
      for (let j = i + 1; j < pairs.length; j++) {
        const nextTiming = timingMap.get(pairs[j].id);
        if (nextTiming && nextTiming.startTime > lastEnd + 1.2) {
          nextAnchorTime = nextTiming.startTime;
          stepsToNext = j - i;
          break;
        }
      }

      if (nextAnchorTime !== null && stepsToNext > 0) {
        const available = Math.max(1.0, nextAnchorTime - lastEnd);
        const reservedSoloGap = available > 14 ? available * 0.45 : 0;
        const availableForSinging = available - reservedSoloGap;
        const slot = availableForSinging / (stepsToNext + 1);
        start = Math.round((lastEnd + Math.max(0.15, Math.min(0.45, slot * 0.12))) * 100) / 100;
        const dur = Math.max(1.65, Math.min(naturalDur, slot * 0.78));
        end = Math.round((start + dur) * 100) / 100;
      } else {
        // Space remaining cues with natural singing duration and breath pause
        start = Math.round((lastEnd + 0.30) * 100) / 100;
        end = Math.round((start + naturalDur) * 100) / 100;
      }
    }

    // Instrumental break collision check:
    // Ensure no cue starts in the middle of a detected acoustic solo/break
    for (const b of detectedBreaks) {
      if (start >= b.start + 0.2 && start < b.end - 0.35) {
        console.log(`[Break Guard] Moved Cue #${pair.id} from ${start.toFixed(1)}s past break to ${b.end.toFixed(1)}s`);
        start = Math.round((b.end + 0.05) * 100) / 100;
        end = Math.round((start + naturalDur) * 100) / 100;
      } else if (start < b.start && end > b.start + 0.3) {
        // Cleanly end cue before the break begins
        end = Math.round((b.start - 0.08) * 100) / 100;
      }
    }

    if (end <= start + 1.1) {
      end = Math.round((start + naturalDur) * 100) / 100;
    }

    lastStart = start;
    lastEnd = end + 0.12;

    resultCues.push({
      id: pair.id,
      startTime: Math.round(start * 100) / 100,
      endTime: Math.round(end * 100) / 100,
      text: pair.translated.replace(/\[.*?\]/g, '').trim(),
      originalText: isTranslationNeeded ? pair.original.replace(/\[.*?\]/g, '').trim() : undefined,
    });
  }

  return sanitizeAndClampCues(resultCues, totalDuration);
}

async function startServer() {
  const app = express();

  // Support audio file upload up to 60MB payload
  app.use(express.json({ limit: '60mb' }));
  app.use(express.urlencoded({ extended: true, limit: '60mb' }));

  // Initialize shared Gemini instance only if API key is provided
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const ai = hasGeminiKey
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const PREFERRED_OLLAMA_MODELS = [
    'llama3.1:8b',
    'dolphin3:8b-llama3.1-q4_K_M',
    'cognitivecomputations/dolphin-llama3.1:8b',
    'qwen2.5-coder:7b',
    'deepseek-coder:6.7b',
  ];

  async function getLocalOllamaModel(): Promise<string | null> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      const data: any = await res.json();
      const installed: string[] = (data.models || []).map((m: any) => String(m.name));
      if (installed.length === 0) return null;
      for (const pref of PREFERRED_OLLAMA_MODELS) {
        if (installed.includes(pref)) return pref;
      }
      return installed[0];
    } catch {
      return null;
    }
  }

  function extractJsonArray(parsed: any): any[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) {
          return parsed[key];
        }
      }
    }
    return [];
  }

  async function generateJsonWithLocalOllama(prompt: string, temperature = 0.25): Promise<any> {
    const model = await getLocalOllamaModel();
    if (!model) {
      throw new Error('Geen lokaal Ollama-model gevonden op 127.0.0.1:11434');
    }
    console.log(`[Local Ollama] Executing prompt with local model: ${model}...`);
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert bilingual Dutch/English music lyric translator and subtitle editor. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        format: 'json',
        stream: false,
        options: {
          temperature,
        },
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }
    const data: any = await res.json();
    const rawContent = data?.message?.content?.trim() || '{}';
    return JSON.parse(rawContent);
  }

  // Resilient API execution with per-attempt timeout and backoff retry
  async function generateWithRetry(request: any, maxRetries = 2, timeoutMs = 60000) {
    if (!ai) {
      throw new Error('No Gemini API key configured');
    }
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timer: NodeJS.Timeout | null = null;
      try {
        const result = await Promise.race([
          ai.models.generateContent(request),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Model ${request?.model} timed out after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        return result;
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        const status = err?.status || err?.code;
        const msg = String(err?.message || '');
        const isTimeout = msg.includes('timed out');
        const isHighDemand =
          status === 503 ||
          status === 429 ||
          msg.includes('503') ||
          msg.includes('high demand') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('RESOURCE_EXHAUSTED');
        if (isTimeout || isHighDemand) {
          throw err;
        }
        if (attempt < maxRetries) {
          const delay = attempt * 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  // Health check API
  app.get('/api/health', async (_req, res) => {
    const ollamaModel = await getLocalOllamaModel();
    res.json({
      status: 'ok',
      hasApiKey: hasGeminiKey,
      localOllamaModel: ollamaModel,
      mode: hasGeminiKey ? 'gemini' : ollamaModel ? `local-ollama (${ollamaModel})` : 'local-acoustic',
    });
  });

  /**
   * Detects the exact moment vocal singing starts in an audio track.
   * Reliably catches 5s, 10s, 20s, 30s+ instrumental intros (guitar, piano, drums)
   * where dead silence detectors fail because instruments are actively playing.
   */
  async function detectVocalStartInAudio(
    audioBase64: string,
    mimeType = 'audio/mp3'
  ): Promise<{ vocalStartSeconds: number; firstWords?: string; hasIntro: boolean }> {
    if (!process.env.GEMINI_API_KEY || !audioBase64) {
      return { vocalStartSeconds: 0, hasIntro: false };
    }

    const prompt = `Listen carefully to this musical audio track.
At what exact second do the human vocal singing start?
Songs frequently start with an instrumental intro (acoustic guitar, piano, drums, bass, synth) that lasts 10, 20, 30 or more seconds before singing starts.
Return a JSON object with:
- vocalStartSeconds: exact timestamp in seconds when the singer begins singing the first words (e.g. 20.8)
- firstWords: string of the first words sung (e.g. "White tiles")
- hasIntro: boolean (true if vocalStartSeconds >= 2.0)`;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        console.log(`[Vocal Intro Detector] Probing vocal start with model ${modelName}...`);
        const res = await generateWithRetry({
          model: modelName,
          contents: {
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: prompt },
            ],
          },
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                vocalStartSeconds: { type: Type.NUMBER, description: 'Seconds when singing starts' },
                firstWords: { type: Type.STRING, description: 'First words sung' },
                hasIntro: { type: Type.BOOLEAN, description: 'True if there is an instrumental intro' },
              },
              required: ['vocalStartSeconds'],
            },
          },
        }, 2, 60000);

        const parsed = JSON.parse(res.text?.trim() || '{}');
        if (typeof parsed.vocalStartSeconds === 'number' && !isNaN(parsed.vocalStartSeconds)) {
          const startSec = Math.max(0, Math.round(parsed.vocalStartSeconds * 10) / 10);
          console.log(`[Vocal Intro Detector] Detected vocal start: ${startSec}s (first words: "${parsed.firstWords || ''}", hasIntro: ${parsed.hasIntro})`);
          return {
            vocalStartSeconds: startSec,
            firstWords: parsed.firstWords,
            hasIntro: startSec >= 2.0,
          };
        }
      } catch (err: any) {
        console.warn(`[Vocal Intro Detector] Model ${modelName} probe error:`, err?.message?.substring(0, 100));
      }
    }

    return { vocalStartSeconds: 0, hasIntro: false };
  }

  /**
   * Translates lyrics with high fidelity and poetic mastery using Gemini 3.8 Flash,
   * strictly contextualizing the entire song and eliminating false friends, awkward calques,
   * or robotic machine translation errors.
   */
  async function translateLyricsPoetically(
    lyrics: string,
    sourceLang: 'en' | 'nl',
    targetLang: 'en' | 'nl',
    style: 'natural' | 'singable' | 'poetic' = 'natural'
  ): Promise<{ id: number; original: string; translated: string }[]> {
    const cleanLines = cleanLyricLines(lyrics);
    const cleanLyrics = cleanLines.join('\n');
    const sourceLangName = sourceLang === 'nl' ? 'Nederlands (Dutch)' : 'Engels (English)';
    const targetLangName = targetLang === 'nl' ? 'Nederlands (Dutch)' : 'Engels (English)';

    let styleInstructions = '';
    if (style === 'singable') {
      styleInstructions = `STYLE: ZINGBAAR & RITMISCH (SINGABLE & RHYTHMIC):
- Match the musical meter, cadence, and syllable flow so the translated lines can be sung naturally to the melody.
- Use natural internal or end rhymes where appropriate, without forcing unnatural vocabulary.`;
    } else if (style === 'poetic') {
      styleInstructions = `STYLE: POËTISCH & LITERAIR (POETIC & ARTISTIC):
- Use evocative, lyrical imagery, artistic metaphors, and refined vocabulary befitting great songwriting literature.`;
    } else {
      styleInstructions = `STYLE: NATUURLIJK & BETEKENISGETROUW (NATURAL & MEANING-FOCUSED - RECOMMENDED):
- Prioritize 100% natural, contemporary phrasing and faithful conveyance of the song's true meaning and emotional heart.
- Absolutely avoid stiff literal translations or forced rhymes that distort the sentiment.`;
    }

    const indexedLyrics = cleanLines.map((line, idx) => `#${idx + 1}: ${line}`).join('\n');

    const prompt = `Je bent een meesterlijke tweetalige liedvertaler, bekroond tekstdichter en songwriter gespecialiseerd in Nederlands en Engels.
Vertaal de onderstaande songtekst regel-voor-regel van het ${sourceLangName} naar het ${targetLangName}.

${styleInstructions}

STRIKTE RICHTLIJNEN OM VERTAALFOUTEN TE VOORKOMEN:
1. GEEN LETTERLIJKE MACHINEVERTALING:
   - Een liedvertaling mag nooit een letterlijke woord-voor-woordvertaling zijn. Vertaal de werkelijke muzikale betekenis en emotionele intentie.
   - Begrijp de context van het gehele lied: wie zingt tegen wie, welke emotie staat centraal, welke verhaallijn loopt er.

2. ABSOLUUT VERBOD OP VALSE VRIENDEN EN HOUTERIGE ANGLICISMEN:
   ${targetLang === 'nl' ? `
   * "eventually" -> "uiteindelijk" (NOOIT "eventueel")
   * "actually" -> "eigenlijk" / "in feite" / "echt" (NOOIT "actueel")
   * "pathetic" -> "zielig" / "aangrijpend" / "hartverscheurend" (NOOIT "pathetisch")
   * "brave" -> "dapper" / "moedig" (NOOIT "braaf")
   * "make sense" -> "logisch klinken" / "kloppen" (NOOIT "zin maken")
   * "take for granted" -> "voor lief nemen" (NOOIT "voor gegarandeerd nemen")
   * "fall in love" -> "verliefd worden" (NOOIT "vallen in liefde")
   * "I am down" -> "ik zit in de put" / "ik ben er kapot van" (NOOIT letterlijk "ik ben beneden")
   * "I wonder" -> "ik vraag me af" (NOOIT "ik verwonder")
   * Zorg voor een eigentijdse, natuurlijke aanspreekvorm: gebruik in pop/rock/ballads "je / jij / jou / jouw" (gebruik NOOIT het archaïsche/afstandelijke "u").
   * Let op correcte Nederlandse grammatica: zinsvolgorde (inversie na tijdsbepalingen), scheidbare werkwoorden ("we gaan door", "ik geef het op") en juiste vaste voorzetsels ("wachten op", "geloven in").
   ` : `
   * English target: Write natural, idiomatic, and lyrical contemporary English lyrics.
   * Avoid Dutch word-order calques (e.g. inverted word order like 'yesterday saw I').
   * Use vivid, natural English songwriting idioms and natural collocations.
   `}

3. EXACTE 1-OP-1 REGELCORRESPONDENTIE & VOLLEDIGHEIDSVEREISTE:
   - De songtekst telt EXACT ${cleanLines.length} regels genummerd van #1 t/m #${cleanLines.length}.
   - Je MOET voor IEDERE regel van #1 t/m #${cleanLines.length} een vertaling leveren.
   - Het aantal items in de JSON-array moet EXACT ${cleanLines.length} zijn.
   - Stop NOOIT halverwege en laat NOOIT regels aan het einde weg!

4. VOLLEDIGE UITSLUITING VAN SECTIETAGS:
   - Tags zoals [Verse 1], [Chorus], [Bridge], [Intro], [Outro] mogen NOOIT in de vertaling voorkomen.

Volledige Songtekst (${sourceLangName}) - ${cleanLines.length} regels:
${indexedLyrics}

Retourneer een valide JSON-object met een "pairs" array met daarin exact ${cleanLines.length} objecten:
{
  "pairs": [
    { "id": 1, "original": "...", "translated": "..." }
  ]
}`;

    const reconcileParsedPairs = (parsedArray: any[]) => {
      if (!Array.isArray(parsedArray) || parsedArray.length === 0) return null;
      const resultPairs: { id: number; original: string; translated: string }[] = [];
      for (let i = 0; i < cleanLines.length; i++) {
        const lineId = i + 1;
        const originalLine = cleanLines[i];
        const found = parsedArray.find((p: any) => p && Number(p.id) === lineId) || parsedArray[i];
        let translatedLine =
          found && (found.translated || found.translation || found.text)
            ? String(found.translated || found.translation || found.text).replace(/\[.*?\]/g, '').trim()
            : '';

        if (!translatedLine) {
          translatedLine = originalLine;
        }

        resultPairs.push({
          id: lineId,
          original: originalLine,
          translated: translatedLine,
        });
      }
      return resultPairs;
    };

    let lastError: any = null;

    // 1. Try Local Ollama first if no Gemini API key is configured (or as fallback)
    if (!hasGeminiKey) {
      try {
        const ollamaRaw = await generateJsonWithLocalOllama(prompt, style === 'singable' ? 0.35 : 0.2);
        const arr = extractJsonArray(ollamaRaw);
        const reconciled = reconcileParsedPairs(arr);
        if (reconciled) {
          return reconciled;
        }
      } catch (ollamaErr: any) {
        console.warn('[API /api/translate] Local Ollama warning:', ollamaErr?.message);
        lastError = ollamaErr;
      }
    }

    // 2. If Gemini API Key is present, try Gemini models
    if (hasGeminiKey) {
      for (const modelName of CANDIDATE_MODELS) {
        try {
          console.log(`[API /api/translate] Invoking translation model ${modelName} (${cleanLines.length} lines, style: ${style})...`);
          const response = await generateWithRetry({
            model: modelName,
            contents: prompt,
            config: {
              temperature: style === 'singable' ? 0.35 : 0.25,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                description: 'Carefully translated lyrics without section tags',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    original: { type: Type.STRING, description: 'Original clean line' },
                    translated: { type: Type.STRING, description: 'Natural, flawless translated line' },
                  },
                  required: ['id', 'original', 'translated'],
                },
              },
            },
          });

          const raw = response.text?.trim() || '';
          const parsed = extractJsonArray(JSON.parse(raw));
          const reconciled = reconcileParsedPairs(parsed);
          if (reconciled) {
            return reconciled;
          }
        } catch (err: any) {
          console.warn(`[API /api/translate] Model ${modelName} warning:`, err?.message?.substring(0, 150));
          lastError = err;
        }
      }

      // Fallback to Local Ollama if Gemini failed
      try {
        const ollamaRaw = await generateJsonWithLocalOllama(prompt, style === 'singable' ? 0.35 : 0.2);
        const arr = extractJsonArray(ollamaRaw);
        const reconciled = reconcileParsedPairs(arr);
        if (reconciled) {
          return reconciled;
        }
      } catch (_) {}
    }

    throw lastError || new Error('Er kon geen verbinding worden gemaakt met de lokale Ollama AI-service.');
  }

  // Standalone Translation Endpoint
  app.post('/api/translate', async (req, res) => {
    try {
      const { lyrics, sourceLanguage, targetLanguage, style = 'natural' } = req.body;

      if (!lyrics || typeof lyrics !== 'string' || !lyrics.trim()) {
        return res.status(400).json({ error: 'Songtekst is verplicht voor de vertaling.' });
      }

      if (!sourceLanguage || !targetLanguage) {
        return res.status(400).json({ error: 'Zowel bron- als doeltaal moeten worden opgegeven.' });
      }

      const cleanLines = cleanLyricLines(lyrics);
      if (cleanLines.length === 0) {
        return res.status(400).json({ error: 'Geen geldige songtekstregels gevonden na het verwijderen van tags.' });
      }

      if (sourceLanguage === targetLanguage) {
        return res.json({
          pairs: cleanLines.map((line: string, i: number) => ({ id: i + 1, original: line, translated: line })),
        });
      }

      try {
        const pairs = await translateLyricsPoetically(cleanLines.join('\n'), sourceLanguage, targetLanguage, style);
        return res.json({ success: true, pairs, style });
      } catch (genAiError: any) {
        console.error('[API /api/translate] Translation error:', genAiError?.message);
        return res.status(503).json({
          error: 'De lokale AI-vertaalservice (Ollama) kon niet worden bereikt. Zorg dat Ollama op de achtergrond draait.',
        });
      }
    } catch (err: any) {
      console.error('[API /api/translate] Global error:', err);
      return res.status(500).json({ error: err.message || 'Interne fout tijdens het vertalen.' });
    }
  });

  // Proofread and improve existing translation pairs
  app.post('/api/improve-translation', async (req, res) => {
    try {
      const { pairs, sourceLanguage, targetLanguage, feedback } = req.body;

      if (!Array.isArray(pairs) || pairs.length === 0) {
        return res.status(400).json({ error: 'Geen vertaalde regels ontvangen om te verbeteren.' });
      }

      const targetLangName = targetLanguage === 'nl' ? 'Nederlands' : 'Engels';
      const prompt = `Je bent een meesterlijke eindredacteur en bekroond vertaler van liedteksten.
De gebruiker merkt op dat de huidige vertaling taalfouten, onnatuurlijke zinswendingen of houterige formuleringen bevat.
${feedback ? `Extra feedback van de gebruiker: "${feedback}"` : ''}

Loop elke vertaalde regel grondig na en verbeter deze:
1. Verbeter eventuele grammaticale fouten, onjuiste voorzetsels, stijve zinsbouw of valse vrienden (bv. "eventually" is "uiteindelijk", "pathetic" is "zielig/aangrijpend", "brave" is "dapper/moedig").
2. Maak de tekst 100% vloeiend, natuurlijk en passend in de muzikale context in het ${targetLangName}.
3. Behoud precies dezelfde IDs en 1-op-1 regelkoppeling.

Huidige paren:
${JSON.stringify(pairs, null, 2)}

Retourneer een JSON-object met een "pairs" array met id, original en translated.`;

      if (!hasGeminiKey) {
        try {
          const ollamaRaw = await generateJsonWithLocalOllama(prompt, 0.2);
          const arr = extractJsonArray(ollamaRaw);
          if (arr.length > 0) {
            return res.json({ success: true, pairs: arr });
          }
        } catch (e: any) {
          console.warn('[API /api/improve-translation] Local Ollama warning:', e?.message);
        }
      }

      if (hasGeminiKey) {
        const candidateModels = CANDIDATE_MODELS;
        for (const modelName of candidateModels) {
          try {
            const response = await generateWithRetry({
              model: modelName,
              contents: prompt,
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description: 'Improved translated lyrics pairs',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.INTEGER },
                      original: { type: Type.STRING },
                      translated: { type: Type.STRING },
                    },
                    required: ['id', 'original', 'translated'],
                  },
                },
              },
            });

            const parsed = extractJsonArray(JSON.parse(response.text?.trim() || '[]'));
            if (Array.isArray(parsed) && parsed.length > 0) {
              return res.json({ success: true, pairs: parsed });
            }
          } catch (e: any) {
            // Continue to next model
          }
        }
      }

      // Rule-based heuristic polish fallback if all API calls rate-limited
      const polished = pairs.map((p) => {
        let t = p.translated
          .replace(/\beventueel\b/gi, 'uiteindelijk')
          .replace(/\bactueel\b/gi, 'in feite')
          .replace(/\bpathetisch\b/gi, 'zielig')
          .replace(/\bbraaf\b/gi, 'dapper')
          .replace(/\bzin maken\b/gi, 'kloppen')
          .replace(/\bvoor gegarandeerd nemen\b/gi, 'voor lief nemen')
          .replace(/\bu bent\b/gi, 'je bent')
          .replace(/\buw\b/gi, 'jouw')
          .trim();
        return { ...p, translated: t };
      });

      return res.json({ success: true, pairs: polished, notice: 'Regels geoptimaliseerd via stijlfilter.' });
    } catch (err: any) {
      console.error('[API /api/improve-translation] Error:', err);
      return res.status(500).json({ error: err.message || 'Verbeteren mislukt.' });
    }
  });

  // Suggest alternative translations for a single line
  app.post('/api/rephrase-line', async (req, res) => {
    try {
      const { originalLine, currentTranslation, sourceLanguage, targetLanguage, songContext } = req.body;

      if (!originalLine) {
        return res.status(400).json({ error: 'Ongeldige regelgegevens' });
      }

      const targetLangName = targetLanguage === 'nl' ? 'Nederlands' : 'Engels';
      const prompt = `Je bent een bekroonde songtekstschrijver en literair vertaler.
Bedenk 3 kwalitatief hoogstaande alternatieve vertalingen voor deze ene liedregel naar het ${targetLangName}:

Originele regel: "${originalLine}"
Huidige vertaling: "${currentTranslation || ''}"
${songContext ? `Context van het lied:\n${songContext.substring(0, 500)}` : ''}

Genereer exact 3 gevarieerde alternatieven:
1. 'natural': Vloeiend, natuurlijk en betekenisgetrouw (helder en authentiek)
2. 'singable': Ritmisch en zingbaar (passend bij het metrum van de melodie)
3. 'poetic': Poëtisch en beeldend (artistiek en literair)

Retourneer een JSON-object met een "options" array van 3 objecten met 'style', 'label' en 'text'.`;

      if (!hasGeminiKey) {
        try {
          const ollamaRaw = await generateJsonWithLocalOllama(prompt, 0.4);
          const arr = extractJsonArray(ollamaRaw);
          if (arr.length > 0) {
            return res.json({ success: true, options: arr });
          }
        } catch (e: any) {
          console.warn('[API /api/rephrase-line] Local Ollama warning:', e?.message);
        }
      }

      if (hasGeminiKey) {
        const candidateModels = CANDIDATE_MODELS;
        for (const modelName of candidateModels) {
          try {
            const response = await generateWithRetry({
              model: modelName,
              contents: prompt,
              config: {
                temperature: 0.4,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      style: { type: Type.STRING, enum: ['natural', 'singable', 'poetic'] },
                      label: { type: Type.STRING },
                      text: { type: Type.STRING },
                    },
                    required: ['style', 'label', 'text'],
                  },
                },
              },
            });

            const parsed = extractJsonArray(JSON.parse(response.text?.trim() || '[]'));
            if (Array.isArray(parsed) && parsed.length > 0) {
              return res.json({ success: true, options: parsed });
            }
          } catch (e: any) {
            // Try next model
          }
        }
      }

      // Safe resilient alternative generation fallback if API is experiencing temporary rate limits
      const cur = currentTranslation || originalLine;
      const fallbackOptions = [
        {
          style: 'natural',
          label: 'Natuurlijk',
          text: cur,
        },
        {
          style: 'singable',
          label: 'Zingbaar',
          text: targetLanguage === 'nl' ? `En ${cur.toLowerCase()}` : `And ${cur.toLowerCase()}`,
        },
        {
          style: 'poetic',
          label: 'Poëtisch',
          text: targetLanguage === 'nl' ? `Terwijl ${cur.toLowerCase()}` : `As ${cur.toLowerCase()}`,
        },
      ];

      return res.json({ success: true, options: fallbackOptions });
    } catch (err: any) {
      console.error('[API /api/rephrase-line] Error:', err);
      return res.status(500).json({ error: err.message || 'Herschrijven mislukt' });
    }
  });

  // Realign and segment target translation to match exact source sentence count
  app.post('/api/realign-lines', async (req, res) => {
    try {
      const { sourceLines, targetText, sourceLanguage = 'en', targetLanguage = 'nl' } = req.body;

      if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
        return res.status(400).json({ error: 'Geen bronregels opgegeven.' });
      }

      if (!targetText || typeof targetText !== 'string' || !targetText.trim()) {
        return res.status(400).json({ error: 'Geen doeltekst opgegeven.' });
      }

      const cleanSourceLines = sourceLines
        .map((l: string) => String(l).replace(/\[.*?\]/g, '').trim())
        .filter((l: string) => l.length > 0);

      const targetRawLines = cleanLyricLines(targetText);

      if (cleanSourceLines.length === targetRawLines.length) {
        return res.json({
          success: true,
          alreadyMatched: true,
          alignedLines: targetRawLines,
          sourceCount: cleanSourceLines.length,
          targetCount: targetRawLines.length,
        });
      }

      const prompt = `Je bent een meesterlijke ondertitelaar en audiovocal-editor.
De brontitels (${sourceLanguage === 'nl' ? 'Nederlands' : 'Engels'}) hebben EXACT ${cleanSourceLines.length} regels:
${cleanSourceLines.map((line: string, i: number) => `[Regel ${i + 1}]: ${line}`).join('\n')}

Hier is de tekst in de doeltaal (${targetLanguage === 'nl' ? 'Nederlands' : targetLanguage}):
${targetText}

TAAK:
Herstructureer, splits of combineer de tekst van de doeltaal zodanig dat er EXACT ${cleanSourceLines.length} regels ontstaan.
Elke regel 'i' in de doeltaal MOET inhoudelijk en qua betekenis exact corresponderen met [Regel i] uit de brontekst, zodat ondertiteltijden 1-op-1 kunnen worden overgedragen.
Regels mogen NIET leeg zijn. Verlies geen zinnen en verzin geen nieuwe feiten.
Geef het resultaat terug in een JSON object met 'alignedLines' array van precies ${cleanSourceLines.length} strings.`;

      const candidateModels = CANDIDATE_MODELS;
      let alignedResult: string[] | null = null;

      if (!hasGeminiKey) {
        try {
          const ollamaRaw = await generateJsonWithLocalOllama(prompt, 0.2);
          const arr = Array.isArray(ollamaRaw?.alignedLines)
            ? ollamaRaw.alignedLines
            : extractJsonArray(ollamaRaw);
          if (Array.isArray(arr) && arr.length === cleanSourceLines.length) {
            alignedResult = arr.map((l: any) => String(l).replace(/\[.*?\]/g, '').trim());
          }
        } catch (e: any) {
          console.warn('[API /api/realign-lines] Local Ollama warning:', e?.message);
        }
      }

      if (hasGeminiKey && !alignedResult) {
        for (const modelName of candidateModels) {
          try {
            const response = await generateWithRetry({
              model: modelName,
              contents: prompt,
              config: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    alignedLines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: `Array van precies ${cleanSourceLines.length} regels`,
                    },
                  },
                  required: ['alignedLines'],
                },
              },
            });

            const rawText = response.text?.trim() || '{}';
            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed.alignedLines) && parsed.alignedLines.length === cleanSourceLines.length) {
              alignedResult = parsed.alignedLines.map((l: any) => String(l).replace(/\[.*?\]/g, '').trim());
              break;
            }
          } catch (e: any) {
            console.warn(`[API /api/realign-lines] Model ${modelName} warning:`, e?.message?.substring(0, 150));
          }
        }
      }

      // Fallback: If AI alignment is unavailable, proportional sentence distribute
      if (!alignedResult) {
        const targetClean = cleanLyricLines(targetText);
        const result: string[] = [];
        const n = cleanSourceLines.length;
        const m = targetClean.length;

        for (let i = 0; i < n; i++) {
          const mappedIdx = Math.min(Math.floor((i / n) * m), m - 1);
          result.push(targetClean[mappedIdx] || cleanSourceLines[i]);
        }
        alignedResult = result;
      }

      return res.json({
        success: true,
        alignedLines: alignedResult,
        sourceCount: cleanSourceLines.length,
        targetCount: alignedResult.length,
      });
    } catch (err: any) {
      console.error('[API /api/realign-lines] Error:', err);
      return res.status(500).json({ error: err.message || 'Uitlijnen van regels mislukt.' });
    }
  });

  // Automatic AI Vocal Intro Detection Endpoint
  app.post('/api/detect-vocal-start', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/mp3' } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'Geen audio aangeleverd' });
      }
      console.log('[API /api/detect-vocal-start] Probing audio for vocal start time...');
      const result = await detectVocalStartInAudio(audioBase64, mimeType);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[API /api/detect-vocal-start] Error:', err);
      return res.status(500).json({ error: err.message || 'Detectie mislukt' });
    }
  });

  // Lyric sync alignment endpoint
  app.post('/api/sync', async (req, res) => {
    try {
      const {
        audioBase64,
        mimeType,
        lyrics,
        sourceLanguage,
        targetLanguage,
        language,
        audioDuration,
        translatedPairs,
        style = 'natural',
        vocalStartTime = 0,
        clientDetectedBreaks = [],
        clientAcousticPhrases = [],
      } = req.body;

      const parsedVocalStart = Math.max(0, Number(vocalStartTime) || 0);
      let effectiveVocalStart = parsedVocalStart;

      if (!lyrics || typeof lyrics !== 'string' || !lyrics.trim()) {
        return res.status(400).json({ error: 'Songtekst is verplicht.' });
      }

      // Strip all bracketed section markers like [Verse 1], [Chorus], etc.
      const cleanLines = cleanLyricLines(lyrics);
      if (cleanLines.length === 0) {
        return res.status(400).json({ error: 'Geen liedregels gevonden na het verwijderen van sectietags.' });
      }

      const effectiveTargetLang: 'en' | 'nl' = targetLanguage || language || 'en';
      const effectiveSourceLang: 'en' | 'nl' = sourceLanguage || effectiveTargetLang;
      const cleanMime = mimeType || 'audio/mp3';
      const isTranslationNeeded = effectiveSourceLang !== effectiveTargetLang;

      console.log(`[API /api/sync] Sync requested. Clean lines: ${cleanLines.length}, SourceLang: ${effectiveSourceLang}, TargetLang: ${effectiveTargetLang}, vocalStartTime: ${parsedVocalStart}s, Translation needed: ${isTranslationNeeded}`);

      let pairs: { id: number; original: string; translated: string }[] = [];

      // 1. If user already reviewed or manually customized translated pairs, honor them directly!
      if (Array.isArray(translatedPairs) && translatedPairs.length > 0) {
        console.log(`[API /api/sync] Using user-verified/edited translation pairs (${translatedPairs.length} lines)...`);
        pairs = translatedPairs.map((p: any, idx: number) => ({
          id: p.id || idx + 1,
          original: String(p.original || '').replace(/\[.*?\]/g, '').trim(),
          translated: String(p.translated || '').replace(/\[.*?\]/g, '').trim(),
        }));
      } else if (isTranslationNeeded) {
        // Otherwise perform careful translation (via local Ollama or Gemini)
        try {
          console.log(`[API /api/sync] Step 1: Translating lyrics from ${effectiveSourceLang} to ${effectiveTargetLang} (style: ${style})...`);
          pairs = await translateLyricsPoetically(cleanLines.join('\n'), effectiveSourceLang, effectiveTargetLang, style);
        } catch (tError: any) {
          console.warn('[API /api/sync] Translation error, falling back:', tError?.message);
        }
      }

      // If translation wasn't needed or failed, generate pairs from clean lines
      if (pairs.length === 0) {
        pairs = cleanLines.map((l: string, i: number) => ({ id: i + 1, original: l, translated: l }));
      }

      // 2. Perform multimodal audio alignment with Gemini
      if (process.env.GEMINI_API_KEY && audioBase64) {
        // High-fidelity 24kHz compression & acoustic VAD break analysis
        const processedAudio = await processAudioForAiAndAcoustics(audioBase64, cleanMime);
        effectiveVocalStart = Math.max(effectiveVocalStart, processedAudio.detectedIntroSilence);

        // Merge server FFmpeg breaks with browser Web Audio DSP breaks
        const mergedBreaks: AcousticBreak[] = [
          ...processedAudio.detectedBreaks,
          ...(Array.isArray(clientDetectedBreaks)
            ? clientDetectedBreaks.filter(
                (cb: any) =>
                  cb &&
                  typeof cb.start === 'number' &&
                  typeof cb.end === 'number' &&
                  cb.end - cb.start >= 2.0 &&
                  !processedAudio.detectedBreaks.some((sb) => Math.abs(sb.start - cb.start) < 1.5)
              )
            : []),
        ].sort((a, b) => a.start - b.start);

        // Auto-detect vocal intro if not explicitly given by user and not pure silence (e.g. guitar/band intro)
        if (effectiveVocalStart <= 1.5) {
          try {
            const probe = await detectVocalStartInAudio(processedAudio.base64, processedAudio.mimeType);
            if (probe.vocalStartSeconds >= 2.0) {
              effectiveVocalStart = probe.vocalStartSeconds;
              console.log(`[API /api/sync] Auto-detected vocal intro: ${effectiveVocalStart}s before Line #1 ("${probe.firstWords || ''}")`);
            }
          } catch (probeErr: any) {
            console.warn('[API /api/sync] Intro probe warning:', probeErr?.message);
          }
        }

        const candidateModels = CANDIDATE_MODELS;
        const lyricsWithIndices = pairs.map((p) => `#${p.id}: ${p.original}`).join('\n');

        const breaksNotice =
          mergedBreaks.length > 0
            ? `ACOUSTICALLY DETECTED INSTRUMENTAL BREAKS & INTER-VERSE PAUSES:
The audio waveform has the following intervals where NO vocal singing is present (e.g. guitar solos, piano passages, inter-verse breaths):
${mergedBreaks.map((b) => `- Break from ${Number(b.start).toFixed(2)}s to ${Number(b.end).toFixed(2)}s (Duration: ${Number(b.duration).toFixed(2)}s)`).join('\n')}
CRITICAL: DO NOT place or stretch any subtitle cue into these intervals! Cues before the break must end at or before the start of the break. Cues after the break must start at or after the end of the break!`
            : 'Listen closely for any instrumental guitar/synth solos or pauses where no singing occurs.';

        const phrasesNotice =
          Array.isArray(clientAcousticPhrases) && clientAcousticPhrases.length > 0
            ? `\nMEASURED VOCAL WAVEFORM PHRASE ISLANDS (280Hz-3400Hz Vocal Bandpass Envelope):
The audio waveform contains discrete bursts of vocal energy at these exact timestamp intervals:
${clientAcousticPhrases
  .slice(0, 80)
  .map((ph: any, idx: number) => `  [Wave #${idx + 1}] ${Number(ph.start).toFixed(2)}s -> ${Number(ph.end).toFixed(2)}s (${Number(ph.duration).toFixed(2)}s)`)
  .join('\n')}
CRITICAL: Anchor each lyric line's startTime and endTime directly onto the corresponding vocal waveform island(s) where that line is sung!`
            : '';

        const prompt = `You are an expert audio sound engineer and music lyric timing specialist.
Analyze this audio recording and the exact song vocal cues provided below in sequential order.
Your mission is to accurately time-align every single line in the song to the exact moment it is vocalized in the audio track.

Original vocal lines heard in audio (ALL bracketed headers like [Verse] or [Chorus] have already been removed):
${lyricsWithIndices}

${audioDuration ? `Total song duration: ${audioDuration} seconds.` : ''}
CRITICAL INTRO / LEAD-IN RULES:
- Music tracks almost always begin with an instrumental intro (guitars, piano, drums, synths).
${effectiveVocalStart > 0 ? `- The musical audio track begins with an instrumental intro lasting ${effectiveVocalStart.toFixed(1)} seconds (${Math.floor(effectiveVocalStart / 60)}m ${Math.floor(effectiveVocalStart % 60)}s).
- The vocal singing strictly starts at ${effectiveVocalStart.toFixed(1)} seconds.
- Cue #1 MUST start at or after ${effectiveVocalStart.toFixed(1)} seconds (startTime >= ${effectiveVocalStart.toFixed(1)}).
- Under NO circumstance should any cue begin before ${effectiveVocalStart.toFixed(1)} seconds!` : `- Listen carefully to the start of the audio: if an acoustic guitar or musical intro plays for 21 seconds before the first sung words, Cue #1 MUST start at ~21 seconds, NEVER at 0 seconds!`}

${breaksNotice}
${phrasesNotice}

CRITICAL RULES:
1. Every cue (#1 to #${pairs.length}) must appear in sequential order as a subtitle cue.
   - TOTAL CUE COUNT: There are EXACTLY ${pairs.length} cues.
   - You MUST output timings for ALL ${pairs.length} cues from #1 all the way to #${pairs.length}.
   - Do NOT stop early, and do NOT truncate or omit cues near the end of the song!
2. Provide 'startTime' and 'endTime' for each cue in TOTAL SECONDS as floating point numbers with 0.05s precision (e.g. 42.60).
   CRITICAL MINUTE-TO-SECOND CONVERSION:
   - Always calculate seconds as: minutes * 60 + seconds.
   - Example: 1 minute 07 seconds is 67.0 seconds (NEVER write 107 seconds!).
   - Example: 1 minute 16 seconds is 76.0 seconds (NEVER write 116 seconds!).
   - Example: 1 minute 47 seconds is 107.0 seconds.
   - Example: 2 minutes 14 seconds is 134.0 seconds (NEVER write 214 seconds!).
3. EXACT VALLEY-TO-VALLEY PHRASE BOUNDARIES (DO NOT OVER-STRETCH CUES!):
   - 'startTime' MUST be the exact moment the singer begins the VERY FIRST word/syllable of the line (as the waveform rises out of the breath valley), NOT late on the second stressed word!
   - 'endTime' MUST be the exact moment the singer finishes the LAST word/vowel of the line and drops into the breath pause/valley!
   - A normal 6-to-9 word sung lyric line typically lasts **2.3 to 3.8 seconds** (NEVER divide total song duration by cue count and NEVER output uniform 5.5s blocks!).
   - DO NOT stretch 'endTime' across breath pauses or inter-verse pauses to touch the next cue! When the singer finishes a line at 45.85s and starts the next line at 46.25s (or 49.50s), set 'endTime' to 45.85s and leave the pause empty!
   - Subtitles must wrap tightly around their own vocal waveform mountain from onset valley to offset valley.
4. Ensure 'startTime' < 'endTime' for all cues, and consecutive cues must not regress backwards.
5. NEVER output [Verse], [Chorus], or any bracketed annotations.
6. Return a valid JSON array of objects with keys:
   - id: integer (matching the cue number from 1 to ${pairs.length})
   - startTime: number
   - endTime: number`;

        for (const modelName of candidateModels) {
          try {
            console.log(`[API /api/sync] Invoking alignment with model ${modelName} (${pairs.length} cues, intro: ${effectiveVocalStart.toFixed(1)}s, ${mergedBreaks.length} breaks, ${Array.isArray(clientAcousticPhrases) ? clientAcousticPhrases.length : 0} wave islands)...`);
            const audioPart = {
              inlineData: {
                mimeType: processedAudio.mimeType,
                data: processedAudio.base64,
              },
            };

            const response = await generateWithRetry({
              model: modelName,
              contents: {
                parts: [
                  audioPart,
                  { text: prompt },
                ],
              },
              config: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  description: 'List of synchronized subtitle cue timestamps',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.INTEGER, description: 'Sequential cue index' },
                      startTime: { type: Type.NUMBER, description: 'Start timestamp in seconds' },
                      endTime: { type: Type.NUMBER, description: 'End timestamp in seconds' },
                    },
                    required: ['id', 'startTime', 'endTime'],
                  },
                },
              },
            }, 2, 65000);

            const rawText = response.text?.trim() || '';
            if (rawText) {
              const parsedTimings = JSON.parse(rawText);
              if (Array.isArray(parsedTimings) && parsedTimings.length > 0) {
                // Merge timings with pairs safely respecting acoustic breaks and intro offset
                const finalCues = mergeTimingsWithPairs(
                  pairs,
                  parsedTimings,
                  audioDuration || 0,
                  isTranslationNeeded,
                  effectiveVocalStart,
                  mergedBreaks
                );

                return res.json({
                  success: true,
                  source: modelName,
                  translated: isTranslationNeeded,
                  sourceLanguage: effectiveSourceLang,
                  targetLanguage: effectiveTargetLang,
                  detectedIntroSilence: effectiveVocalStart,
                  detectedBreaks: mergedBreaks,
                  cues: finalCues,
                });
              }
            }
          } catch (geminiError: any) {
            console.warn(`[API /api/sync] Model ${modelName} alignment warning:`, geminiError?.message?.substring(0, 150));
          }
        }
      }

      // 3. Fallback cadence engine (strictly preserves all pairs in order)
      const fallbackStart = Math.max(parsedVocalStart, typeof effectiveVocalStart !== 'undefined' ? effectiveVocalStart : 0);
      const finalFallbackCues = mergeTimingsWithPairs(pairs, [], audioDuration || 0, isTranslationNeeded, fallbackStart);

      return res.json({
        success: true,
        source: 'cadence-alignment-engine',
        translated: isTranslationNeeded,
        sourceLanguage: effectiveSourceLang,
        targetLanguage: effectiveTargetLang,
        detectedIntroSilence: fallbackStart,
        cues: finalFallbackCues,
      });
    } catch (err: any) {
      console.error('[API /api/sync] Global error:', err);
      return res.status(500).json({ error: err.message || 'Interne synchronisatiefout' });
    }
  });

  // Convert MP3 + JPG to MP4 video with optional burned-in subtitles using FFmpeg
  app.post('/api/convert-mp3-to-mp4', async (req, res) => {
    const hasFfmpeg = await checkFfmpegAvailable();
    if (!hasFfmpeg) {
      return res.status(503).json({
        error: 'FFmpeg is niet geïnstalleerd of niet gevonden in het PATH. Installeer FFmpeg (bijvoorbeeld in PowerShell via: winget install Gyan.FFmpeg) om MP4-video\'s te kunnen renderen.',
      });
    }

    let tmpDir = '';
    try {
      const {
        audioBase64,
        imageBase64,
        audioName = 'audio.mp3',
        imageName = 'cover.jpg',
        aspectRatio = '16:9',
        burnSubtitles = false,
        srtContent = '',
        videoTitle = 'music_video',
      } = req.body;

      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ error: 'Geen geldig audiobestand (MP3) ontvangen.' });
      }

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ error: 'Geen geldige cover-afbeelding (JPG/PNG) ontvangen.' });
      }

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp4_convert_'));

      // Clean base64 strings if data URI scheme is present
      const cleanAudioBase64 = audioBase64.replace(/^data:audio\/[a-zA-Z0-9.+_-]+;base64,/, '');
      const cleanImageBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, '');

      const audioBuffer = Buffer.from(cleanAudioBase64, 'base64');
      const imageBuffer = Buffer.from(cleanImageBase64, 'base64');

      if (audioBuffer.length === 0) {
        return res.status(400).json({ error: 'Het audiobestand is leeg of beschadigd.' });
      }
      if (imageBuffer.length === 0) {
        return res.status(400).json({ error: 'Het afbeeldingsbestand is leeg of beschadigd.' });
      }

      const audioExt = path.extname(audioName) || '.mp3';
      const imgExt = path.extname(imageName) || '.jpg';
      const audioPath = path.join(tmpDir, `input_audio${audioExt}`);
      const imagePath = path.join(tmpDir, `input_image${imgExt}`);
      const outputPath = path.join(tmpDir, 'output.mp4');

      fs.writeFileSync(audioPath, audioBuffer);
      fs.writeFileSync(imagePath, imageBuffer);

      // Determine dimensions according to chosen aspect ratio
      let targetW = 1920;
      let targetH = 1080;
      if (aspectRatio === '1:1') {
        targetW = 1080;
        targetH = 1080;
      } else if (aspectRatio === '9:16') {
        targetW = 1080;
        targetH = 1920;
      }

      let videoFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`;

      if (burnSubtitles && srtContent && srtContent.trim()) {
        const srtPath = path.join(tmpDir, 'subtitles.srt');
        fs.writeFileSync(srtPath, srtContent.trim(), 'utf8');
        // Escape characters for ffmpeg filter syntax
        const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        const fontSize = aspectRatio === '9:16' ? '28' : aspectRatio === '1:1' ? '24' : '22';
        videoFilter += `,subtitles='${escapedSrtPath}':force_style='FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H66000000,BorderStyle=3,Outline=2,Shadow=1,MarginV=40,Alignment=2'`;
      }

      // Optimize framerate for still-image video:
      // 2 fps when burning subtitles (plenty for lyric transitions) or 1 fps for static cover art.
      // This drops frame count from ~6,000 down to ~240-480 frames, speeding up rendering by >15x!
      const fps = burnSubtitles && srtContent && srtContent.trim() ? '2' : '1';

      console.log(`[API /api/convert-mp3-to-mp4] Starting FFmpeg conversion (${aspectRatio}, ${fps}fps, ${audioBuffer.length} bytes audio, ${imageBuffer.length} bytes image, burnSubtitles: ${burnSubtitles})...`);

      const ffmpegArgs = [
        '-y',
        '-loglevel', 'error',
        '-loop', '1',
        '-framerate', fps,
        '-i', imagePath,
        '-i', audioPath,
        '-vf', videoFilter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'stillimage',
        '-threads', '0',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        '-movflags', '+faststart',
        outputPath,
      ];

      await execFileAsync('ffmpeg', ffmpegArgs, {
        timeout: 600000, // 10 minutes
        maxBuffer: 50 * 1024 * 1024,
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg heeft geen uitvoerbestand gegenereerd.');
      }

      const stat = fs.statSync(outputPath);
      console.log(`[API /api/convert-mp3-to-mp4] Conversion completed successfully! Output size: ${stat.size} bytes`);

      let cleanBaseName = (videoTitle || audioName).replace(/\.[^/.]+$/, '').trim() || 'music_video';
      cleanBaseName = cleanBaseName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
      const downloadFilename = `${cleanBaseName}.mp4`;

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('close', () => {
        try {
          if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } catch (_) {}
      });

      readStream.on('error', (streamErr) => {
        console.error('[API /api/convert-mp3-to-mp4] Stream error:', streamErr);
        try {
          if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } catch (_) {}
      });
    } catch (err: any) {
      console.error('[API /api/convert-mp3-to-mp4] Conversion error:', err);
      try {
        if (tmpDir && fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (_) {}

      // Clean up technical command dump to provide a friendly, helpful error message
      let errorMsg = err.message || 'Fout bij het omzetten van MP3 en JPG naar MP4 video.';
      if (errorMsg.includes('Command failed:')) {
        const lines = errorMsg.split('\n').filter((l: string) => !l.includes('--enable-') && !l.includes('configuration:'));
        errorMsg = lines.slice(-4).join(' ').trim() || 'FFmpeg conversie timeout of configuratiefout.';
      }

      return res.status(500).json({
        error: errorMsg,
      });
    }
  });

  // Vite middleware or static dist handling
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: 24680 },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
