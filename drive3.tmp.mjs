import { chromium } from '@playwright/test'
const b = await chromium.launch({ headless: true })
for (const cfg of ['tiny-1', 'tiny-n']) {
  const pg = await b.newPage()
  await pg.goto(`http://localhost:41287/whisper-probe.html?cfg=${cfg}`, { waitUntil: 'load' })
  const deadline = Date.now() + 400000
  let val = null
  while (Date.now() < deadline) {
    try {
      val = await pg.evaluate((k) => {
        const r = JSON.parse(localStorage.getItem('iw:whisperProbe:results') || '{}')
        return r[k] ? JSON.stringify(r[k]) : null
      }, cfg)
    } catch {}
    if (val) break
    await new Promise(r => setTimeout(r, 3000))
  }
  console.log(`RESULT ${cfg}: ${val || 'TIMEOUT'}`)
  await pg.close()
}
await b.close(); console.log('ALLDONE')
