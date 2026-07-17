// DOES THE index.css PHONE FLOOR ACTUALLY BEAT AN INLINE 13px fontSize?
//
// The brief for this lane states the iOS trap as live: "GoalsSection shipped 13px inputs ... iOS
// Safari zooms into any input under 16px on focus and STAYS zoomed". But index.css carries
//   @media (pointer: coarse) and (hover: none) { input, select, textarea { font-size: max(16px,1em) !important } }
// and Tailwind's `@layer base` is a BUILD-TIME directive, not a native cascade layer (the built CSS
// contains zero `@layer`), so that !important is a plain author-important declaration — which per the
// CSS cascade outranks a NORMAL inline style. If that holds, the 13px inputs were already floored to
// 16px on Peter's iPhone and the trap was backstopped, not live.
//
// That is a claim about the real cascade in a real engine, so it is MEASURED here rather than
// reasoned about. Loads the actual built stylesheet — not a hand-copy of the rule.
//
// THE KNOWN-NEGATIVE IS THE POINT: the same markup is measured under a DESKTOP emulation, where the
// media query must NOT match and the input must compute to 13px. Without it, a probe that reported
// "16px" because the element was detached, or the CSS never loaded, or getComputedStyle returned a
// default, would look exactly like a pass.

import { readFileSync, readdirSync } from 'node:fs'
import { chromium, devices } from '@playwright/test'

const dir = 'build/client/assets'
const cssFile = readdirSync(dir).find((f) => f.endsWith('.css') && readFileSync(`${dir}/${f}`, 'utf8').includes('pointer:coarse'))
const css = readFileSync(`${dir}/${cssFile}`, 'utf8')
console.log(`stylesheet: ${cssFile} (${css.length} bytes)`)
console.log(`native @layer count: ${(css.match(/@layer/g) ?? []).length}`)
console.log(`floor rule: ${/input,select,textarea\{font-size:[^}]*\}/.exec(css)?.[0]}`)

const page_html = `<style>${css}</style>
  <input id="t" style="font-size: 13px" value="x" />
  <textarea id="a" style="font-size: 13px"></textarea>`

const browser = await chromium.launch()

async function measure(label, contextOpts) {
  const ctx = await browser.newContext(contextOpts)
  const page = await ctx.newPage()
  await page.setContent(page_html)
  const r = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse) and (hover: none)').matches,
    input: getComputedStyle(document.getElementById('t')).fontSize,
    textarea: getComputedStyle(document.getElementById('a')).fontSize,
  }))
  console.log(`${label.padEnd(22)} mediaMatches=${String(r.coarse).padEnd(5)} input=${r.input} textarea=${r.textarea}`)
  await ctx.close()
  return r
}

// THE CLAIM: on a phone the floor wins over the inline 13px.
const phone = await measure('iPhone 12 (phone)', { ...devices['iPhone 12'] })
// THE KNOWN-NEGATIVE: on desktop the query does not match, so 13px must survive. If this ALSO reads
// 16px, the probe is measuring something other than the media query and the phone result is void.
const desk = await measure('Desktop (negative)', {})

const ok =
  phone.coarse === true && phone.input === '16px' && phone.textarea === '16px' &&
  desk.coarse === false && desk.input === '13px' && desk.textarea === '13px'

console.log('\nVERDICT:', ok
  ? 'CONFIRMED — the phone floor overrides an inline 13px (16px); desktop correctly leaves it 13px.\n' +
    '          => the iOS trap was ALREADY backstopped on Peter\'s iPhone by index.css.\n' +
    '          => it was NOT backstopped on any coarse+hover device the query misses, and the CSS\n' +
    '             floor is invisible at the call site — which is why the ramp + guard still matter.'
  : 'REFUTED or instrument broken — see the two rows above.')

await browser.close()
process.exit(ok ? 0 : 1)
