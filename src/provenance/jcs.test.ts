// ─── THE JCS CORPUS — one canonical string, pinned, from BOTH ends of the wire ───
//
// Every receipt the signing service issues is an Ed25519 signature over `canonicalize(core)`; every
// verifier recomputes that string. If the client's canonicaliser and the server's ever differ by one
// byte, every receipt ever signed becomes unverifiable and nothing in the app says why (a failed
// verification renders as "could not verify", the honest wording for an innocent cause).
//
// This file pins the EXACT canonical string AND its SHA-256 for a hand-written corpus, and asserts
// it from three independent places: the client canonicaliser (`src/provenance/hash.ts`), the server
// canonicaliser (`api/_provenance-core.mjs`, the real Node module the functions run), and a SHA-256
// hex computed OFFLINE with Python's hashlib (neither WebCrypto nor @noble). Expected strings were
// written by hand from RFC 8785 (§3.2.2.2 string escaping, §3.2.2.3 ES Number::toString,
// §3.2.3 UTF-16 code-unit key order — including the RFC's own §3.2.3 sorting example verbatim).
//
// PINNED, NOT ENDORSED. Three behaviours below are what BOTH copies do and are outside RFC 8785:
// a SPARSE array hole renders as an empty slot (`[1,,3]`, not valid JSON), a non-JSON object (Date,
// Map, boxed Number) renders as `{}`, and a lone surrogate is `\udXXX`-escaped. None can arrive
// over the wire (JSON.parse never produces them) so no receipt ever contained one; they are pinned
// so a "fix" is a deliberate, visible act — any change here re-hashes every receipt ever signed.
//
// Written BEFORE the canonicaliser was extracted to one shared module, against both unmoved copies
// (docs/RULES.md R6; CLAUDE.md "write the characterization test before the move"). After the
// extraction the two imports below still exercise both public entry points, and mutating the shared
// module reddens every pin on both sides — that is the seam this file exists to hold.

import { describe, it, expect } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { canonicalize as clientCanonicalize, sha256Hex as clientSha256Hex } from './hash'
// The REAL server core (Node ESM outside the TS project — `declare module '*.mjs'`), as the M3
// interop tests import it. The shape is asserted at this boundary and nowhere else.
import * as serverCore from '../../api/_provenance-core.mjs'

const { canonicalize: serverCanonicalize } = serverCore as unknown as {
  canonicalize: (value: unknown) => string
}

// The server hashes with @noble (sync); this is the same call `_provenance-core.mjs` makes.
function nobleHex(s: string): string {
  let hex = ''
  for (const b of sha256(new TextEncoder().encode(s))) hex += b.toString(16).padStart(2, '0')
  return hex
}
const utf8Len = (s: string) => new TextEncoder().encode(s).length

const H0 = '0'.repeat(64), HF = 'f'.repeat(64), H1 = '1'.repeat(64), H2 = '2'.repeat(64)

interface Fixture {
  name: string
  input: () => unknown
  /** Hand-written from RFC 8785. */
  canonical: string
  /** UTF-8 byte length of `canonical` — catches a mistyped escape in the literal above. */
  bytes: number
  /** SHA-256 of `canonical`, computed offline with Python hashlib. */
  sha256: string
}

// ── the corpus ──────────────────────────────────────────────────────────────────
const CORPUS: Fixture[] = [
  {
    name: 'unsorted keys are sorted',
    input: () => ({ b: 1, a: 2, c: 3 }),
    canonical: '{"a":2,"b":1,"c":3}',
    bytes: 19,
    sha256: 'e145110e712e3ed0a6b233551b27a90aa39b4c93ed67e111ba2002d16e5ed1fa',
  },
  {
    // RFC 8785 §3.2.3, verbatim: keys sort by UTF-16 code units, so the astral emoji (D83D DE02)
    // sorts BEFORE U+FB33, and U+0080 is emitted literally (only < U+0020, `"` and `\` escape).
    name: 'RFC 8785 §3.2.3 key-order example',
    input: () => ({
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude02': 'Emoji: Smiling Face With Tears Of Joy',
      '\u0080': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    }),
    canonical:
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
      '"\u20ac":"Euro Sign","\ud83d\ude02":"Emoji: Smiling Face With Tears Of Joy","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    bytes: 197,
    sha256: 'fd46d7e869a364856b0b31977feaa1f8d7a2a3fb9e4eeaa4117545b91de7e994',
  },
  {
    // JS enumerates integer-like keys first and ascending; the sort must undo that. "" sorts first.
    name: 'integer-like and empty keys sort by code unit, not numerically',
    input: () => ({ '10': 'a', '9': 'b', b: 'c', '': 'd', A: 'e' }),
    canonical: '{"":"d","10":"a","9":"b","A":"e","b":"c"}',
    bytes: 41,
    sha256: '110a05304de9c49a3a601b13d092273bc8dc6b9d9de6b81086196f80f166264d',
  },
  {
    name: 'nested objects and arrays, empty containers, no whitespace',
    input: () => ({ z: { y: { x: [3, { b: 1, a: [] }, {}] } }, a: [[], {}] }),
    canonical: '{"a":[[],{}],"z":{"y":{"x":[3,{"a":[],"b":1},{}]}}}',
    bytes: 51,
    sha256: 'da1611c9e219caeb08f4aad929de99c998c0e45c4094380f1b3fab9cd1bcd916',
  },
  {
    name: 'undefined array members become null',
    input: () => [1, undefined, null, 'u'],
    canonical: '[1,null,null,"u"]',
    bytes: 17,
    sha256: '20b2aec4c23a4df2e45fad70a0c7add141fd83790151c5a4c39055e79599275c',
  },
  {
    name: 'undefined object members are omitted, at every depth',
    input: () => ({ a: 1, b: undefined, c: { d: undefined } }),
    canonical: '{"a":1,"c":{}}',
    bytes: 14,
    sha256: 'fc489ea1d2698870726df31498ebf8d017f61be0a543b0aefc0b1349dfe072e6',
  },
  {
    // §3.2.2.2: two-char escapes for \b \t \n \f \r " \, \u00xx (lowercase) for other controls,
    // DEL (U+007F) and `/` literal.
    name: 'string escapes: quotes, backslash, short escapes, \\u00xx controls, DEL and / literal',
    input: () => 'a"b\\c\n\t\r\b\f\u0000\u001f\u007f/',
    canonical: '"a\\"b\\\\c\\n\\t\\r\\b\\f\\u0000\\u001f\u007f/"',
    bytes: 33,
    sha256: '9dac41c75081e95861e450712de0ed9d4d25ab3645cf0b31bcb1a3cd54cbd232',
  },
  {
    // Non-ASCII, an astral pair, and the JS-special line/paragraph separators all stay literal.
    name: 'unicode is emitted literally (BMP, astral surrogate pair, U+2028/9)',
    input: () => '\u00e9\u20ac\ud83d\ude00\u2028\u2029',
    canonical: '"\u00e9\u20ac\ud83d\ude00\u2028\u2029"',
    bytes: 17,
    sha256: '9e98216ab8999bc979740347c9e64a77eeeb726efe09d8e7b594c638e364bae7',
  },
  {
    // §3.2.2.3 = ES Number::toString: -0 → 0, exponent form from 1e21 and below 1e-6, shortest
    // round-trip digits, 2^53+1 collapses to 2^53 on parse. Includes the RFC Appendix B vectors
    // 0.1 · 1e21 · 1e-7 · 0.000001 · 5e-324 · 1.7976931348623157e308 · 333333333.3333332.
    name: 'numbers: RFC 8785 §3.2.2.3 / Appendix B vectors',
    input: () => [
      0, -0, 1, -1, 0.1, 1e21, 1e-7, 0.000001, 5e-324, 1.7976931348623157e308,
      9007199254740991, 9007199254740993, 123456789012345680000, 1.0, 1e2, 333333333.3333332, -1.5e-10,
    ],
    canonical:
      '[0,0,1,-1,0.1,1e+21,1e-7,0.000001,5e-324,1.7976931348623157e+308,9007199254740991,' +
      '9007199254740992,123456789012345680000,1,100,333333333.3333332,-1.5e-10]',
    bytes: 154,
    sha256: 'e7e2bef6e4bab68b7e8dae0f834c2dcaed3de1c410c207fabe970742a853a541',
  },
  { name: 'top-level true', input: () => true, canonical: 'true', bytes: 4,
    sha256: 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b' },
  { name: 'top-level false', input: () => false, canonical: 'false', bytes: 5,
    sha256: 'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa' },
  { name: 'top-level null', input: () => null, canonical: 'null', bytes: 4,
    sha256: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b' },
  { name: 'top-level string', input: () => 'x', canonical: '"x"', bytes: 3,
    sha256: 'ba2df4903a2c14e86dc3bcca58911b44ac1d2514b7227bf6eb08cfb978f55a1b' },
  { name: 'top-level empty string', input: () => '', canonical: '""', bytes: 2,
    sha256: '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126' },
  { name: 'top-level zero', input: () => 0, canonical: '0', bytes: 1,
    sha256: '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9' },
  { name: 'empty object', input: () => ({}), canonical: '{}', bytes: 2,
    sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
  { name: 'empty array', input: () => [], canonical: '[]', bytes: 2,
    sha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
  {
    // The shape `signPeriod` actually signs (insertion order there is v, sessionToken, counter, …;
    // the wire never sees that order — only this sorted form is ever signed or verified).
    name: 'a receipt core in the exact shape signPeriod signs',
    input: () => ({
      v: 1, sessionToken: 'ab.cd', counter: 0, prevHash: H0, contentHash: HF, setVersion: 0,
      lockedSetHash: H1, kicksHash: H2, serverTime: '2026-06-13T00:00:00.000Z',
    }),
    canonical:
      `{"contentHash":"${HF}","counter":0,"kicksHash":"${H2}","lockedSetHash":"${H1}","prevHash":"${H0}",` +
      '"serverTime":"2026-06-13T00:00:00.000Z","sessionToken":"ab.cd","setVersion":0,"v":1}',
    bytes: 418,
    sha256: 'b94fc379c9ff530dab86fe2c9ee159438997dbdebe62e6029d076db0e9020a02',
  },
  {
    // The shape `contentHash` hashes (TipTap JSON). Never Peter's prose — a stock phrase.
    name: 'a TipTap document in the shape contentHash hashes',
    input: () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the writer thought' }] }] }),
    canonical: '{"content":[{"content":[{"text":"the writer thought","type":"text"}],"type":"paragraph"}],"type":"doc"}',
    bytes: 103,
    sha256: '7b85e51b71b2a5888c14d4e9f0c816fe134c87943ba437b698ce1c82ea79df66',
  },
]

// ── pinned, not endorsed (both copies agree; RFC 8785 has no such inputs) ───────
const QUIRKS: { name: string; input: () => unknown; canonical: string }[] = [
  { name: 'a SPARSE array hole renders as an empty slot (not valid JSON; JSON.parse never yields one)',
    input: () => { const a = [1, , 3]; return a }, canonical: '[1,,3]' }, // eslint-disable-line no-sparse-arrays
  { name: 'a Date renders as {} (own enumerable keys only; JSON.stringify would call toJSON)',
    input: () => new Date(0), canonical: '{}' },
  { name: 'a Map renders as {}', input: () => new Map([[1, 2]]), canonical: '{}' },
  { name: 'a boxed Number renders as {}', input: () => new Number(1), canonical: '{}' },
  { name: 'a lone surrogate is \\udXXX-escaped (ES well-formed stringify; the RFC is silent)',
    input: () => '\ud800', canonical: '"\\ud800"' },
]

const THROWS: { name: string; input: () => unknown }[] = [
  { name: 'NaN', input: () => NaN },
  { name: 'Infinity', input: () => Infinity },
  { name: '-Infinity', input: () => -Infinity },
  { name: 'NaN nested in an object', input: () => ({ a: [1, { b: NaN }] }) },
  { name: 'top-level undefined', input: () => undefined },
  { name: 'a function', input: () => () => 1 },
  { name: 'a bigint', input: () => 1n },
  { name: 'a symbol', input: () => Symbol('s') },
]

// ── the assertions ──────────────────────────────────────────────────────────────
describe('JCS corpus — client (hash.ts) vs server (api/_provenance-core.mjs)', () => {
  it('VOID GUARD: both canonicalisers resolved and are distinct entry points', () => {
    expect(typeof clientCanonicalize).toBe('function')
    expect(typeof serverCanonicalize).toBe('function')
    expect(CORPUS.length).toBeGreaterThanOrEqual(15)
  })

  describe.each(CORPUS)('$name', (f) => {
    it('the hand-written expectation is internally consistent (byte length)', () => {
      expect(utf8Len(f.canonical)).toBe(f.bytes)
    })
    it('client canonical string matches the hand-written RFC 8785 form', () => {
      expect(clientCanonicalize(f.input())).toBe(f.canonical)
    })
    it('server canonical string matches the hand-written RFC 8785 form', () => {
      expect(serverCanonicalize(f.input())).toBe(f.canonical)
    })
    it('client and server agree byte-for-byte', () => {
      expect(serverCanonicalize(f.input())).toBe(clientCanonicalize(f.input()))
    })
    it('client sha256Hex (WebCrypto) matches the offline hashlib hex', async () => {
      expect(await clientSha256Hex(clientCanonicalize(f.input()))).toBe(f.sha256)
    })
    it('server hash (@noble) of the server string matches the offline hashlib hex', () => {
      expect(nobleHex(serverCanonicalize(f.input()))).toBe(f.sha256)
    })
  })

  describe.each(QUIRKS)('PINNED, NOT ENDORSED: $name', (q) => {
    it('client', () => { expect(clientCanonicalize(q.input())).toBe(q.canonical) })
    it('server', () => { expect(serverCanonicalize(q.input())).toBe(q.canonical) })
  })

  describe.each(THROWS)('both throw on $name', (t) => {
    it('client throws', () => { expect(() => clientCanonicalize(t.input())).toThrow() })
    it('server throws', () => { expect(() => serverCanonicalize(t.input())).toThrow() })
  })

  describe('KNOWN-NEGATIVE: an unsorted serialisation is rejected', () => {
    // Without these the pins above are satisfiable by `JSON.stringify` alone.
    const UNSORTED = '{"b":1,"a":2}'
    const SORTED = '{"a":2,"b":1}'
    it('JSON.stringify would emit the unsorted form (so sorting is doing work)', () => {
      expect(JSON.stringify({ b: 1, a: 2 })).toBe(UNSORTED)
    })
    it('neither canonicaliser emits it', () => {
      expect(clientCanonicalize({ b: 1, a: 2 })).toBe(SORTED)
      expect(serverCanonicalize({ b: 1, a: 2 })).toBe(SORTED)
      expect(clientCanonicalize({ b: 1, a: 2 })).not.toBe(UNSORTED)
      expect(serverCanonicalize({ b: 1, a: 2 })).not.toBe(UNSORTED)
    })
    it('and the two forms hash differently (offline hashlib hexes)', async () => {
      const sortedHex = 'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772'
      const unsortedHex = 'a1d46c3cdb4e5795c8d637f80daeb578ebb1a9a65dc1ed5f11f51794c3c89f3a'
      expect(await clientSha256Hex(clientCanonicalize({ b: 1, a: 2 }))).toBe(sortedHex)
      expect(nobleHex(serverCanonicalize({ b: 1, a: 2 }))).toBe(sortedHex)
      expect(await clientSha256Hex(UNSORTED)).toBe(unsortedHex)
      expect(sortedHex).not.toBe(unsortedHex)
    })
  })
})

