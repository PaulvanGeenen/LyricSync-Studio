/// <reference lib="webworker" />
/**
 * Web Worker that runs Whisper speech recognition locally in the browser (no API key).
 * Receives 16 kHz mono audio and returns word-level timestamps.
 */
import { pipeline, env } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/whisper-base_timestamped';

// Load everything from our own localhost (downloaded via `npm run download-model`)
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm',
  };
}

export interface WhisperWord {
  text: string;
  start: number;
  end: number;
}

let asrPromise: Promise<any> | null = null;

function getAsr() {
  if (!asrPromise) {
    asrPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } as any,
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          self.postMessage({ type: 'model-progress', file: p.file, progress: p.progress });
        }
      },
    }).catch((err) => {
      asrPromise = null;
      throw err;
    });
  }
  return asrPromise;
}

const SAMPLE_RATE = 16000;
const WINDOW_SEC = 30;
const STEP_SEC = 26; // 4s overlap so words at window edges are not lost

self.onmessage = async (e: MessageEvent) => {
  const { audio, language } = e.data as { audio: Float32Array; language: 'nl' | 'en' };
  try {
    self.postMessage({ type: 'status', text: 'Whisper-model laden...' });
    const asr = await getAsr();

    const totalSec = audio.length / SAMPLE_RATE;
    const windows: number[] = [];
    for (let s = 0; s < totalSec; s += STEP_SEC) {
      windows.push(s);
      if (s + WINDOW_SEC >= totalSec) break;
    }

    const words: WhisperWord[] = [];
    for (let w = 0; w < windows.length; w++) {
      const winStart = windows[w];
      self.postMessage({ type: 'transcribe-progress', done: w, total: windows.length });

      const startSample = Math.floor(winStart * SAMPLE_RATE);
      const endSample = Math.min(audio.length, Math.floor((winStart + WINDOW_SEC) * SAMPLE_RATE));
      const slice = audio.subarray(startSample, endSample);

      const out = await asr(slice, {
        language: language === 'nl' ? 'dutch' : 'english',
        task: 'transcribe',
        return_timestamps: 'word',
      });

      // Only keep words from the non-overlapping core of this window
      const keepFrom = w === 0 ? 0 : winStart + (WINDOW_SEC - STEP_SEC) / 2;
      const keepTo = w === windows.length - 1 ? Infinity : winStart + STEP_SEC + (WINDOW_SEC - STEP_SEC) / 2;

      for (const c of out?.chunks || []) {
        const ts = c.timestamp || [];
        const s = typeof ts[0] === 'number' ? ts[0] + winStart : null;
        let en = typeof ts[1] === 'number' ? ts[1] + winStart : null;
        if (s === null) continue;
        if (en === null || en < s) en = s + 0.3;
        if (s < keepFrom || s >= keepTo) continue;
        const text = String(c.text || '').trim();
        if (text) words.push({ text, start: s, end: en });
      }
    }

    self.postMessage({ type: 'transcribe-progress', done: windows.length, total: windows.length });
    self.postMessage({ type: 'result', words });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
