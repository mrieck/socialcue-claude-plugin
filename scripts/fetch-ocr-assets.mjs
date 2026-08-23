/**
 * Download the English OCR model into mcp/browser-server/ocr-assets/ for the
 * local read_image_text tool. The wasm runtime itself ships inside the
 * tesseract-wasm npm package — only the model needs fetching.
 *
 * The model is committed to the repo, so users never run this; it exists to
 * refresh the file (delete it first to force a re-download):
 *   node scripts/fetch-ocr-assets.mjs
 *
 * eng.traineddata comes from the tessdata_fast repo (Apache-2.0).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(root, '../mcp/browser-server/ocr-assets');
const TRAINEDDATA_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata';

await mkdir(dest, { recursive: true });

const trainedPath = path.join(dest, 'eng.traineddata');
const exists = await stat(trainedPath).then((s) => s.size > 1_000_000, () => false);
if (exists) {
  console.log('eng.traineddata already present — skipping download');
} else {
  const res = await fetch(TRAINEDDATA_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download eng.traineddata: HTTP ${res.status}`);
  await writeFile(trainedPath, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded eng.traineddata');
}
