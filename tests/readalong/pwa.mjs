#!/usr/bin/env node
/** Isolated Chromium worker/cache smoke; no credentials, provider calls or real narration. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { exportBook } from '../../public/readalong/archive.mjs';
import { digest, splitChunks, cacheKey } from '../../public/readalong/core.mjs';

const base = process.env.READALONG_BASE_URL || 'http://localhost:5173';
function silentWav(seconds = 18) {
  const rate = 8000, bytes = rate * seconds * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(bytes + 36, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data;
}
const text = 'This synthetic listening book proves saved audio can play while the browser is offline.';
const book = { id: await digest(text), text, title: 'Offline worker fixture' };
const profile = { voiceId: 'testvoice1234', voiceName: 'Silent fixture', model: 'eleven_v3', delivery: 'steady' };
const chunks = splitChunks(text);
const asset = { id: await cacheKey(chunks[0], profile), blob: new Blob([silentWav()], { type: 'audio/wav' }), mode: 'passage', words: [] };
const archive = await exportBook(book, profile, chunks, { chunk: 0, time: 0, marks: [] }, asset, { async get() { return null; } });
const browser = await chromium.launch({ headless: true, ...(process.env.READALONG_CHROME ? { executablePath: process.env.READALONG_CHROME } : {}) });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [], apiRequests = [], externalRequests = [];
context.on('request', request => {
  const url = new URL(request.url());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== new URL(base).origin) externalRequests.push(request.url());
  if (url.pathname.startsWith('/api/')) apiRequests.push({ path: url.pathname, method: request.method() });
});
page.on('pageerror', error => errors.push(error.message));
try {
  // The editor's development entry unregisters workers, so exercise the real static reader directly.
  await page.goto(`${base}/readalong/index.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?v=readalong-test');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes('readalong-test'));
  await page.reload();
  await page.locator('#file').setInputFiles({ name: 'offline-fixture.iwlisten', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()) });
  await expect(page.locator('#render-status')).toHaveText('1 / 1 passages saved');
  await page.locator('#play').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > 0);
  await page.locator('#play').click();
  assert.equal(apiRequests.length, 0, 'Archive import and cached playback must never call the speech API.');

  const denied = await page.evaluate(async () => {
    const response = await fetch('/api/readalong', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voices' }) });
    return { status: response.status, cacheControl: response.headers.get('cache-control') };
  });
  assert.equal(denied.status, 401);
  assert.match(denied.cacheControl, /no-store/);
  async function cachePaths() {
    return page.evaluate(async () => {
      const paths = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    });
  }
  const required = ['/readalong/index.html', '/readalong/app.mjs', '/readalong/core.mjs', '/readalong/storage.mjs', '/readalong/archive.mjs', '/readalong/reader.css'];
  await expect.poll(async () => { const paths = await cachePaths(); return required.every(path => paths.includes(path)); }).toBe(true);
  assert.equal((await cachePaths()).some(path => path.startsWith('/api/')), false, 'The worker must never cache the API response.');
  const apiCountBeforeOffline = apiRequests.length;

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#render-status')).toHaveText('1 / 1 passages saved');
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  assert.equal(await page.locator('#credential').inputValue(), '');
  await page.locator('#play').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > 0);
  assert.equal((await cachePaths()).some(path => path.startsWith('/api/')), false);
  assert.ok(apiRequests.length >= 1, 'The deliberate unauthenticated API probe must have run.');
  assert.equal(apiRequests.length, apiCountBeforeOffline, 'Offline restore and replay must not attempt an API request.');
  assert.ok(apiRequests.every(request => request.path === '/api/readalong' && request.method === 'POST'));
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS: real service worker controls reader; silent archive imports and plays; unauthenticated POST returns 401/no-store; API stays outside caches; reader HTML/modules/CSS cached; offline reload restores book and replays saved audio without credentials.');
  console.log('Chromium worker/cache smoke only: not physical installed-PWA, Safari background playback, deployment-header, or real-voice verification.');
} finally {
  await context.close();
  await browser.close();
}
