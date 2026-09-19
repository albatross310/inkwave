# Inkwave agent instructions

- Read `CLAUDE.md` before changing code; it contains the repository's detailed architecture,
  invariants, and validation rules.

## Document hydration and global CSS

- Keep `src/styles/index.css` declared as an explicit stylesheet link returned by `links()` in
  `app/root.tsx` (import it with `?url`). Do not replace it with a side-effect-only CSS import.
- Reason: browser hosts, including ChatGPT's in-app browser, may insert an element before React
  hydrates. Because this app uses `hydrateRoot(document)`, React can recover by client-rendering the
  whole document. That replacement discards Vite's side-effect-injected style element; a stylesheet
  owned by `<Links>` is recreated in the replacement `<head>` and keeps every route styled.
- After changing the document shell or global CSS, run type generation, TypeScript, and the
  production build. Confirm the emitted HTML for `/`, `/about`, `/verify`, `/privacy`, and the SPA
  fallback contains the global stylesheet link, then check at least one route in the in-app browser.

## In-app browser cursor overlay

- A black pointer with a white edge and blue glow is ChatGPT's browser-control indicator, not an
  Inkwave DOM or CSS artifact. Stop controlling/release the tab before asking the user to assess the
  final visuals. Do not change Inkwave code for that cursor unless it reproduces with browser
  control inactive.

## Browser-test reporting

- Do not attach or display browser screenshots, screenshot snippets, or other visual test captures
  in chat unless Peter explicitly asks to see one. Prefer concise text measurements and findings.
  Visual captures may be used privately for diagnosis when necessary, but keep them out of the
  conversation by default so earlier chat remains readable.
