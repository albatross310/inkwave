#!/usr/bin/env node
/** Actual-origin browser integration test. Fake account + silent WAV: never a paid audition. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
const base = process.env.READALONG_BASE_URL || 'http://localhost:5173';
function silentWav(seconds = 18) {
  const rate = 8000, bytes = rate * seconds * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(bytes + 36, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data.toString('base64');
}
const fakeAudio = silentWav();
async function isolatedContext(browser, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  await isolateNetwork(context);
  return context;
}
async function isolateNetwork(context) {
  // Every context is isolated, including archive import and the editor integration.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
}
function recording(body) {
  const characters = Array.from(body.text);
  return { audio_base64: fakeAudio, alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * .02), character_end_times_seconds: characters.map((_, i) => (i + .99) * .02) }, requestId: 'mock-request' };
}
async function readerFlow(browser) {
  const context = await isolatedContext(browser, { viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await context.route('**/api/readalong', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (body.action === 'voices') return route.fulfill({ json: { voices: [{ voice_id: 'testvoice1234', name: 'Mock Australian female', labels: { accent: 'australian', gender: 'female' }, description: 'Test fixture, not a real voice.' }], has_more: false, next_page_token: null } });
    assert.equal(body.action, 'render');
    await route.fulfill({ json: recording(body) });
  });
  try {
    await page.goto(`${base}/readalong/index.html`);
    await page.locator('#sample-text').click();
    await page.waitForSelector('#text .word');
    assert.equal(await page.locator('#chapters button').count(), 2);
    assert.equal(await page.locator('article').evaluate(e => getComputedStyle(e).fontSize), '17px');
    assert.equal(calls.length, 0, 'Import must not send text or load voices.');
    await page.locator('#voice-open').click();
    await page.locator('#engine').selectOption('eleven');
    await page.locator('#credential').fill('not-a-real-provider-key');
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.querySelector('#voice-select').options.length > 1);
    await page.locator('#voice-select').selectOption('testvoice1234');
    await page.locator('#save-profile').click();
    await page.waitForFunction(() => document.querySelector('#voice-message').textContent.includes('Voice selected'));
    await page.locator('#consent').check();
    await page.locator('#render-sample').click();
    await page.waitForFunction(() => document.querySelector('#render-status').textContent.startsWith('1 / 2'));
    await page.waitForFunction(() => document.querySelectorAll('.word.active').length === 1);
  assert.equal(calls.filter(c => c.action === 'render').length, 1);
  await page.locator('#play').click();
  await page.locator('#text .word').first().click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  assert.equal(calls.filter(c => c.action === 'render').length, 1, 'Clicking a recorded word seeks using cached audio.');
  await page.locator('#play').click();
  await page.locator('#seek').fill('2'); await page.locator('#seek').dispatchEvent('input');
    await page.locator('#bookmark').click();
    await page.locator('#marks-open').click();
    assert.equal(await page.locator('#marks .mark-row').count(), 1);
    await page.locator('#marks-dialog .dialog-head button').click();
    await page.locator('#font-size').fill('16'); await page.locator('#font-size').dispatchEvent('input');
    await page.locator('#speed').selectOption('1.25');
    await page.locator('#voice-open').click(); await page.locator('#render-sample').click();
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    assert.equal(calls.filter(c => c.action === 'render').length, 1, 'A cached audition must not be synthesised twice.');
    await page.locator('#play').click();
    const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click();
    const backup = await downloadEvent; const backupPath = await backup.path();
    assert.ok(backup.suggestedFilename().endsWith('.iwlisten'));
    // Reload restores actual IndexedDB audio, profile, text and bookmarks, never the key.
    await page.reload();
    await page.waitForSelector('#text .word');
    assert.equal(await page.locator('#credential').inputValue(), '');
    assert.equal(await page.locator('article').evaluate(e => getComputedStyle(e).fontSize), '16px');
    await page.locator('#marks-open').click(); assert.equal(await page.locator('#marks .mark-row').count(), 1);
    await page.locator('#marks-dialog .dialog-head button').click();
    await page.locator('#play').click(); await page.waitForFunction(() => !document.querySelector('audio').paused);
    assert.equal(calls.filter(c => c.action === 'render').length, 1);
    await page.locator('#play').click();
    await page.locator('#search').fill('rain'); await page.locator('#search-next').click();
    assert.match(await page.locator('#chapter-title').textContent(), /practical/);
    assert.equal(await page.locator('.word.found').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    // A fresh origin context proves portable archive import, not a cache hit in the first browser.
    const secondContext = await isolatedContext(browser); const second = await secondContext.newPage();
    await secondContext.route('**/api/readalong', route => route.abort());
    await second.goto(`${base}/readalong/index.html`);
    const { readFile } = await import('node:fs/promises');
    await second.locator('#file').setInputFiles({ name: backup.suggestedFilename(), mimeType: 'application/octet-stream', buffer: await readFile(backupPath) });
    await second.waitForSelector('#text .word');
    await second.waitForFunction(() => document.querySelector('#render-status').textContent.startsWith('1 / 2'));
    await second.locator('#play').click(); await second.waitForFunction(() => !document.querySelector('audio').paused);
    await secondContext.close();
    assert.deepEqual(errors, []);
    console.log('PASS: import, default size, chapter navigation, mocked rendering, real audio decoding/highlighting, cached replay, seek, bookmarks, reload persistence, key forgetting, responsive width, archive export/import.');
    console.log('This test uses silent WAV fixtures. It is not a real ElevenLabs or Australian-voice audition.');
  } catch (error) {
    console.error('Reader state at failure:', await page.locator('#render-status').textContent(), await page.locator('#toast').textContent(), 'calls:', calls.map(call => call.action), 'page errors:', errors);
    throw error;
  } finally { await context.close(); }
}

async function chooseMockProfile(page) {
  await page.locator('#voice-open').click();
  await page.locator('#engine').selectOption('eleven');
  await page.locator('#credential').fill('not-a-real-provider-key');
  await page.locator('#voice-id').fill('testvoice1234');
  await page.locator('#save-profile').click();
  await expect(page.locator('#voice-message')).toContainText('Voice selected');
  await page.locator('#consent').check();
}

async function queueFlow(browser) {
  const context = await isolatedContext(browser);
  const page = await context.newPage();
  const calls = [], errors = [];
  let pending;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.route('**/api/readalong', async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'render');
    calls.push(body);
    if (calls.length === 1) {
      // Hold the first response so pause is tested during a real pending request.
      await new Promise(resolve => { pending = async () => { await route.fulfill({ json: recording(body) }); resolve(); }; });
    } else if (calls.length === 2) {
      await route.fulfill({ status: 503, json: { error: 'Mock provider unavailable. Retry manually.' } });
    } else {
      await route.fulfill({ json: recording(body) });
    }
  });
  try {
    await page.goto(`${base}/readalong/index.html`);
    await page.locator('#sample-text').click();
    await expect(page.locator('#chapters button')).toHaveCount(2);
    await chooseMockProfile(page);
    await page.locator('#render-book').click();
    await expect.poll(() => calls.length).toBe(1);
    await page.locator('#stop-render').click();
    await pending();
    await expect(page.locator('#stop-render')).toBeHidden();
    await expect(page.locator('#render-status')).toHaveText('1 / 2 passages saved');
    assert.equal(calls.length, 1, 'Pause must finish and save the in-flight passage without starting the next.');
    await page.locator('#voice-open').click();
    await page.locator('#render-book').click();
    await expect(page.locator('#toast')).toContainText('Mock provider unavailable');
    await expect(page.locator('#stop-render')).toBeHidden();
    await page.waitForTimeout(1000); // Observe no retry after the failed request has settled.
    assert.equal(calls.length, 2, 'A provider failure must not trigger an automatic retry.');
    await expect(page.locator('#render-status')).toHaveText('1 / 2 passages saved');
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    assert.equal(calls.length, 2, 'Completed audio stays playable after the next passage fails.');
    await page.locator('#play').click();
    await page.locator('#voice-open').click();
    await page.locator('#render-book').click();
    await expect(page.locator('#render-status')).toHaveText('2 / 2 passages saved');
    assert.equal(calls.length, 3, 'An explicit retry must request only the still-missing passage.');
    assert.equal(calls[1].text, calls[2].text);
    assert.notEqual(calls[0].text, calls[1].text);
    assert.deepEqual(errors, []);
    console.log('PASS: pending-request queue pause, saved first passage, provider failure with no automatic retry, cached replay after failure, explicit resume of only missing audio.');
  } finally { await context.close(); }
}

async function editorFlow(browser) {
  // Ephemeral WebKit fails existing editor OPFS writes even without opening Read along.
  // Use a new temporary profile for this persistence check; reader tests above remain ephemeral.
  const profileDirectory = browser.browserType().name() === 'webkit' ? await mkdtemp(join(tmpdir(), 'iw-readalong-editor-')) : null;
  const context = profileDirectory
    ? await webkit.launchPersistentContext(profileDirectory, { headless: true, serviceWorkers: 'block', viewport: { width: 1365, height: 900 } })
    : await isolatedContext(browser, { viewport: { width: 1365, height: 900 } });
  if (profileDirectory) await isolateNetwork(context);
  const page = await context.newPage();
  const errors = [];
  let pendingAudition, renderCalls = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.route('**/api/readalong', async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'render');
    renderCalls++;
    await new Promise(resolve => { pendingAudition = async () => { await route.fulfill({ json: recording(body) }); resolve(); }; });
  });
  try {
    await page.goto(`${base}/?blank=1`);
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const sentence = 'This synthetic document must survive opening and closing the reader.';
    await editor.fill(sentence);
    const originalEditor = await editor.elementHandle();
    const originalUrl = page.url();
    const originalDocId = await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId'));
    assert.ok(originalDocId, 'The isolated editor must own a document before opening the reader.');
    const options = page.getByRole('button', { name: 'Options', exact: true });
    await options.click();
    await page.getByRole('menuitem', { name: 'Read along', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Inkwave Read along', exact: true });
    await expect(panel).toBeVisible();
    const frame = page.frameLocator('iframe[title="Inkwave Read along — recorded narration and text"]');
    await frame.locator('#sample-text').click();
    await expect(frame.locator('#chapters button')).toHaveCount(2);
    assert.equal(await originalEditor.evaluate(node => node === document.querySelector('.tiptap') && node.isConnected), true, 'Opening the reader must keep the original editor DOM mounted.');
    assert.equal(page.url(), originalUrl, 'Read along must not change the editor document route.');
    await expect(editor).toContainText(sentence);
    await frame.locator('#font-size').fill('19');
    await frame.locator('#font-size').dispatchEvent('input');
    assert.equal(renderCalls, 0, 'Opening the reader must not render the editor document.');
    await chooseMockProfile(frame);
    await frame.locator('#render-sample').click();
    await expect.poll(() => renderCalls).toBe(1);
    await frame.locator('#close-reader').click();
    await expect(panel).toBeHidden();
    await expect(options).toBeFocused();
    await pendingAudition();
    await expect(frame.locator('#render-status')).toHaveText('1 / 2 passages saved');
    await page.waitForTimeout(1000); // An async audio load must not start playback after the closed render settles.
    assert.equal(await frame.locator('audio').evaluate(audio => audio.paused), true, 'An audition finishing after close must save without starting hidden playback.');
    await expect(editor).toContainText(sentence);
    await options.click();
    await page.getByRole('menuitem', { name: 'Read along', exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(frame.locator('#chapters button')).toHaveCount(2);
    assert.equal(await frame.locator('#font-size').inputValue(), '19', 'Reopening must retain the reader state.');
    assert.equal(await page.locator('iframe[title="Inkwave Read along — recorded narration and text"]').count(), 1, 'Reopening must reuse one reader.');
    await frame.locator('#play').click();
    await expect.poll(() => frame.locator('audio').evaluate(audio => audio.paused)).toBe(false);
    assert.equal(renderCalls, 1, 'Reopening must reuse the recording completed after close.');
    await frame.locator('#close-reader').click();
    await expect(panel).toBeHidden();
    await expect.poll(() => frame.locator('audio').evaluate(audio => audio.paused)).toBe(true);
    await expect(options).toBeFocused();
    assert.equal(await originalEditor.evaluate(node => node === document.querySelector('.tiptap') && node.isConnected), true);
    await page.evaluate(() => {
      window.__readalongSaveObserved = false;
      window.addEventListener('inkwave:doc-saved', () => { window.__readalongSaveObserved = true; }, { once: true });
    });
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Still editable.');
    await expect(editor).toContainText('Still editable.');
    await page.waitForFunction(() => window.__readalongSaveObserved === true);
    const savedText = await editor.innerText();
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toHaveText(savedText);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('inkwave:tabDocumentId')), originalDocId, 'Reload must recover the same edited document after using Read along.');
    assert.deepEqual(errors, []);
    console.log('PASS: actual Options menu launch, editor DOM and document kept alive, close/reopen retaining reader state, close during pending audition without hidden playback, cached replay, close pauses audio and restores Options focus, editor save acknowledgement and same-document text restore after reload.');
  } finally {
    await context.close();
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  }
}

const engines = process.env.READALONG_BROWSER ? [process.env.READALONG_BROWSER] : ['chromium', 'webkit'];
for (const engine of engines) {
  assert.ok(['chromium', 'webkit'].includes(engine), `Unknown READALONG_BROWSER: ${engine}`);
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' && process.env.READALONG_CHROME ? { executablePath: process.env.READALONG_CHROME } : {}) });
  console.log(`Read along browser checks: ${engine}`);
  try { await readerFlow(browser); await queueFlow(browser); await editorFlow(browser); }
  finally { await browser.close(); }
}
