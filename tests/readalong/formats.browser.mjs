#!/usr/bin/env node
/** Real EPUB/PDF uploads in isolated browsers. Every external/API request is blocked. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { epubFixture, pdfFixture } from './formatFixtures.mjs';
const base = process.env.READALONG_BASE_URL || 'http://localhost:5173';
async function isolatedContext(browser, forbidden) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/') || url.pathname === '/readalong-fixture-executed') {
      forbidden.push(url.href); return route.abort();
    }
    return route.continue();
  });
  return context;
}
async function shelf(page) { return page.evaluate(async () => (await import('/readalong/storage.mjs')).all('books')); }
async function upload(page, name, mimeType, buffer) {
  // Wait for this import's result, even when consecutive errors have the same text.
  await page.evaluate(() => {
    window.__formatToastChanged = false;
    const observer = new MutationObserver(() => { window.__formatToastChanged = true; observer.disconnect(); });
    observer.observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#file').setInputFiles({ name, mimeType, buffer });
  await page.waitForFunction(() => window.__formatToastChanged && !/^(Opening|Reading|Extracting)\b/.test(document.getElementById('toast').textContent));
}
function inOrder(text, first, second) {
  assert.ok(text.includes(first), `Extracted text is missing ${first}.`);
  assert.ok(text.indexOf(second) > text.indexOf(first), `${second} must come after ${first}.`);
}
async function expectPreserved(page, previous, fixture, message) {
  const before = await shelf(page);
  await upload(page, ...fixture);
  await expect(page.locator('#toast')).toContainText(message);
  await expect(page.locator('#book-title')).toHaveText(previous.title);
  assert.deepEqual(await shelf(page), before, `Failed ${fixture[0]} import must leave every saved book untouched.`);
}
async function formatsFlow(browser) {
  const forbidden = [], errors = [];
  const context = await isolatedContext(browser, forbidden);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/readalong/index.html`);
    await expect(page.locator('#empty-import')).toContainText('Open a book');
    await page.locator('#sample-text').click();
    await expect(page.locator('#chapters button')).toHaveCount(2);
    const original = (await shelf(page))[0];
    assert.ok(original.text.includes('Mara'));

    let epub = original;
    if (process.env.READALONG_FORMATS !== 'pdf') {
      await upload(page, 'scrambled-order.epub', 'application/epub+zip', epubFixture());
      await expect(page.locator('#book-title')).toHaveText('Spine Order Fixture');
      epub = (await shelf(page)).find(book => book.title === 'Spine Order Fixture');
      inOrder(epub.text, 'FIRST SPINE PASSAGE', 'SECOND SPINE PASSAGE');
      assert.ok(epub.text.includes('Visible inline emphasis survives as plain text.'));
      assert.doesNotMatch(epub.text, /FORBIDDEN|__epubExecuted|@import|fetch\(/);
      assert.equal(await page.evaluate(() => window.__epubExecuted), undefined, 'Imported XHTML must never execute.');
      assert.equal(await page.locator('#text script, #text iframe, #text object, #text img, #text style, #text link').count(), 0);
      await expect(page.locator('#text')).toContainText('FIRST SPINE PASSAGE');
      await page.locator('#search').fill('SECOND SPINE PASSAGE');
      await page.locator('#search-next').click();
      await expect(page.locator('#text')).toContainText('SECOND SPINE PASSAGE');
      await page.reload();
      await expect(page.locator('#book-title')).toHaveText(epub.title);
      assert.equal((await shelf(page)).find(book => book.id === epub.id).text, epub.text);
      assert.equal((await shelf(page)).find(book => book.id === original.id).text, original.text);

      await expectPreserved(page, epub, ['corrupt.epub', 'application/epub+zip', Buffer.from('not a zip')], /EPUB|ZIP|archive/i);
      await expectPreserved(page, epub, ['empty.epub', 'application/epub+zip', epubFixture({ empty: true })], /no readable|no text|empty/i);
      await expectPreserved(page, epub, ['missing-spine.epub', 'application/epub+zip', epubFixture({ brokenSpine: true })], /spine|missing|manifest/i);
      await expectPreserved(page, epub, ['protected.epub', 'application/epub+zip', epubFixture({ drm: true })], /DRM|encrypted|protected/i);

    }

    await upload(page, 'synthetic-pages.pdf', 'application/pdf', pdfFixture());
    const pdfTitle = await page.locator('#book-title').textContent();
    const pdf = (await shelf(page)).find(book => book.title === pdfTitle);
    assert.ok(pdf && pdf.id !== epub.id, 'PDF upload must open a separate extracted book.');
    inOrder(pdf.text, 'FIRST PDF PAGE', 'SECOND PDF PAGE');
    await expect(page.locator('#import-note')).toContainText(/PDF.*reading order/i);
    await expect(page.locator('#text')).toContainText('FIRST PDF PAGE');
    await page.locator('#search').fill('SECOND PDF PAGE');
    await page.locator('#search-next').click();
    await expect(page.locator('#text')).toContainText('SECOND PDF PAGE');
    await page.reload();
    await expect(page.locator('#book-title')).toHaveText(pdfTitle);
    assert.equal((await shelf(page)).find(book => book.id === pdf.id).text, pdf.text);
    await expectPreserved(page, pdf, ['corrupt.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nnot a document')], /PDF|invalid|read/i);
    await expectPreserved(page, pdf, ['empty.pdf', 'application/pdf', pdfFixture({ pages: [[]] })], /text|scan|OCR/i);
    await expectPreserved(page, pdf, ['scanned.pdf', 'application/pdf', pdfFixture({ imageOnly: true })], /text|scan|OCR/i);
    await expectPreserved(page, pdf, ['empty.txt', 'text/plain', Buffer.alloc(0)], /no readable|no text|empty/i);

    // A manually entered fake voice ID allows text-only backup without any key or render.
    await page.locator('#voice-open').click();
    await page.locator('#engine').selectOption('eleven');
    await page.locator('#voice-id').fill('testvoice1234');
    await page.locator('#save-profile').click();
    await expect(page.locator('#voice-message')).toContainText('Voice selected');
    await page.locator('#voice-dialog .dialog-head button').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const backup = await downloadPromise;
    const buffer = await readFile(await backup.path());
    const secondContext = await isolatedContext(browser, forbidden);
    try {
      const second = await secondContext.newPage();
      second.on('pageerror', error => errors.push(error.message));
      await second.goto(`${base}/readalong/index.html`);
      await upload(second, backup.suggestedFilename(), 'application/octet-stream', buffer);
      await expect(second.locator('#book-title')).toHaveText(pdfTitle);
      await expect(second.locator('#import-note')).toContainText(/PDF.*reading order/i);
      assert.equal((await shelf(second))[0].text, pdf.text, 'Portable backup must retain the exact extracted PDF text.');
      await expect(second.locator('#render-status')).toContainText('0 /');
    } finally { await secondContext.close(); }
    assert.deepEqual(forbidden, [], 'Import must not request external resources or any provider/API endpoint.');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${process.env.READALONG_FORMATS === 'pdf' ? '' : 'real EPUB spine order and inert hostile XHTML; '}real two-page PDF text extraction; rejected inputs preserve shelf; reload persistence; extracted-text archive roundtrip; zero external/API requests.`);
  } catch (error) {
    console.error('Format import failure:', await page.locator('#book-title').textContent(), await page.locator('#toast').textContent(), { forbidden, errors });
    throw error;
  } finally { await context.close(); }
}
for (const engine of process.env.READALONG_BROWSER ? [process.env.READALONG_BROWSER] : ['chromium', 'webkit']) {
  assert.ok(['chromium', 'webkit'].includes(engine), `Unknown READALONG_BROWSER: ${engine}`);
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' && process.env.READALONG_CHROME ? { executablePath: process.env.READALONG_CHROME } : {}) });
  console.log(`Read along file import checks: ${engine}`);
  try { await formatsFlow(browser); } finally { await browser.close(); }
}
