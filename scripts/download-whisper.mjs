// Downloads the Whisper model files used for local (offline) lyric alignment
// into public/models so the browser loads them from localhost.
// Usage: node scripts/download-whisper.mjs
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const REPO = 'onnx-community/whisper-base_timestamped';
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

const targetDir = path.resolve('public', 'models', REPO);

for (const file of FILES) {
  const dest = path.join(targetDir, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`✓ ${file} (al aanwezig)`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${REPO}/resolve/main/${file}`;
  process.stdout.write(`↓ ${file} ... `);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download mislukt (${res.status}): ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
  console.log(`${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
}
// Copy the ONNX Runtime WebAssembly files so nothing is fetched from a CDN at runtime
const ortSrc = path.resolve('node_modules', 'onnxruntime-web', 'dist');
const ortDest = path.resolve('public', 'ort');
fs.mkdirSync(ortDest, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  fs.copyFileSync(path.join(ortSrc, f), path.join(ortDest, f));
  console.log(`✓ ONNX runtime: ${f}`);
}

console.log(`\nKlaar! Model staat in ${targetDir}`);
