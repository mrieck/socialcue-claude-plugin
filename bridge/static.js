/**
 * Serve the built dashboard (dashboard/dist) — static files with a path-traversal
 * guard and an index.html fallback for any non-file, non-/api path.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

export function serveStatic(req, res, urlPath, distDir) {
  if (!fs.existsSync(distDir)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Dashboard not built. Run: npm run dashboard:build\n');
    return;
  }

  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  let file = path.resolve(distDir, rel || 'index.html');
  // Traversal guard: the resolved path must stay inside distDir.
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden\n');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, 'index.html'); // SPA fallback
  }

  const type = MIME[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
