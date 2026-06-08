import type { ReactNode, RefObject } from 'react'

// The scroll "paper" chrome — the white page surface, the parchment column with its drop
// shadow, and (for now) a wooden roller at the BOTTOM only. Shared by BOTH the live editor
// (TiptapEditor) and the prerendered/loading shell (EditorShell) so the static landing page
// is a direct visual function of the same components + CSS. Style changes here flow to both.
//
// The TOP roller was removed and the page is pulled up near the top of the viewport (see the
// `.inkwave-editor-surface` rule in styles/index.css). Long-term this becomes a vectorised
// torn-paper edge; keeping the chrome in one shared component is what makes that a one-place change.
export function Scroll({
  children,
  paperRef,
  containerRef,
}: {
  children: ReactNode
  paperRef?: RefObject<HTMLDivElement>
  containerRef?: RefObject<HTMLDivElement>
}) {
  return (
    <div className="inkwave-editor-surface">
      {/* Parchment column — slightly wider than the text measure */}
      <div
        ref={paperRef}
        className="mx-auto w-full max-w-[600px] md:max-w-[780px]"
        style={{
          // box-shadow (not filter: drop-shadow) so the absolutely-positioned cycle card
          // rendered inside doesn't feed its pixels into the shadow — drop-shadow re-rasterises
          // the whole parchment on every reel frame.
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(80,50,10,0.22), 0 2px 6px rgba(80,50,10,0.18)',
        }}
      >
        {/* Parchment paper body. Top corners are rounded here (the top roller used to provide
            that); the bottom roller rounds the bottom. */}
        <div className="scroll-paper relative px-2 pt-8 pb-24" style={{ borderRadius: '8px 8px 0 0' }}>
          <div className="mx-auto w-full max-w-[560px] md:max-w-[720px] relative" ref={containerRef}>
            {children}
          </div>
        </div>

        {/* Bottom scroll head */}
        <ScrollHead position="bottom" />
      </div>
    </div>
  )
}

// A static facsimile of the EMPTY ProseMirror surface — same classes as the live editor, so it
// paints identically. Used in the prerendered shell and while the document loads; the real
// editor mounts in its place client-side with no visual jump.
export function EmptyEditorSurface() {
  return (
    <div className="tiptap-editor ProseMirror" aria-hidden="true">
      <p>
        <br />
      </p>
    </div>
  )
}

function ScrollHead({ position }: { position: 'top' | 'bottom' }) {
  const isTop = position === 'top'
  const brOuter = isTop ? '8px 8px 0 0' : '0 0 8px 8px'
  const brL = isTop ? '8px 0 0 0' : '0 0 0 8px'
  const brR = isTop ? '0 8px 0 0' : '0 0 8px 0'

  return (
    <div
      aria-hidden="true"
      style={{
        height: '36px',
        width: '100%',
        position: 'relative',
        borderRadius: brOuter,
        overflow: 'hidden',
        // Cylinder gradient: very dark top edge → warm wood → bright highlight band → lit face → darkening back → very dark bottom edge
        background:
          'linear-gradient(to bottom, #160901 0%, #5a2e06 5%, #a86018 13%, #d99430 22%, #f8d060 30%, #fce070 36%, #eab030 46%, #b87020 58%, #7a4010 72%, #3e1e06 86%, #140800 100%)',
      }}
    >
      {/* Subtle horizontal wood grain */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: brOuter,
          backgroundImage:
            'repeating-linear-gradient(to bottom, transparent 0px, transparent 4px, rgba(0,0,0,0.045) 4px, rgba(0,0,0,0.045) 5px)',
        }}
      />

      {/* Primary glint — bright highlight near the top of the curve */}
      <div
        style={{
          position: 'absolute',
          top: '22%',
          left: '8%',
          right: '8%',
          height: '16%',
          background:
            'linear-gradient(to right, transparent, rgba(255,253,225,0.72) 22%, rgba(255,255,248,0.94) 50%, rgba(255,253,225,0.72) 78%, transparent)',
          borderRadius: '6px',
        }}
      />

      {/* Soft secondary reflection on the lower curve */}
      <div
        style={{
          position: 'absolute',
          bottom: '16%',
          left: '20%',
          right: '20%',
          height: '8%',
          background: 'linear-gradient(to right, transparent, rgba(215,155,45,0.24) 50%, transparent)',
          borderRadius: '4px',
        }}
      />

      {/* Left end-cap — multi-stop dark wedge simulating the cylinder turning at the edge */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '36px',
          background:
            'linear-gradient(to right, rgba(6,2,0,0.92) 0px, rgba(18,7,0,0.68) 8px, rgba(35,14,0,0.35) 20px, transparent 36px)',
          borderRadius: brL,
        }}
      />

      {/* Right end-cap */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '36px',
          background:
            'linear-gradient(to left, rgba(6,2,0,0.92) 0px, rgba(18,7,0,0.68) 8px, rgba(35,14,0,0.35) 20px, transparent 36px)',
          borderRadius: brR,
        }}
      />

      {/* Paper-contact shadow — parchment wraps tightly around the roller here */}
      <div
        style={{
          position: 'absolute',
          ...(isTop ? { bottom: 0 } : { top: 0 }),
          left: 0,
          right: 0,
          height: '10px',
          background: isTop
            ? 'linear-gradient(to top, rgba(0,0,0,0.52), transparent)'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.52), transparent)',
        }}
      />
    </div>
  )
}
