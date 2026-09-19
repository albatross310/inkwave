/** Local EPUB text extraction. OCF/spine rules: https://www.w3.org/TR/epub-33/ */
import { MAX_TEXT, cleanText } from './core.mjs';
const MAX_FILE = 50_000_000, MAX_EXPANDED = 20_000_000, MAX_ENTRY = 8_000_000, MAX_ENTRIES = 10_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const fail = message => { throw new Error(message); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipName(bytes) {
  let name;
  try { name = decoder.decode(bytes); } catch { fail('The EPUB contains an unreadable file name.'); }
  if (!name || name.startsWith('/') || /[\\\0]/.test(name) || name.split('/').some(s => s === '.' || s === '..')) fail('The EPUB contains an unsafe file path.');
  return name;
}
/** Resolve a package URI inside the ZIP; no URL is ever fetched. */
function resolvePath(base, href) {
  if (typeof href !== 'string' || !href || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || href.includes('\\')) fail('The EPUB refers to an unsupported external or unsafe resource.');
  const path = base ? base.split('/').slice(0, -1) : [];
  const uriPath = href.split(/[?#]/, 1)[0];
  for (const raw of uriPath.split('/')) {
    let part;
    try { part = decodeURIComponent(raw); } catch { fail('The EPUB contains an invalid encoded resource path.'); }
    if (/[\/\\\0]/.test(part)) fail('The EPUB contains an unsafe encoded resource path.');
    if (!part || part === '.') continue;
    if (part === '..') { if (!path.length) fail('An EPUB resource path escapes the book.'); path.pop(); }
    else path.push(part);
  }
  if (!path.length) fail('The EPUB refers to a missing resource.');
  return path.join('/');
}
async function openZip(file) {
  if (!file || !Number.isFinite(file.size) || file.size > MAX_FILE) fail('Choose an EPUB smaller than 50 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail('The EPUB ZIP directory is missing or damaged.');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryStart = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || directoryStart === 0xffffffff || directorySize === 0xffffffff) fail('Split and ZIP64 EPUB files are not supported.');
  if (!count || count > MAX_ENTRIES || directoryStart + directorySize !== end) fail('The EPUB has an invalid or oversized file directory.');
  const entries = new Map(); let cursor = directoryStart;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('The EPUB file directory is damaged.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true), next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || local >= directoryStart || view.getUint16(cursor + 34, true) || compressed === 0xffffffff || expanded === 0xffffffff) fail('The EPUB contains an invalid file entry.');
    const name = zipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (entries.has(name)) fail('The EPUB contains duplicate file paths.');
    if (flags & 1) fail('This EPUB uses ZIP encryption. Import an unencrypted EPUB you are allowed to read.');
    entries.set(name, { name, flags, method, crc, compressed, expanded, local }); cursor = next;
  }
  if (cursor !== end) fail('The EPUB file directory has unexpected trailing data.');
  let total = 0; const cache = new Map();
  async function read(name) {
    if (cache.has(name)) return cache.get(name);
    const entry = entries.get(name);
    if (!entry) fail(`The EPUB is missing a required section (${name}).`);
    const { local, flags, method, compressed, expanded, crc } = entry;
    if (expanded > MAX_ENTRY || total + expanded > MAX_EXPANDED) fail('The EPUB exceeds the safe text/XML expansion limit (8 MB per section, 20 MB total).');
    if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) fail('An EPUB section has a damaged local file header.');
    const nameLength = view.getUint16(local + 26, true), extraLength = view.getUint16(local + 28, true), start = local + 30 + nameLength + extraLength;
    if (start + compressed > directoryStart || zipName(bytes.subarray(local + 30, local + 30 + nameLength)) !== name) fail('An EPUB section has an invalid data range.');
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== expanded)) fail('An EPUB section has inconsistent size or checksum metadata.');
    let result;
    if (method === 0) result = bytes.slice(start, start + compressed);
    else if (method === 8) {
      let inflater;
      try { inflater = new DecompressionStream('deflate-raw'); } catch { fail('This browser cannot decompress EPUB files. Try a current Safari, Chrome or Edge browser.'); }
      const reader = new Blob([bytes.subarray(start, start + compressed)]).stream().pipeThrough(inflater).getReader();
      const parts = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_ENTRY || total + size > MAX_EXPANDED || size > expanded) {
            await reader.cancel(); fail('An EPUB section expands beyond its declared size or the safe text limit.');
          }
          parts.push(value);
        }
      } catch (error) {
        if (/EPUB section expands/.test(error.message)) throw error;
        fail('An EPUB section could not be decompressed. The file may be damaged.');
      }
      result = new Uint8Array(size); let offset = 0;
      for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
    } else fail('The EPUB uses an unsupported compression method for a required section.');
    if (result.byteLength !== expanded || result.byteLength > MAX_ENTRY || total + result.byteLength > MAX_EXPANDED || crc32(result) !== crc) fail('An EPUB section failed its size or integrity check.');
    total += result.byteLength; cache.set(name, result); return result;
  }
  return { read, has: name => entries.has(name) };
}
function xml(bytes, label) {
  let source;
  try {
    const encoding = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60 ? 'utf-16be' : 'utf-8';
    source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch { fail(`The EPUB ${label} has an unsupported or damaged text encoding.`); }
  if (/<!ENTITY\b|<!DOCTYPE\b[^>]*\[/i.test(source)) fail('The EPUB contains unsupported XML entity declarations. Export a standard EPUB without custom entities.');
  // Standard EPUB 2 XHTML doctypes are safe to discard. No external DTD is resolved.
  source = source.replace(/<!DOCTYPE\b[^>]*>/gi, '');
  // EPUB 2 uses XHTML named entities such as &nbsp;. Decode only an isolated,
  // strictly matched entity token; manuscript markup is parsed exclusively as XML.
  const entities = new Map();
  source = source.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|&([A-Za-z][A-Za-z0-9]{1,31});/g, (token, name) => {
    if (!name || ['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return token;
    if (!entities.has(name)) {
      if (entities.size >= 512) fail('The EPUB uses too many distinct XML entity names.');
      const decoded = new DOMParser().parseFromString(`<span>${token}</span>`, 'text/html').body.textContent;
      entities.set(name, decoded === token ? token : [...decoded].map(c => `&#${c.codePointAt(0)};`).join(''));
    }
    return entities.get(name);
  });
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length || !parsed.documentElement) fail(`The EPUB ${label} is not well-formed XML. Nothing was imported.`);
  return parsed;
}
const descendants = (element, name) => [...element.getElementsByTagName('*')].filter(e => e.localName === name);
const children = (element, name) => [...element.children].filter(e => e.localName === name);
const hidden = e => e.hasAttribute('hidden') || e.getAttribute('aria-hidden')?.toLowerCase() === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(e.getAttribute('style') || '');
const OMIT = new Set(['script', 'style', 'nav', 'iframe', 'object', 'embed', 'svg', 'canvas', 'audio', 'video', 'form', 'template', 'noscript']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'blockquote', 'pre', 'header', 'footer', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'table', 'tr']);
function sectionText(doc) {
  const bodies = descendants(doc, 'body');
  if (doc.documentElement.localName !== 'html' || bodies.length !== 1) fail('A required EPUB section is not an XHTML document with one body.');
  const out = [], stack = [{ node: bodies[0] }]; let length = 0, visited = 0, omittedMedia = false;
  function push(text) { length += text.length; if (length > MAX_TEXT * 2) fail('An EPUB section exceeds the supported text size.'); out.push(text); }
  while (stack.length) {
    const item = stack.pop();
    if (item.after) { push(item.after); continue; }
    const node = item.node;
    if (++visited > 250000) fail('An EPUB section has too many text elements to import safely.');
    if (node.nodeType === 3 || node.nodeType === 4) { push(node.nodeValue.replace(/\s+/gu, ' ')); continue; }
    if (node.nodeType !== 1 || hidden(node)) continue;
    const name = node.localName.toLowerCase();
    if (OMIT.has(name) || name === 'img') { if (['img', 'svg', 'canvas', 'audio', 'video', 'object', 'embed'].includes(name)) omittedMedia = true; continue; }
    if (name === 'br') { push('\n'); continue; }
    let after = '';
    if (/^h[1-6]$/.test(name)) { push('\n\n' + '#'.repeat(Number(name[1])) + ' '); after = '\n\n'; }
    else if (name === 'li') { push('\n- '); after = '\n'; }
    else if (name === 'td' || name === 'th') after = ' | ';
    else if (BLOCK.has(name)) { push('\n\n'); after = '\n\n'; }
    if (after) stack.push({ after });
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i] });
  }
  const text = out.join('').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, omittedMedia };
}
export async function extractEpub(file, { onProgress = () => {} } = {}) {
  onProgress('Opening EPUB…');
  const zip = await openZip(file);
  if (decoder.decode(await zip.read('mimetype')).trim() !== 'application/epub+zip') fail('This ZIP file is not an EPUB book.');
  const container = xml(await zip.read('META-INF/container.xml'), 'container');
  const rootfile = descendants(container, 'rootfile')[0];
  if (!rootfile || rootfile.getAttribute('media-type') !== 'application/oebps-package+xml') fail('The EPUB does not identify a supported package document.');
  const packagePath = resolvePath('', rootfile.getAttribute('full-path'));
  const encrypted = new Set();
  if (zip.has('META-INF/encryption.xml')) {
    const encryption = xml(await zip.read('META-INF/encryption.xml'), 'encryption manifest');
    for (const ref of descendants(encryption, 'CipherReference')) encrypted.add(resolvePath('', ref.getAttribute('URI')));
  }
  if (encrypted.has(packagePath)) fail('The EPUB package is DRM-encrypted. Import an unencrypted EPUB you are allowed to read.');
  const pkg = xml(await zip.read(packagePath), 'package'), packageElement = pkg.documentElement;
  const manifest = children(packageElement, 'manifest')[0], spine = children(packageElement, 'spine')[0];
  if (packageElement.localName !== 'package' || !manifest || !spine) fail('The EPUB package has no valid manifest and reading order.');
  const items = new Map();
  for (const item of children(manifest, 'item')) {
    const id = item.getAttribute('id');
    if (!id || items.has(id)) fail('The EPUB manifest contains missing or duplicate item identifiers.');
    items.set(id, item);
  }
  const warnings = [], parts = []; let characters = 0, skipped = 0, empty = 0, media = false;
  const refs = children(spine, 'itemref');
  if (!refs.length) fail('The EPUB reading order is empty.');
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (ref.getAttribute('linear') === 'no') { skipped++; continue; }
    const item = items.get(ref.getAttribute('idref'));
    if (!item) fail('A required EPUB section is missing from its manifest.');
    if (item.getAttribute('media-type') !== 'application/xhtml+xml') fail('A required EPUB section is not supported XHTML. The book was not partially imported.');
    const path = resolvePath(packagePath, item.getAttribute('href'));
    if (encrypted.has(path)) fail('A required EPUB section is DRM-encrypted. Import an unencrypted EPUB you are allowed to read.');
    onProgress(`Reading EPUB section ${i + 1} of ${refs.length}…`);
    const extracted = sectionText(xml(await zip.read(path), `section ${i + 1}`));
    if (!extracted.text) empty++; else { characters += extracted.text.length + (parts.length ? 2 : 0); if (characters > MAX_TEXT) fail('This reader supports up to two million text characters per book. The EPUB was not truncated.'); parts.push(extracted.text); }
    media ||= extracted.omittedMedia;
  }
  if (!parts.length) fail('The EPUB has no readable text. Image-only books need OCR before importing.');
  if (skipped) warnings.push(`${skipped} optional sections outside the main reading order were skipped.`);
  if (empty) warnings.push(`${empty} sections contained no extractable text.`);
  if (media) warnings.push('Images and embedded media were omitted; their content is not narrated.');
  const metadata = children(packageElement, 'metadata')[0];
  const title = (metadata && descendants(metadata, 'title')[0]?.textContent.trim()) || String(file.name || 'Imported EPUB').replace(/\.epub$/i, '');
  return { title: title.slice(0, 180), text: cleanText(parts.join('\n\n')), warnings };
}
