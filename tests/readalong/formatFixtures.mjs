/** Small synthetic books: no network, user files, or fixture-generation dependencies. */
import { deflateRawSync } from 'node:zlib';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), plain = Buffer.from(value);
    const method = name === 'mimetype' ? 0 : 8;
    const compressed = method ? deflateRawSync(plain) : plain;
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(plain), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(plain.length, 22); header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc32(plain), 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(plain.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed); central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directories = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directories.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directories, end]);
}
const xml = body => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const xhtml = body => xml(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture chapter</title><link rel="stylesheet" href="https://epub.invalid/remote.css"/><style>@import url(https://epub.invalid/injected.css);</style></head><body>${body}</body></html>`);
export function epubFixture({ empty = false, brokenSpine = false, drm = false } = {}) {
  const first = empty ? '' : `<h1>Chapter One</h1><p>FIRST SPINE PASSAGE. The writer keeps the original sequence.</p><p>Visible <em>inline emphasis</em> survives as plain text.</p>
<script>window.__epubExecuted = true; fetch('/readalong-fixture-executed');</script>
<img src="https://epub.invalid/image.png" onerror="window.__epubExecuted = true"/>
<iframe src="https://epub.invalid/frame">FORBIDDEN FRAME TEXT</iframe><object data="https://epub.invalid/object">FORBIDDEN OBJECT TEXT</object>
<div hidden="hidden">FORBIDDEN HIDDEN TEXT</div><nav>FORBIDDEN NAVIGATION TEXT</nav>`;
  const second = empty ? '' : '<h1>Chapter Two</h1><p>SECOND SPINE PASSAGE. This belongs after the first chapter.</p>';
  const entries = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', xml('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
    ['Book/package.opf', xml(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">synthetic-fixture</dc:identifier><dc:title>Spine Order Fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="second" href="a-second.xhtml" media-type="application/xhtml+xml"/><item id="first" href="z-first.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="${brokenSpine ? 'missing' : 'first'}"/><itemref idref="second"/></spine></package>`) ],
    // ZIP order and alphabetic filename order both disagree with spine order.
    ['Book/a-second.xhtml', xhtml(second)],
    ['Book/z-first.xhtml', xhtml(first)],
  ];
  if (drm) entries.push(['META-INF/encryption.xml', xml('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="Book/z-first.xhtml"/></CipherData></EncryptedData></encryption>')]);
  return zip(entries);
}
function pdfString(text) { return `(${text.replace(/[\\()]/g, '\\$&')})`; }
export function pdfFixture({ pages = [
  ['Chapter One', 'FIRST PDF PAGE. A quiet room and a clear beginning.'],
  ['Chapter Two', 'SECOND PDF PAGE. The sequence continues on page two.'],
], imageOnly = false } = {}) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const page = objects.length, stream = page + 1; kids.push(`${page} 0 R`);
    const content = imageOnly ? 'q 100 0 0 100 72 650 cm /Im1 Do Q' : `BT /F1 18 Tf 72 720 Td ${lines.map((line, index) => `${index ? '0 -32 Td ' : ''}${pdfString(line)} Tj`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${imageOnly ? `/XObject << /Im1 ${4 + pages.length * 2} 0 R >>` : ''} >> /Contents ${stream} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  if (imageOnly) objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream');
  const info = objects.length; objects.push(`<< /Title ${pdfString(imageOnly ? 'Scanned Fixture' : 'Two Page Fixture')} >>`);
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
