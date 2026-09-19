#!/usr/bin/env node
/** Dependency-free standalone preview. Does not start or alter the Inkwave editor. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/readalong.mjs';
import localHandler from './readalong-local.mjs';
import { READER_CSP } from './readalong-install.mjs';
await import('./readalong-vendor.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/api/readalong') { await handler(req, res); return; }
  if (url.pathname === '/api/readalong-local') { await localHandler(req, res); return; }
  if (url.pathname === '/') { res.writeHead(302, { Location: '/readalong/index.html' }); res.end(); return; }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); res.end(); return; }
  if (!['readalong', 'pdfjs'].some(folder => file.startsWith(path.join(root, folder) + path.sep))) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(file);
    const type = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Content-Security-Policy': READER_CSP, 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Read along preview: http://127.0.0.1:${port}/readalong/index.html\nNo API calls are made until you explicitly connect or render. Ctrl+C stops this server.`));
