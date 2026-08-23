/**
 * Local OCR for the read_image_text tool — tesseract-wasm running in a Node
 * worker thread. Fully local: the wasm runtime resolves from node_modules and
 * the English model ships committed in ./ocr-assets/ (refresh with
 * scripts/fetch-ocr-assets.mjs). No pixels or text ever leave the machine.
 *
 * Ported from the extension's offscreen OCR (socialcue-extension
 * src/offscreen/main.ts + the enrichWithOcr filters in background/index.ts) so
 * both sensors read images the same way.
 *
 * tesseract-wasm and pngjs are imported lazily: a user who upgraded the plugin
 * snapshot without re-running npm install gets a per-call "OCR unavailable"
 * error instead of a dead MCP server (same posture as the bridge's lazy
 * patchright import).
 */
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MODEL_PATH = fileURLToPath(new URL('./ocr-assets/eng.traineddata', import.meta.url));
const INIT_TIMEOUT_MS = 20_000; // wasm init + 4MB model load (~1-2s typical)
const IMAGE_TIMEOUT_MS = 10_000; // per image; the extension budgets 45s per batch
const MIN_CHARS = 8;
const MAX_CHARS = 1500;
// Element screenshots are viewport-bounded so this only trips on pathological
// pages; skipping beats pure-JS resampling at the "lossy hint" quality bar.
const MAX_PIXELS = 8_000_000;

let clientPromise = null;

/** Serialize jobs: the engine holds one image at a time, so interleaved
 *  loadImage/getText calls from concurrent tool calls would cross results. */
let jobQueue = Promise.resolve();

export function modelAvailable() {
  return fs.existsSync(MODEL_PATH);
}

export function missingModelError() {
  return new Error(
    `OCR unavailable — eng.traineddata missing at ${MODEL_PATH}. ` +
      'Run `node scripts/fetch-ocr-assets.mjs` in the plugin directory (or reinstall the plugin).',
  );
}

function getClient() {
  clientPromise ??= (async () => {
    const { createOCRClient } = await import('tesseract-wasm/node');
    const { Worker } = await import('node:worker_threads');
    const client = createOCRClient({
      // unref so an idle OCR worker can never keep the server process alive;
      // the stdio transport keeps the loop referenced while the server runs.
      createWorker: (url) => {
        const worker = new Worker(new URL(url));
        worker.unref();
        return worker;
      },
    });
    try {
      // loadModel must get a buffer: its string branch fetch()es, which
      // doesn't resolve plain file paths in Node.
      await client.loadModel(await readFile(MODEL_PATH));
    } catch (e) {
      client.destroy().catch(() => {});
      throw e;
    }
    return client;
  })();
  return clientPromise;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Cheap junk filter for OCR output (verbatim from the extension). Photo-heavy
 * media produces fragments like `L "Neurodivergent/mannequins} eee` — noise
 * that reads as content but isn't. Accept text only when most tokens are
 * word-shaped; garbled-but-real text ("FOUR O'CLOCK IN THE MORNING") clears
 * the bar, symbol soup doesn't.
 */
export function looksLikeText(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const wordish = tokens.filter((t) => {
    const stripped = t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    return stripped.length >= 2 && /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(stripped);
  });
  return wordish.length >= 3 && wordish.length / tokens.length >= 0.55;
}

/**
 * Decode a PNG buffer into the `{data, width, height}` RGBA shape the engine
 * wants. The copy into a fresh Uint8Array is load-bearing: the engine wraps
 * the ENTIRE underlying ArrayBuffer at offset 0 (`new Uint32Array(data.buffer)`),
 * and pngjs Buffers can be views into Node's shared pool.
 */
export async function decodePng(buffer) {
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(buffer);
  if (png.width * png.height > MAX_PIXELS) {
    throw new Error(`image too large for OCR (${png.width}x${png.height})`);
  }
  return { data: new Uint8Array(png.data), width: png.width, height: png.height };
}

/**
 * OCR one RGBA bitmap → filtered text, or '' when nothing readable was found
 * (including on any failure — callers treat '' as "no text", never an error).
 * Init failures reset the lazy client so the next call can retry; a getText
 * timeout also destroys the (possibly wedged) worker before resetting.
 */
export function recognize(image) {
  const job = jobQueue.then(async () => {
    let client;
    try {
      client = await withTimeout(getClient(), INIT_TIMEOUT_MS, 'OCR init');
    } catch {
      clientPromise = null;
      return '';
    }
    try {
      await client.loadImage(image);
      const raw = await withTimeout(client.getText(), IMAGE_TIMEOUT_MS, 'OCR');
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text.length < MIN_CHARS || !looksLikeText(text)) return '';
      return text.slice(0, MAX_CHARS);
    } catch (err) {
      if (/timed out/i.test(String(err))) {
        client.destroy().catch(() => {});
        clientPromise = null;
      }
      return '';
    }
  });
  jobQueue = job.catch(() => {});
  return job;
}

/** Tear down the worker thread (server shutdown). */
export async function destroyOCR() {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  const client = await pending.catch(() => null);
  if (client) await client.destroy().catch(() => {});
}
