import test from 'node:test';
import assert from 'node:assert/strict';
import { patchMenu, patchVite, patchVercel, READER_CSP } from '../../scripts/readalong-install.mjs';
const menu = "import { OpfsInspector } from './OpfsInspector'\nconst items = [\n    { label: 'Storage', run: () => setInspector(true) },\n]";
const vite = "// @ts-expect-error\n    server.middlewares.use('/api/summarise', webhook(() => import('./api/summarise.mjs')))";
const config = { functions: { 'api/pdf.mjs': { maxDuration: 60 } }, rewrites: [{ source: '/((?!api/).*)', destination: '/__spa-fallback.html' }], headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Permissions-Policy', value: 'microphone=()' }] }] };
test('menu patch is surgical and idempotent', () => { const patched = patchMenu(menu); assert.match(patched, /openReadAlong/); assert.equal(patchMenu(patched), patched); assert.throws(() => patchMenu('changed')); });
test('Vite patch reuses existing Node handler adapter', () => { const patched = patchVite(vite); assert.match(patched, /api\/readalong/); assert.equal(patchVite(patched), patched); assert.throws(() => patchVite('changed')); });
test('only the reader becomes frameable and avoids SPA fallback', () => {
  const patched = patchVercel(JSON.stringify(config)), result = JSON.parse(patched);
  assert.equal(patchVercel(patched), patched);
  assert.equal(result.functions['api/pdf.mjs'].maxDuration, 60);
  assert.equal(result.rewrites[0].source, '/((?!api/|readalong/).*)');
  assert.equal(result.headers.find(h => h.source === '/((?!readalong/).*)').headers[0].value, 'DENY');
  assert.equal(result.headers.find(h => h.source === '/readalong/(.*)').headers[0].value, 'SAMEORIGIN');
  assert.ok(READER_CSP.includes("media-src 'self' blob:")); assert.ok(READER_CSP.includes("script-src 'self'"));
});

test('the checked-in deployment config frames only reader assets and leaves the document shell styled', async () => {
  const { readFile } = await import('node:fs/promises');
  const result = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const headersFor = path => result.headers.filter(rule => new RegExp(`^${rule.source}$`).test(path)).flatMap(rule => rule.headers);
  const fallback = result.rewrites.find(rule => rule.destination === '/__spa-fallback.html');
  assert.ok(fallback);
  for (const path of ['/readalong/index.html', '/readalong/app.mjs', '/readalong/reader.css']) {
    assert.equal(new RegExp(`^${fallback.source}$`).test(path), false);
    const headers = headersFor(path);
    assert.deepEqual(headers.filter(h => h.key === 'X-Frame-Options').map(h => h.value), ['SAMEORIGIN']);
    const csp = headers.find(h => h.key === 'Content-Security-Policy')?.value;
    assert.ok(csp?.includes("frame-ancestors 'self'"));
    assert.ok(csp?.includes("media-src 'self' blob:"));
    assert.ok(csp?.includes("connect-src 'self'"));
  }
  for (const path of ['/', '/about', '/privacy', '/verify', '/api/readalong', '/readalong-other/index.html']) {
    assert.deepEqual(headersFor(path).filter(h => h.key === 'X-Frame-Options').map(h => h.value), ['DENY']);
  }
  const shell = await readFile(new URL('../../app/root.tsx', import.meta.url), 'utf8');
  assert.match(shell, /index\.css\?url/);
  assert.match(shell, /rel: ['"]stylesheet['"]/);
});

test('the installed parent service worker never intercepts credential-bearing POSTs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const listeners = {};
  runInNewContext(await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    self: { location: { href: 'https://iwzero.me/sw.js?v=test', origin: 'https://iwzero.me' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  });
  let intercepted = false;
  listeners.fetch({ request: { method: 'POST', url: 'https://iwzero.me/api/readalong' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
