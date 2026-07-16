// The MailSender seam (§B3) — PURE types + the handoff adapter's URL building.
//
// Sending is provider-specific, so every path goes behind ONE interface. Today exactly one adapter
// exists: `handoff`, which opens the provider's own compose window pre-filled (§B2.3a). The Gmail
// API adapter (`gmail.send`, Phase 2) is EXPLICITLY NOT BUILT — it needs Google's restricted-scope
// verification — but it slots in here as another MailSender with no rework of the compose, ledger or
// provenance paths, which is the whole point of the interface existing this early.
//
// SCOPE DISCIPLINE (§B5): if/when an API adapter lands it requests SEND-ONLY permission. Never
// inbox-read. Not for provenance, not for anything.

import type { EmailHeaders } from '../types/document'
import { normaliseHeaders } from './headers'

// ─── The interface ───────────────────────────────────────────────────────────

export type MailSenderId = 'gmail-handoff' | 'outlook-handoff' | 'mailto'

/** What a send attempt did. `handed-off` is deliberately NOT `sent` — see the honesty note below. */
export interface SendOutcome {
  // 'handed-off' = we opened the provider's compose window with the draft in it. We do NOT know
  // whether the user sent it, edited it first, or closed the tab. Only an API adapter that controls
  // the bytes could ever report a true 'sent', and that is Phase 2. Do not add a 'sent' variant to
  // the handoff path — it would be a lie the type system currently prevents.
  kind: 'handed-off' | 'failed'
  reason?: string
}

export interface MailDraft {
  headers: EmailHeaders
  /** The body as plain text. The handoff carries plain text only — see the limits below. */
  body: string
}

export interface MailSender {
  id: MailSenderId
  label: string
  /**
   * True if this sender can carry the draft faithfully. The handoff adapters answer FALSE on
   * over-long drafts rather than silently truncating the user's email into a URL.
   */
  canCarry(draft: MailDraft): { ok: boolean; reason?: string }
  send(draft: MailDraft): Promise<SendOutcome>
}

// ─── URL length limits ───────────────────────────────────────────────────────
// These are the honest, conservative end of a genuinely fuzzy range: the limit is imposed by the
// browser, the OS URL handler and the provider, not by us, and it differs across all three. We
// under-promise deliberately — a draft that "fits" and then arrives truncated at the provider is
// exactly the failure the user cannot see until it matters.

/** `mailto:` goes through the OS handler; ~2000 chars is the widely-safe ceiling (IE's old 2083 limit
 *  still echoes through Windows' handler chain). */
export const MAILTO_MAX = 2000
/** Provider web-compose URLs tolerate more, but Chrome/Safari and intermediate redirects still cap a
 *  URL well below the theoretical maximum. 8000 is the conventional safe bound. */
export const WEB_COMPOSE_MAX = 8000

// ─── URL builders (pure — the testable core) ─────────────────────────────────

function q(params: Record<string, string | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.join('&')
}

/** Gmail's web compose deep-link (§B2.3a). No OAuth, no API — just a pre-filled compose window. */
export function buildGmailUrl(draft: MailDraft): string {
  const h = normaliseHeaders(draft.headers)
  return 'https://mail.google.com/mail/?view=cm&fs=1&' + q({
    to: h.to.join(','),
    cc: h.cc.length ? h.cc.join(',') : undefined,
    bcc: h.bcc.length ? h.bcc.join(',') : undefined,
    su: h.subject || undefined,
    body: draft.body || undefined,
  })
}

/** Outlook web compose deep-link. */
export function buildOutlookUrl(draft: MailDraft): string {
  const h = normaliseHeaders(draft.headers)
  return 'https://outlook.office.com/mail/deeplink/compose?' + q({
    to: h.to.join(','),
    cc: h.cc.length ? h.cc.join(',') : undefined,
    bcc: h.bcc.length ? h.bcc.join(',') : undefined,
    subject: h.subject || undefined,
    body: draft.body || undefined,
  })
}

/** `mailto:` — the universal fallback; whatever the user's default mail client is. */
export function buildMailto(draft: MailDraft): string {
  const h = normaliseHeaders(draft.headers)
  const query = q({
    cc: h.cc.length ? h.cc.join(',') : undefined,
    bcc: h.bcc.length ? h.bcc.join(',') : undefined,
    subject: h.subject || undefined,
    body: draft.body || undefined,
  })
  // The `to` list sits in the path, not the query, and must be encoded per-address so that the
  // comma separators survive as separators.
  const to = h.to.map((a) => encodeURIComponent(a)).join(',')
  return `mailto:${to}${query ? '?' + query : ''}`
}

export function urlFor(id: MailSenderId, draft: MailDraft): string {
  switch (id) {
    case 'gmail-handoff': return buildGmailUrl(draft)
    case 'outlook-handoff': return buildOutlookUrl(draft)
    case 'mailto': return buildMailto(draft)
  }
}

const LIMIT: Record<MailSenderId, number> = {
  'gmail-handoff': WEB_COMPOSE_MAX,
  'outlook-handoff': WEB_COMPOSE_MAX,
  'mailto': MAILTO_MAX,
}

/** Does the built URL fit? The pure check behind every adapter's canCarry. */
export function fits(id: MailSenderId, draft: MailDraft): { ok: boolean; length: number; max: number; reason?: string } {
  const length = urlFor(id, draft).length
  const max = LIMIT[id]
  return length <= max
    ? { ok: true, length, max }
    : {
        ok: false, length, max,
        reason: `This draft is too long to hand off through ${id === 'mailto' ? 'your mail app' : 'a compose link'} (${length} characters, limit ${max}). Copy the text across instead — your draft and its record are unaffected.`,
      }
}

// ─── The handoff adapters ────────────────────────────────────────────────────

/**
 * Build a handoff sender. `open` is injected so the whole adapter is testable without a DOM and so
 * the caller owns the window-opening (which must happen inside the click's transient activation —
 * a deferred open is a popup block).
 */
export function handoffSender(
  id: MailSenderId,
  label: string,
  open: (url: string) => void,
): MailSender {
  return {
    id,
    label,
    canCarry: (draft) => {
      const f = fits(id, draft)
      return f.ok ? { ok: true } : { ok: false, reason: f.reason }
    },
    send: async (draft) => {
      const f = fits(id, draft)
      if (!f.ok) return { kind: 'failed', reason: f.reason }
      try {
        open(urlFor(id, draft))
        return { kind: 'handed-off' }
      } catch (e) {
        return { kind: 'failed', reason: e instanceof Error ? e.message : 'could not open the compose window' }
      }
    },
  }
}
