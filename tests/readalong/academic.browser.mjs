#!/usr/bin/env node
/** Academic narration browser contract. Original synthetic source + mocked speech; no real provider requests. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
const base = process.env.READALONG_BASE_URL || 'http://localhost:5173';
const sourceText = String.raw`# A small study

The measured share is $\frac{1}{2}$. This sentence stays exactly as written.

We next use the relation \[E = mc^2\] to describe the result.

Smith et al. (2024) discuss the same result [1].

# References

[1] Smith, A. (2024). A synthetic journal article. https://doi.org/10.1234/fixture`;
function silentWav() {
  const rate = 8000, bytes = rate * 30 * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(bytes + 36, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data.toString('base64');
}
const audioFixture = silentWav();
function recording(text) {
  const characters = Array.from(text);
  return { audio_base64: audioFixture, alignment: { characters, character_start_times_seconds: characters.map((_, index) => index * .02), character_end_times_seconds: characters.map((_, index) => (index + .95) * .02) }, requestId: 'academic-mock-request' };
}
async function isolatedContext(browser, forbidden) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1365, height: 900 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:') return route.continue();
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) { forbidden.push(url.href); return route.abort(); }
    return route.continue();
  });
  return context;
}
async function shelf(page) { return page.evaluate(async () => (await import('/readalong/storage.mjs')).all('books')); }
async function chooseMockVoice(page) {
  await page.locator('#voice-open').click();
  await page.locator('#engine').selectOption('eleven');
  await page.locator('#voice-id').fill('testvoice1234');
  await page.locator('#credential').fill('dummy-academic-key');
  await page.locator('#save-profile').click();
  await expect(page.locator('#voice-message')).toContainText('Voice selected');
  await page.locator('#consent').check();
}
async function playing(page) { await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(false); }

throw new Error('Academic browser flow is awaiting the reader UI integration; no browser checks have run.');
