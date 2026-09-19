#!/usr/bin/env node
/** Local-engine UI contract with decoded WAV fixtures, never real synthesis or provider calls. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
const base = process.env.READALONG_BASE_URL || 'http://localhost:5173';
function silentWav() {
  const rate = 8000, bytes = rate * 18 * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(bytes + 36, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data.toString('base64');
}
async function contextFor(browser, forbidden) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1365, height: 900 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) {
      forbidden.push(url.href); return route.abort();
    }
    return route.continue();
  });
  return context;
}
async function useVoice(page, engine, voiceId) {
  await page.locator('#engine').selectOption(engine);
  await page.locator('#voice-id').fill(voiceId);
  await page.evaluate(() => {
    window.__localProfileSaved = false;
    const observer = new MutationObserver(() => { window.__localProfileSaved = true; observer.disconnect(); });
    observer.observe(document.getElementById('voice-message'), { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#save-profile').click();
  await page.waitForFunction(() => window.__localProfileSaved && document.getElementById('voice-message').textContent.includes('Voice selected'));
}
async function expectPlaying(page) { await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(false); }
async function expectPassageOnly(page) {
  await expect.poll(() => page.locator('#text .passage').count()).toBeGreaterThan(0);
  assert.equal(await page.locator('.word.active').count(), 0, 'Local audio without alignment must never invent word highlighting.');
  await expect(page.locator('#toast')).toContainText(/passage|word timings|alignment/i);
}
async function localFlow(browser) {
  const forbidden = [], calls = [], dialogs = [], errors = [];
  const context = await contextFor(browser, forbidden);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await context.route('**/api/readalong-local', async route => {
    const body = route.request().postDataJSON(), headers = route.request().headers();
    assert.equal(headers['x-elevenlabs-key'], undefined);
    assert.equal(headers['x-readalong-access'], undefined);
    calls.push(body);
    if (body.action === 'voices') {
      return route.fulfill({ json: { voices: [
        { voice_id: 'kokoro_bf_emma', name: 'Emma · local fixture', labels: { gender: 'female', accent: 'british' } },
        { voice_id: 'kokoro_af_heart', name: 'Heart · local fixture', labels: { gender: 'female', accent: 'american' } },
      ], has_more: false, next_page_token: null } });
    }
    assert.equal(body.action, 'render');
    assert.equal(body.model, 'kokoro_v1_0');
    assert.ok(body.text.length <= 600, 'Local passages must respect the CPU model chunk limit.');
    await route.fulfill({ json: { audio_base64: silentWav(), mime: 'audio/wav', alignment: null, alignmentReason: 'Local Kokoro narration uses passage highlighting; verified word timings are unavailable.', requestId: 'local-fixture' } });
  });
  const renders = () => calls.filter(call => call.action === 'render');
  try {
    await page.goto(`${base}/readalong/index.html`);
    await page.locator('#sample-text').click();
    await expect(page.locator('#text .word').first()).toBeVisible();
    assert.equal(calls.length, 0, 'Import must not invoke any speech engine.');
    await page.locator('#voice-open').click();
    await expect(page.locator('#engine')).toHaveValue('local');
    await expect(page.locator('#connection-fields')).toBeHidden();
    await expect(page.locator('#consent-row')).toBeHidden();
    await expect(page.locator('#local-info')).toBeVisible();
    await page.locator('#local-voices').click();
    await expect(page.locator('#voice-select option[value="kokoro_bf_emma"]')).toHaveCount(1);
    await useVoice(page, 'local', 'kokoro_bf_emma');
    await page.locator('#render-sample').click();
    await expectPlaying(page);
    await expectPassageOnly(page);
    assert.equal(renders().length, 1);
    assert.deepEqual(dialogs, [], 'Free local rendering must not ask for credit-use confirmation.');
    assert.equal(await page.locator('#credential').inputValue(), '', 'Local rendering must need no provider credential.');
    await page.locator('#play').click();

    // A local recording cannot satisfy an Eleven voice edition.
    await page.locator('#voice-open').click();
    await useVoice(page, 'eleven', 'testvoice1234');
    await expect(page.locator('#model')).toHaveValue('eleven_v3');
    await expect(page.locator('#render-status')).toContainText('0 /');
    await expect(page.locator('#connection-fields')).toBeVisible();
    await expect(page.locator('#consent-row')).toBeVisible();
    await page.locator('#render-sample').click();
    await expect(page.locator('#toast')).toContainText(/credential|API key/i);
    assert.equal(dialogs.length, 0);
    await page.locator('#credential').fill('dummy-key-never-sent');
    await page.locator('#render-sample').click();
    await expect(page.locator('#toast')).toContainText(/acknowledge|consent|credit/i);
    assert.equal(dialogs.length, 0);
    await page.locator('#consent').check();
    await page.locator('#render-sample').click();
    await expect.poll(() => dialogs.length).toBe(1);
    assert.match(dialogs[0], /ElevenLabs/);
    assert.match(dialogs[0], /credits|charged|billing/i);
    assert.deepEqual(forbidden, [], 'Dismissed Eleven confirmation must prevent even attempting its request.');

    await useVoice(page, 'local', 'kokoro_bf_emma');
    await expect(page.locator('#render-status')).toContainText('1 /');
    await page.locator('#render-sample').click();
    await expectPlaying(page);
    assert.equal(renders().length, 1, 'Switching back must reuse the original local recording.');
    assert.equal(dialogs.length, 1);
    await page.locator('#play').click();
    await page.locator('#voice-open').click();
    await useVoice(page, 'local', 'kokoro_af_heart');
    await expect(page.locator('#render-status')).toContainText('0 /');
    await page.locator('#render-sample').click();
    await expectPlaying(page);
    assert.equal(renders().length, 2, 'A different local voice needs its own recording.');
    assert.equal(renders()[1].voiceId, 'kokoro_af_heart');
    await page.locator('#play').click();
    await page.locator('#voice-open').click();
    await useVoice(page, 'local', 'kokoro_bf_emma');
    await page.locator('#voice-dialog .dialog-head button').click();

    await page.reload();
    await expect(page.locator('#text .word').first()).toBeVisible();
    await expect(page.locator('#model')).toHaveValue('kokoro_v1_0');
    assert.equal(await page.locator('#credential').inputValue(), '');
    await page.locator('#play').click();
    await expectPlaying(page); await expectPassageOnly(page);
    assert.equal(renders().length, 2, 'Reload must play persisted local audio without synthesis.');
    await page.locator('#play').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const archive = await downloadPromise;
    const buffer = await readFile(await archive.path());
    const secondContext = await contextFor(browser, forbidden);
    try {
      const second = await secondContext.newPage();
      second.on('pageerror', error => errors.push(error.message));
      await second.goto(`${base}/readalong/index.html`);
      await second.locator('#file').setInputFiles({ name: archive.suggestedFilename(), mimeType: 'application/octet-stream', buffer });
      await expect(second.locator('#render-status')).toContainText('1 /');
      await second.locator('#play').click();
      await expectPlaying(second); await expectPassageOnly(second);
      await second.locator('#play').click();
      await second.locator('#voice-open').click();
      await expect(second.locator('#engine')).toHaveValue('local');
      await expect(second.locator('#model')).toHaveValue('kokoro_v1_0');
      await useVoice(second, 'eleven', 'testvoice1234');
      await expect(second.locator('#render-status')).toContainText('0 /');
    } finally { await secondContext.close(); }
    assert.equal(dialogs.length, 1, 'Only the explicitly selected Eleven render may ask for credit confirmation.');
    assert.deepEqual(forbidden, [], 'All local, cached, and imported playback must avoid external/provider requests.');
    assert.deepEqual(errors, []);
    console.log('PASS: key-free local rendering without credit confirmation, passage-only highlighting, voice/model cache isolation, reload/archive playback, preserved Eleven credential/consent/confirmation gates, zero remote requests.');
    console.log('Silent WAV fixtures verify browser behavior; real CPU model generation is tested separately.');
  } catch (error) {
    console.error('Local-engine failure:', await page.locator('#toast').textContent(), { calls: calls.map(call => [call.action, call.model, call.voiceId]), forbidden, dialogs, errors });
    throw error;
  } finally { await context.close(); }
}
for (const engine of process.env.READALONG_BROWSER ? [process.env.READALONG_BROWSER] : ['chromium', 'webkit']) {
  assert.ok(['chromium', 'webkit'].includes(engine), `Unknown READALONG_BROWSER: ${engine}`);
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' && process.env.READALONG_CHROME ? { executablePath: process.env.READALONG_CHROME } : {}) });
  console.log(`Read along local engine checks: ${engine}`);
  try { await localFlow(browser); } finally { await browser.close(); }
}
