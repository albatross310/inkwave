import { chromium } from '@playwright/test'
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext()).newPage()
await p.setContent('<div id="a" style="background: #fff">x</div><div id="b">y</div>')
console.log('setAttribute serialization:', await p.evaluate(() => document.getElementById('a').getAttribute('style')))
console.log('CSSOM-set serialization:  ', await p.evaluate(() => {
  const el = document.getElementById('b')
  el.style.setProperty('background', '#fff')      // what React does
  return el.getAttribute('style')
}))
console.log('does [style*="background: #fff"] match the CSSOM-set one? ',
  await p.evaluate(() => document.getElementById('b').matches('[style*="background: #fff"]')))
console.log('does it match the setAttribute one?                       ',
  await p.evaluate(() => document.getElementById('a').matches('[style*="background: #fff"]')))
await b.close()
