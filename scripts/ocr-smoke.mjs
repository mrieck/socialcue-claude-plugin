/**
 * Engine smoke test for mcp/browser-server/ocr.js (no browser needed):
 *   node scripts/ocr-smoke.mjs <image.png> [--expect "some words"]
 *
 * Runs recognition twice (cold = wasm + model load, warm = engine reuse),
 * prints the text and timings, and exits 1 if --expect isn't found
 * (case-insensitive). The process exiting cleanly is itself part of the test:
 * the OCR worker must not keep Node alive after destroyOCR().
 */
import { readFile } from 'node:fs/promises';
import * as ocr from '../mcp/browser-server/ocr.js';

const [, , file, ...rest] = process.argv;
if (!file) {
  console.error('usage: node scripts/ocr-smoke.mjs <image.png> [--expect "some words"]');
  process.exit(1);
}
const expectIdx = rest.indexOf('--expect');
const expected = expectIdx >= 0 ? rest[expectIdx + 1] : null;

if (!ocr.modelAvailable()) throw ocr.missingModelError();

const image = await ocr.decodePng(await readFile(file));
console.log(`decoded ${image.width}x${image.height}`);

for (const label of ['cold', 'warm']) {
  const start = Date.now();
  const text = await ocr.recognize(image);
  console.log(`${label}: ${Date.now() - start}ms\n  ${text || '(no readable text)'}`);
  if (label === 'warm' && expected && !text.toLowerCase().includes(expected.toLowerCase())) {
    console.error(`FAIL: expected text to contain "${expected}"`);
    await ocr.destroyOCR();
    process.exit(1);
  }
}

await ocr.destroyOCR();
console.log('OK');
