# Inkwave deterministic water animation — build specification v1

**Status:** approved behavioural specification, 5 September 2026.

## 1. One complete scene

The water animation is identical on every load. A development-only, fixed-seed generator produces
one checked-in data structure containing every object coordinate, wave association, tangent angle,
opacity, introductory time window, and scroll-loop window. The browser imports that finished table;
it performs no runtime random generation and receives no continuing instructions from a server.

The whole table mounts synchronously before the atomic water gate opens. Gradient, waves, specks and
sparkles therefore become paintable in the same first frame. Atomicity applies only to this initial
reveal; it must never be implemented as a later parent-layer opacity change.

Before that gate opens, every spatial animation exists paint-hidden and paused at current time zero.
At release, each field is bound once to its corresponding wave animation and reasserted when the
browser resolves the pending CSS clocks. This is control-plane work only: there is no per-frame
JavaScript alignment, correction loop, or second running clock.

## 2. Distribution and geometry

The generator uses seeded pseudorandom sampling with an explicit minimum separation in each wave
band. Naive independent random coordinates are forbidden because they form visible clumps.

Every dash/speck stores the exact tangent angle of the wave at its horizontal coordinate and is
always parallel to that wave. It has no independent rotation animation. Sparkles occupy fixed points
around a wave. Every spatial object is carried by one of two shared fields, corresponding exactly to
the two wave directions; individual objects never own movement transforms.

## 3. Introductory series

The introduction is finite and one-shot. Each introductory speck or sparkle:

- has exactly one appearance window;
- appears independently of every other object;
- disappears once; and
- is never recycled, moved, re-jittered, or shown again during the introduction.

Objects animate opacity only. There are no collective field fades, duplicate blink/rest populations,
or population swaps. The two shared spatial fields use the same drift and additive coast animations
as the wave tiles, including the same start time and slowdown anchor. Spatial phase divergence is
therefore structurally impossible rather than corrected after detection.

## 4. Scroll series

A separate fixed population overlaps the tail of the introduction and then becomes the resting
scroll animation. Its state is a pure function of absolute vertical scroll position:

`phase = scrollTop mod 2240px`

The 2240px period is an intentionally simple approximation of two pages. It does not depend on
rendered page height, viewport height, font size, time, scroll velocity, or editor zoom. Returning to
the same absolute scroll position produces the same speck state. No scroll means no changing state.

Zoom-generated scroll corrections are excluded upstream and must not update the scroll series.
Zoom never regenerates coordinates, changes the population, or re-phases visibility. A viewport
resize may clip different portions of the fixed oversized scene but does not regenerate it.

## 5. Visual and lifecycle requirements

- Initial pre-water paint is pure white.
- Day gradient is the shared indigo-to-teal `165deg` gradient.
- Waves, specks and sparkles share flat warm ivory `#f3edcf`; there is no vertical stroke gradient.
- Warm/cold reloads and repeated Chrome/Safari refreshes behave identically.
- Moving to the coast cannot jump backward, detach a mark, or expose a second population.
- At rest, introductory sparkles and specks are finished; only the scroll series remains.
- Background-tab return cannot replay or collectively reveal finished objects.

## 6. Generated artifact

`scripts/generate-wave-scene.mjs` is the only coordinate generator. It writes
`src/editor/waveSceneData.ts`. Changing the seed or regenerating the table is a deliberate design
change and must pass spacing, tangent, one-shot-window and periodicity tests before commit.
