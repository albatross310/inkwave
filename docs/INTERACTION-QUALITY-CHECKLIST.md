# Interaction quality pass — 8 September 2026

Peter's current priority is scroll, zoom and panel-slide quality. Loading optimisation is deferred.

- [ ] GPU zoom keeps text font, layout and rendering mode stable on WebKit.
- [ ] Shift takes control from vertical scrolling immediately and preserves the final input sample.
- [ ] Whole-page zoom has a modest, bounded coast in Chrome and smooth motion in WebKit.
- [ ] Page-edge, text-margin and 100% text wells catch releases from either direction and remain easy to cross.
- [ ] Zoom stays centred until the inner well, then anchors horizontally to the cursor without a jump.
- [ ] Same-gesture reversal restores the original top/bottom reading anchor after clamping.
- [ ] Each panel retains its own GPU zoom, text zoom, horizontal position and vertical reading position.
- [ ] Adjacent preview and landed live page have the same geometry and text at a non-default zoom.
- [ ] Slide follows input horizontally; its release continues smoothly without a second animation or fade.
- [ ] Water position and motion remain continuous during the slide, editor remount and scroll restoration.
- [ ] A fresh stroke can reverse direction without being swallowed by old momentum or an old animation.
- [x] Startup begins white, then gradient, waves, tip and twinkles appear together (no further loading optimisation).
- [ ] Targeted interaction tests, browser proofs, type generation/TypeScript and production build pass.
- [x] Required global-stylesheet links are present on all prerendered pages and the SPA fallback; `/about` is styled in the in-app browser.
- [ ] Peter manually assesses the resulting feel on Chrome and the installed Safari PWA.

Browser probes use disposable local documents. A Playwright WebKit run does not establish the
physical trackpad feel of the installed Safari PWA; that final assessment remains explicit.

Validation checkpoint: 303 test files / 3,360 tests passed, 2 skipped; type generation and
TypeScript passed. Final zoom-return and pagination scroll-ownership fixes are undergoing
their targeted browser checks after this checkpoint.

Regression found during the slide check: resting-wave canvas eligibility depended on loading
coverage, which returning workspace panels intentionally skip. The live editor now has an explicit
identity marker; both initially covered and immediately revealed desktop editors get the same
water renderer, while the temporary loading shell and phones remain excluded. Three new
eligibility cases and the existing water lifecycle/continuity tests pass (16 tests total).

Email development and the remaining broader backlog are recorded in
[GMAIL-CONNECTED-MAILBOX-NEXT-STEPS.md](GMAIL-CONNECTED-MAILBOX-NEXT-STEPS.md).
