import { pipeline, env, read_audio } from '@huggingface/transformers';
import path from 'path';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.resolve('public', 'models') + '/';

console.log('Loading pipeline...');
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
  dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
});

console.log('Reading audio via read_audio...');
const mp3Path = path.resolve('public/assets/aistudio/Scarlet_and_Chlorine_d87bb67e.mp3');
const float32 = await read_audio(mp3Path, 16000);

console.log(`Audio duration: ${(float32.length / 16000).toFixed(1)}s`);

// Transcribe slice from 42s to 56s
const startSample = 42 * 16000;
const endSample = 56 * 16000;
const slice = float32.subarray(startSample, endSample);

const res = await asr(slice, {
  return_timestamps: 'word',
  language: 'english',
  task: 'transcribe',
});

console.log('Transcription from 42s to 56s:');
for (const c of res.chunks || []) {
  const ts = c.timestamp;
  console.log(`[${(42 + ts[0]).toFixed(2)} - ${(42 + ts[1]).toFixed(2)}] ${c.text}`);
}
