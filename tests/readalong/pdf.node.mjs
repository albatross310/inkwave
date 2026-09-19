import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfPageText, extractPdf } from '../../public/readalong/import-pdf.mjs';
const item = (str, x, y, width, hasEOL = false) => ({ str, transform: [12, 0, 0, 12, x, y], height: 12, width, hasEOL });
test('PDF text joins word gaps, keeps adjacent glyph fragments and restores paragraphs', () => {
  assert.equal(pdfPageText([
    item('Read', 10, 700, 24), item('ing', 34, 700, 18), item('locally.', 57, 700, 42, true),
    item('The next line.', 10, 684, 78, true), item('A new paragraph.', 10, 648, 96, true),
  ]), 'Reading locally. The next line.\n\nA new paragraph.');
});
test('PDF text detects baseline changes without EOL and keeps explicit spaces', () => {
  assert.equal(pdfPageText([item('One ', 10, 700, 24), item('two', 40, 700, 18), item('three', 10, 684, 30)]), 'One two three');
});
test('non-text PDF items and empty text do not invent words', () => {
  assert.equal(pdfPageText([{ type: 'beginMarkedContent' }, item('', 10, 10, 0, true)]), '');
});
test('oversized and non-PDF inputs fail before loading the heavy parser', async () => {
  await assert.rejects(extractPdf({ size: 50_000_001 }), /50 MB/);
  await assert.rejects(extractPdf(new Blob(['Not a PDF'])), /not a valid PDF/);
});
test('a heading with larger type stays separate from its following body text', () => {
  const heading = { ...item('Chapter 1', 10, 700, 100, true), height: 20 };
  assert.equal(pdfPageText([heading, item('The story starts.', 10, 676, 96, true)]), 'Chapter 1\n\nThe story starts.');
});
