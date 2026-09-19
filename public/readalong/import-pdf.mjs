/** PDF text-layer extraction only. Imported bytes stay in this browser. */
import { MAX_TEXT, cleanText } from './core.mjs';
const MAX_FILE = 50_000_000;
const MAX_PAGES = 2000;

// Follow PDF.js's content order. Geometry separates paragraphs; it cannot prove
// the author's intended reading order in columns, tables or positioned fragments.
export function pdfPageText(items) {
  const lines = [];
  let line = '', previous = null, start = null;
  const finish = () => {
    if (line.trim()) lines.push({ text: line.trim(), y: start?.transform?.[5], height: Math.abs(start?.height || start?.transform?.[3] || 12) });
    line = ''; previous = null; start = null;
  };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous && Math.abs((item.transform?.[5] || 0) - (previous.transform?.[5] || 0)) > Math.max(2, Math.abs(previous.height || 12) * .3)) finish();
    if (!start) start = item;
    if (line && item.str && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const gap = (item.transform?.[4] || 0) - ((previous?.transform?.[4] || 0) + (previous?.width || 0));
      if (!previous || gap > Math.max(.5, Math.abs(item.height || 12) * .1) || item.dir === 'rtl') line += ' ';
    }
    line += item.str; previous = item;
    if (item.hasEOL) finish();
  }
  finish();
  return lines.map((entry, i) => {
    if (!i) return entry.text;
    const prev = lines[i - 1];
    const gap = Math.abs(prev.y - entry.y);
    const sizeChange = Math.max(prev.height, entry.height) / Math.min(prev.height, entry.height) > 1.25;
    const paragraph = sizeChange || !Number.isFinite(gap) || gap > Math.max(prev.height, entry.height) * 1.6 || /^\s*(?:[•●▪]|\d+[.)]\s)/u.test(entry.text);
    return (paragraph ? '\n\n' : ' ') + entry.text;
  }).join('');
}

export async function extractPdf(file, { onProgress = () => {} } = {}) {
  if (file.size > MAX_FILE) throw new Error('Choose a PDF smaller than 50 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder('latin1').decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('This file is not a valid PDF.');
  const pdfjs = await import('./vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
  const loading = pdfjs.getDocument({ data, isEvalSupported: false, useWasm: false, disableFontFace: true,
    cMapUrl: '/readalong/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/',
  });
  let pdf;
  try {
    pdf = await loading.promise;
    if (pdf.numPages > MAX_PAGES) throw new Error('Choose a PDF with no more than 2,000 pages.');
    const pages = []; let size = 0, empty = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      onProgress(`Reading PDF page ${number} of ${pdf.numPages}…`);
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = pdfPageText(content.items);
        if (!text.trim()) empty++;
        else { size += text.length + 2; if (size > MAX_TEXT) throw new Error('This PDF exceeds the two-million-character reading limit.'); pages.push(text); }
      } finally { page.cleanup(); }
    }
    if (!pages.length) throw new Error('This PDF has no selectable text. Scanned or image-only PDFs need OCR before importing.');
    let title = file.name.replace(/\.pdf$/i, '');
    try { const metadata = await pdf.getMetadata(); if (typeof metadata.info?.Title === 'string' && metadata.info.Title.trim()) title = metadata.info.Title.trim().slice(0, 180); } catch { /* Text is usable even when optional title metadata is malformed. */ }
    const warnings = ['Imported from PDF. Check reading order before rendering, especially columns, tables, headers and footnotes.'];
    if (empty) warnings.push(`${empty} of ${pdf.numPages} pages had no selectable text and were omitted. They may be blank or need OCR.`);
    return { title, text: cleanText(pages.join('\n\n')), warnings };
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('This PDF is password-protected. Unlock it before importing.');
    if (error?.name === 'InvalidPDFException') throw new Error('This PDF is damaged or unreadable. Export a new copy and try again.');
    throw error;
  } finally { await loading.destroy(); }
}
