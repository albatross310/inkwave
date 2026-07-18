// ─── The music bar — the second-bar layer the toolbar's ♪ slot opens ─────────
// OWNER SPLIT (CLAUDE.md coordination, 2026-07-17): the TOOLBAR lane owns the SHELL — the ♪ slot
// trigger, the mutual-exclusion with the style/review bars (activeBar holds ONE BarLayerId), and
// this bar's collapse animation, all in TiptapEditor. The MUSIC lane (feat/music-piece-photo) owns
// the BODY: it fills or replaces THIS component. The seam is the contract (BarLayerId 'music' +
// `activeBar === 'music'`), so the two lanes do not collide in TiptapEditor's JSX — the music lane
// edits this file (or swaps the import), never the bar row.
//
// Peter's spec for what sits here (toolbarContract.ts BarLayerId comment, verbatim intent):
//   [turn this photo into a piece]  ·  [add youtube/mp3]
// Those are the music lane's features; they are labelled placeholders until it wires them. This whole
// bar is behind the default-OFF `?music` flag (src/music/flag.ts), so it is invisible on the live
// toolbar for every real writer until the music module ships — exactly like the clock is invisible
// without `?prodLedger`.
//
// NIGHT MODE (mandatory, CLAUDE.md): `iw-nightable` opts the surface into the themed palette; any
// custom colour is a token with a day fallback, never a bare hex. `iw-touch-guard` so a tap in the
// bar does not blur the editor and retract the iOS keyboard (the footer-menu rule).

interface MusicBarProps {
  phone?: boolean
}

/** A placeholder pill the music lane replaces with a real action. Deliberately inert here — the
 *  toolbar lane does not own the music panel's behaviour, only the door that reveals this row. */
function StubAction({ label, hint }: { label: string; hint: string }): JSX.Element {
  return (
    <button
      type="button"
      title={hint}
      // Inert on purpose: the toolbar lane wires the DOOR, the music lane wires the ACTION. Kept
      // focusable + labelled so the seam is legible rather than a mystery dead pill.
      aria-disabled="true"
      onClick={(e) => e.preventDefault()}
      className="flex items-center gap-1.5 px-3 min-h-[38px] rounded-full border-[1.5px] text-sm whitespace-nowrap transition-colors"
      style={{
        borderColor: 'var(--iw-nightable-border, #e7e5e4)',
        color: 'var(--iw-pill-fg, #78716c)',
      }}
    >
      {label}
    </button>
  )
}

export function MusicBar({ phone }: MusicBarProps): JSX.Element {
  return (
    <div
      className={`iw-nightable iw-touch-guard flex items-center ${phone ? 'px-1.5 gap-1.5' : 'px-4 gap-2'} py-2 border-b border-stone-200`}
    >
      <span
        className="text-xs italic mr-1 select-none"
        style={{ color: 'var(--iw-pill-fg, #78716c)' }}
        aria-hidden="true"
      >
        ♪ music
      </span>
      <StubAction label="Turn photo into a piece" hint="Music module — coming from feat/music-piece-photo" />
      <StubAction label="Add YouTube / MP3" hint="Music module — coming from feat/music-piece-photo" />
    </div>
  )
}
