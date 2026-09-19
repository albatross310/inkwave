#!/usr/bin/env node
/** Explicit mock UI test. Every WAV below is synthetic silence, never generated MOSS audio. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit, expect } from '@playwright/test';
const directory = resolve('tools/readalong-moss');
const origin = 'http://localhost:5173', prefix = '/__moss_review_mock__/';
const fixture = {
  version: 1,
  cast: [
    { id: 'S1', name: 'Narrator', role: 'Narrator', voice_prompt: 'Calm literary narration.', reference_text: 'The room was quiet.', audio: 'references/S1.wav' },
    { id: 'S2', name: 'Mara', role: 'Adviser', voice_prompt: 'Measured, with dry warmth.', reference_text: 'I need an honest answer.', audio: 'references/S2.wav' },
    { id: 'S3', name: 'Tom', role: 'Friend', voice_prompt: 'Direct and understated.', reference_text: 'Then ask an honest question.', audio: 'references/S3.wav' },
  ],
  scenes: [
    { id: 'main', title: 'An ordinary exception', turns: [{ speaker: 'S1', text: 'Mara waited by the window.' }, { speaker: 'S2', text: 'Are you coming?' }, { speaker: 'S3', text: 'Not until we agree.' }], audio: 'scenes/main.wav', render_seconds: 16, audio_seconds: 999 },
    { id: 'continuation', title: 'The next morning', turns: [{ speaker: 'S1', text: 'The next morning, they met again.' }, { speaker: 'S2', text: 'Have you changed your mind?' }], audio: 'scenes/continuation.wav' },
  ],
  metrics: { fixture: 'SYNTHETIC SILENT WAV TEST — NOT REAL MOSS GENERATION' },
};
function wav() {
  const rate = 8000, bytes = rate * 8 * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(bytes + 36, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40); return data;
}
const audio = wav();
const assets = new Map(await Promise.all(['review.html', 'review.js', 'review.css'].map(async name => [name, await readFile(join(directory, name))])));
async function check(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(), errors = [], unexpected = [];
  let currentManifest = null;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:') return route.continue(); // Native WebKit media controls use local blob assets.
    if (url.origin !== origin || !url.pathname.startsWith(prefix)) { unexpected.push(url.href); return route.abort(); }
    const name = url.pathname.slice(prefix.length);
    if (assets.has(name)) return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: assets.get(name) });
    if (name === 'manifest.json' && currentManifest) return route.fulfill({ json: currentManifest });
    if (['references/S1.wav', 'references/S2.wav', 'scenes/main.wav'].includes(name)) return route.fulfill({ contentType: 'audio/wav', body: audio });
    if (!['manifest.json', 'references/S3.wav', 'scenes/continuation.wav'].includes(name)) unexpected.push(url.href);
    return route.fulfill({ status: 404, body: 'Mock recording not generated.' });
  });
  try {
    await page.goto(`${origin}${prefix}review.html`);
    await expect(page.locator('#status')).toContainText('Manifest not yet available');
    await expect(page.locator('#empty')).toBeVisible();
    assert.equal(await page.locator('audio').count(), 0);
    currentManifest = fixture;
    await page.locator('#reload').click();
    await expect(page.locator('.cast-card')).toHaveCount(3);
    await expect(page.locator('.scene-card')).toHaveCount(2);
    await expect(page.locator('audio:visible')).toHaveCount(3);
    await expect(page.locator('#scene-continuation .recording-state')).toContainText('Not yet generated');
    await expect(page.locator('#scene-main .scene-timing')).toContainText('Audio: 0:08');
    await expect(page.locator('#scene-main .scene-timing')).toContainText('2.00×');
    assert.equal(await page.locator('.turn p').first().evaluate(node => getComputedStyle(node).fontSize), '17px');
    assert.equal(await page.locator('#scene-main audio').count(), 1, 'A scene has one full-context recording, not a player per line.');
    const first = page.locator('audio:visible').first(), scene = page.locator('#scene-main audio');
    await first.evaluate(player => player.play());
    await expect.poll(() => first.evaluate(player => player.paused)).toBe(false);
    await scene.evaluate(player => player.play());
    await expect.poll(() => first.evaluate(player => player.paused)).toBe(true);
    await expect.poll(() => scene.evaluate(player => player.paused)).toBe(false);
    assert.equal(await page.locator('.word.active, .turn.active, [data-start-time]').count(), 0, 'No invented word or turn timestamps.');
    await scene.evaluate(player => player.pause());
    await page.locator('#review-notes').fill('Mock review: keep the narrator; compare the continuation.');
    const downloadEvent = page.waitForEvent('download'); await page.locator('#save-notes').click();
    const download = await downloadEvent;
    const notes = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.match(notes.notes, /Mock review/); assert.equal(notes.scenes.length, 2);
    currentManifest = structuredClone(fixture); currentManifest.cast[0].audio = 'https://moss.invalid/voice.wav';
    await page.locator('#reload').click();
    await expect(page.locator('#status')).toContainText('External URLs');
    await expect(page.locator('.cast-card')).toHaveCount(3); // Invalid manifest preserves the loaded audition.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await context.close(); }

  // file:// works without a server; scripts are classic local assets rather than module imports.
  const local = await browser.newContext({ serviceWorkers: 'block' }), localPage = await local.newPage();
  const folder = await mkdtemp(join(tmpdir(), 'iw-moss-review-mock-'));
  try {
    const requests = [];
    localPage.on('pageerror', error => errors.push(error.message));
    await local.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
    await localPage.goto(pathToFileURL(join(directory, 'review.html')).href);
    await expect(localPage.locator('#status')).toContainText('Nothing is uploaded');
    await expect(localPage.locator('#reload')).toBeHidden();
    await localPage.locator('#files').setInputFiles([
      { name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) },
      { name: 'S1.wav', mimeType: 'audio/wav', buffer: audio },
      { name: 'main.wav', mimeType: 'audio/wav', buffer: audio },
    ]);
    await expect(localPage.locator('audio:visible')).toHaveCount(2);
    await expect(localPage.locator('#scene-main .turn')).toHaveCount(3);
    await localPage.locator('#scene-main audio').evaluate(player => player.play());
    await expect.poll(() => localPage.locator('#scene-main audio').evaluate(player => player.paused)).toBe(false);
    await mkdir(join(folder, 'references')); await mkdir(join(folder, 'scenes'));
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(fixture));
    await writeFile(join(folder, 'references', 'S1.wav'), audio); await writeFile(join(folder, 'references', 'S2.wav'), audio);
    await writeFile(join(folder, 'scenes', 'main.wav'), audio);
    await localPage.locator('#folder').setInputFiles(folder);
    await expect(localPage.locator('audio:visible')).toHaveCount(3);
    await expect(localPage.locator('#scene-continuation .recording-state')).toContainText('Not yet generated');
    const actualBundle = await readFile(join(directory, 'audition.json'));
    const actual = JSON.parse(actualBundle);
    await localPage.locator('#files').setInputFiles({ name: 'audition.json', mimeType: 'application/json', buffer: actualBundle });
    await expect(localPage.locator('.cast-card')).toHaveCount(actual.cast.length);
    await expect(localPage.locator('.scene-card')).toHaveCount(actual.scenes.length);
    await expect(localPage.locator('audio')).toHaveCount(0);
    await expect(localPage.locator('#page-title')).toHaveText(actual.title);
    await expect(localPage.locator('#source-info')).toContainText(actual.source);
    await expect(localPage.locator('#scene-sunday')).toContainText('Continuation of The offer');
    await expect(localPage.locator('.recording-state')).toHaveCount(actual.cast.length + actual.scenes.length);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally { await local.close(); await rm(folder, { recursive: true, force: true }); }
  console.log('PASS: synthetic WAV review only — served and file:// loading, folder import, missing-audio states, complete scene players, actual duration, playback exclusivity, notes export, responsive width, actual dry audition fixture, no external requests or fabricated timings.');
}
for (const engine of process.env.READALONG_BROWSER ? [process.env.READALONG_BROWSER] : ['chromium', 'webkit']) {
  const type = { chromium, webkit }[engine]; assert.ok(type, 'Choose Chromium or WebKit.');
  const browser = await type.launch({ headless: true });
  console.log(`MOSS review mock UI: ${engine}`);
  try { await check(browser); } finally { await browser.close(); }
}
