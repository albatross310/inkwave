import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { extractEpub } from '../../public/readalong/import-epub.mjs';
globalThis.DOMParser = new JSDOM('').window.DOMParser;
function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function zip(entries, { duplicate = false, corrupt = false, declaredSize } = {}) {
  const records = [], directory = []; let offset = 0;
  for (const [index, [path, source]] of entries.entries()) {
    const name = Buffer.from(path), bytes = Buffer.from(source), method = path === 'mimetype' ? 0 : 8;
    const compressed = method ? deflateRawSync(bytes) : bytes, crc = crc32(bytes), expanded = index === entries.length - 1 && declaredSize !== undefined ? declaredSize : bytes.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(expanded, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(expanded, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    records.push(local, name, compressed); directory.push(central, name); offset += local.length + name.length + compressed.length;
    if (duplicate && index === 0) directory.push(central, name);
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length + Number(duplicate), 8); end.writeUInt16LE(entries.length + Number(duplicate), 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...records, central, end]); if (corrupt) bytes[bytes.length - central.length - 23] ^= 255;
  return Object.assign(new Blob([bytes]), { name: 'fixture.epub' });
}
const xhtml = content => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored document title</title></head><body>${content}</body></html>`;
function fixture({ first = '<h1>First section</h1><p>Readable first paragraph.</p>', second = '<h2>Second section</h2><p>Readable second paragraph.</p>', spine = '<itemref idref="first"/><itemref idref="second"/>', firstHref = '../Text/Chapter%201.xhtml', firstType = 'application/xhtml+xml', extra = [] } = {}) {
  return [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OPS/Book/package.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Spine &amp; hierarchy</dc:title></metadata><manifest><item id="second" href="./chapter2.xhtml" media-type="application/xhtml+xml"/><item id="first" href="${firstHref}" media-type="${firstType}"/></manifest><spine>${spine}</spine></package>`],
    ['OPS/Book/chapter2.xhtml', xhtml(second)],
    ['OPS/Text/Chapter 1.xhtml', xhtml(first)], ...extra,
  ];
}
test('EPUB imports deflated sections in spine order with metadata, encoded relative paths and headings', async () => {
  const progress = [];
  const result = await extractEpub(zip(fixture()), { onProgress: message => progress.push(message) });
  assert.equal(result.title, 'Spine & hierarchy');
  assert.equal(result.text, '# First section\n\nReadable first paragraph.\n\n## Second section\n\nReadable second paragraph.');
  assert.deepEqual(result.warnings, []);
  assert.ok(progress.some(message => message.includes('section 2')));
});
test('scripts, navigation, hidden nodes and embedded resources never become narrated text', async () => {
  const result = await extractEpub(zip(fixture({ first: '<h1>Visible heading</h1><p>Safe <em>inline</em> prose.</p><script>globalThis.epubExecuted = true</script><style>secret CSS</style><nav>Navigation prose</nav><div hidden="">Hidden prose</div><span aria-hidden="true">ARIA hidden</span><p style="display:none!important">CSS hidden</p><iframe src="https://attacker.invalid">Frame text</iframe><object data="https://attacker.invalid">Object text</object><img src="https://attacker.invalid" onerror="globalThis.epubExecuted=true"/><svg xmlns="http://www.w3.org/2000/svg"><text>SVG hidden text</text></svg>' })));
  assert.match(result.text, /Visible heading\n\nSafe inline prose/);
  for (const forbidden of ['epubExecuted', 'secret CSS', 'Navigation prose', 'Hidden prose', 'ARIA hidden', 'CSS hidden', 'Frame text', 'Object text', 'SVG hidden text']) assert.ok(!result.text.includes(forbidden));
  assert.equal(globalThis.epubExecuted, undefined);
  assert.ok(result.warnings.some(w => w.includes('Images')));
});
test('a missing or unsupported linear section aborts rather than silently importing half a book', async () => {
  await assert.rejects(extractEpub(zip(fixture({ firstHref: '../Text/missing.xhtml' }))), /missing a required section/);
  await assert.rejects(extractEpub(zip(fixture({ firstType: 'image/svg+xml' }))), /not supported XHTML/);
  await assert.rejects(extractEpub(zip(fixture({ spine: '<itemref idref="missing"/>' }))), /missing from its manifest/);
});
test('nonlinear material may be skipped with a visible warning', async () => {
  const result = await extractEpub(zip(fixture({ firstType: 'image/svg+xml', spine: '<itemref idref="first" linear="no"/><itemref idref="second"/>' })));
  assert.ok(!result.text.includes('First section')); assert.match(result.text, /Second section/);
  assert.ok(result.warnings.some(w => w.includes('optional sections')));
});
test('encrypted spine content is rejected; font obfuscation does not block readable chapters', async () => {
  const encryption = path => ['META-INF/encryption.xml', `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><CipherData><CipherReference URI="${path}"/></CipherData></EncryptedData></encryption>`];
  await assert.rejects(extractEpub(zip(fixture({ extra: [encryption('OPS/Text/Chapter%201.xhtml')] }))), /DRM-encrypted/);
  assert.match((await extractEpub(zip(fixture({ extra: [encryption('OPS/Fonts/obfuscated.otf')] })))).text, /First section/);
});
test('unsafe paths, custom entities, malformed XML, duplicate ZIP names and corrupt bytes reject', async () => {
  for (const href of ['https://attacker.invalid/a.xhtml', '../../../outside.xhtml', '..%2fText/a.xhtml']) await assert.rejects(extractEpub(zip(fixture({ firstHref: href }))), /unsafe|escapes|external/);
  const entities = fixture(); entities[4][1] = '<!DOCTYPE html [<!ENTITY secret SYSTEM "file:///etc/passwd">]><html><body>&secret;</body></html>';
  await assert.rejects(extractEpub(zip(entities)), /entity declarations/);
  const broken = fixture(); broken[4][1] = '<html><body><p>Broken</body></html>';
  await assert.rejects(extractEpub(zip(broken)), /well-formed XML/);
  await assert.rejects(extractEpub(zip(fixture(), { duplicate: true })), /duplicate file paths/);
  await assert.rejects(extractEpub(zip(fixture(), { corrupt: true })), /decompressed|integrity|declared size/);
});
test('empty text and text beyond two million characters are rejected without truncation', async () => {
  await assert.rejects(extractEpub(zip(fixture({ first: '<img src="one.jpg"/>', second: '<nav>Only navigation</nav>' }))), /no readable text/);
  await assert.rejects(extractEpub(zip(fixture({ first: `<p>${'x'.repeat(2_000_001)}</p>` }))), /two million/);
});
test('file and actual decompression output limits do not trust ZIP declared sizes', async () => {
  await assert.rejects(extractEpub({ size: 50_000_001, arrayBuffer() { throw new Error('Should not read'); } }), /50 MB/);
  await assert.rejects(extractEpub(zip(fixture({ first: `<p>${'x'.repeat(100000)}</p>` }), { declaredSize: 10 })), /expands beyond/);
  await assert.rejects(extractEpub(zip(fixture(), { declaredSize: 8_000_001 })), /expansion limit/);
});
test('standard EPUB 2 named entities work without loading DTDs or changing CDATA', async () => {
  const entries = fixture();
  entries[4][1] = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "https://attacker.invalid/xhtml.dtd">' + xhtml('<p>One&nbsp;word &mdash; a &ldquo;quote&rdquo;.</p><p><![CDATA[Literal &nbsp; text]]></p>');
  const result = await extractEpub(zip(entries));
  assert.match(result.text, /One word — a “quote”\./);
  assert.match(result.text, /Literal &nbsp; text/);
});
test('the 20 MB expansion budget is shared across required XML sections', async () => {
  const padding = '<!--' + ' '.repeat(7_000_000) + '-->';
  const entries = fixture({ first: padding + '<p>First.</p>', second: padding + '<p>Second.</p>' });
  entries[2][1] = entries[2][1].replace('</manifest>', '<item id="third" href="third.xhtml" media-type="application/xhtml+xml"/></manifest>').replace('</spine>', '<itemref idref="third"/></spine>');
  entries.push(['OPS/Book/third.xhtml', xhtml(padding + '<p>Third.</p>')]);
  await assert.rejects(extractEpub(zip(entries)), /20 MB total/);
});
