// Email header handling — PURE, no DOM, no network. §B2.1.
//
// An email is an ordinary Inkwave document whose BODY is contentJson; this module owns the
// structured header fields that sit beside it. Two jobs, kept apart on purpose:
//
//   • parseAddressList — forgiving INPUT parsing (what the user typed into a field);
//   • normaliseHeaders — the CANONICAL form that gets hashed and anchored (§B2.2).
//
// The canonical form is load-bearing: `emailHeadersHash` runs over it, that hash goes into the
// snapshot's bundleHash, and the bundleHash is what OTS anchors to Bitcoin. So "the same header set"
// must mean ONE byte string forever — hence lowercasing the domain-bearing address, collapsing
// whitespace, and de-duplicating. Anything that changes here changes what past anchors mean, so
// treat it exactly like pmToText: a provenance boundary, not a style preference.

import type { EmailHeaders } from '../types/document'

// ─── Address parsing ─────────────────────────────────────────────────────────

/**
 * Split a user-typed recipient string into individual addresses. Accepts comma OR semicolon
 * separators (both are habitual, and Outlook trains semicolons) and tolerates stray whitespace.
 * Display-name forms ("Ada Lovelace <ada@example.com>") are preserved verbatim — we are not an MUA
 * and must not silently rewrite what the user intends to send.
 */
export function parseAddressList(input: string): string[] {
  return input
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Is this plausibly an email address? Deliberately PERMISSIVE — RFC 5322 is far wider than any
 * regex, the provider does the real validation at send time, and refusing to hash a draft because
 * our regex disliked a legal address would be a worse failure than letting it through. This gates a
 * UI warning, never the ability to write or anchor.
 */
export function looksLikeAddress(addr: string): boolean {
  const bare = extractAddress(addr)
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(bare)
}

/** Pull `ada@example.com` out of `Ada Lovelace <ada@example.com>`; returns the input if unwrapped. */
export function extractAddress(addr: string): string {
  const m = addr.match(/<([^>]*)>\s*$/)
  return (m ? m[1] : addr).trim()
}

// ─── Canonicalisation (the hashed form) ──────────────────────────────────────

/**
 * Canonicalise ONE address for hashing. The address part is lowercased — mail domains are
 * case-insensitive and Gmail/Outlook both fold the local part in practice, so `Ada@Example.com` and
 * `ada@example.com` are the same recipient and must not produce two different anchored claims. Any
 * display name is kept (it is part of what the writer committed to) but its whitespace is collapsed.
 */
export function canonicaliseAddress(addr: string): string {
  const trimmed = addr.trim().replace(/\s+/g, ' ')
  const m = trimmed.match(/^(.*)<([^>]*)>$/)
  if (m) {
    const name = m[1].trim()
    const mail = m[2].trim().toLowerCase()
    return name ? `${name} <${mail}>` : mail
  }
  return trimmed.toLowerCase()
}

/** Canonicalise a list: per-address canonical form, empties dropped, duplicates removed, order kept. */
function canonicaliseList(list: readonly string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list ?? []) {
    const a = canonicaliseAddress(raw)
    if (!a || seen.has(a)) continue
    seen.add(a)
    out.push(a)
  }
  return out
}

/**
 * The canonical header set that gets hashed and anchored. Subject whitespace is collapsed and
 * trimmed (a trailing space is not a different subject); cc/bcc always become arrays.
 */
export function normaliseHeaders(headers: EmailHeaders): Required<Omit<EmailHeaders, 'cc' | 'bcc'>> & {
  cc: string[]
  bcc: string[]
} {
  return {
    to: canonicaliseList(headers.to),
    cc: canonicaliseList(headers.cc),
    bcc: canonicaliseList(headers.bcc),
    subject: headers.subject.trim().replace(/\s+/g, ' '),
  }
}

// ─── Readiness ───────────────────────────────────────────────────────────────

/** Is this draft addressable? At least one recipient — the only genuine precondition for a handoff. */
export function hasRecipient(headers: EmailHeaders): boolean {
  return normaliseHeaders(headers).to.length > 0
}

/** Recipients whose form we could not recognise — surfaced as a warning, never a block. */
export function suspectAddresses(headers: EmailHeaders): string[] {
  const h = normaliseHeaders(headers)
  return [...h.to, ...h.cc, ...h.bcc].filter((a) => !looksLikeAddress(a))
}
