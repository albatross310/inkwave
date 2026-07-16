// What a placeholdered bibliography ACTUALLY looks like, side by side with the editor's own pixels.
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { buildCitationDoc } from './fixture.mjs'
const require = createRequire(import.meta.url)
// Resolve pngjs from THIS worktree. It was hard-coded to /root/dev/iw-textrender's node_modules —
// another agent's checkout, which this probe must never depend on (and which need not exist).
// pngjs is a transitive dep, so it is not hoisted to node_modules/ — resolve it out of the local
// pnpm store rather than reaching across worktrees.
const { PNG } = require(join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs'))
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4239}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
const doc = buildCitationDoc({ words: 2200, cites: 29, id: 'refl' })
await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
await page.waitForFunction(()=>!!window.__iwTextRenderProbe && window.__iwTextRenderProbe.words()>1000,null,{timeout:60000})
await page.waitForTimeout(6000)
// Which page carries the refList?
const info = await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const { model } = p.build()
  const i = model.blocks.findIndex(b => b.type === 'referenceList')
  const blk = model.blocks[i]
  const li = model.lines.findIndex(l => l.blockIdx === i)
  return { page: model.pageOfLine[li], pages: model.pages, h: blk?.height, est: blk?.estimated, sheets: document.querySelectorAll('.inkwave-sheet').length }
})
console.log('refList block:', JSON.stringify(info))
const P = info.page
const ok = await page.evaluate((i)=>{ const s=document.querySelectorAll('.inkwave-sheet')[i]; const sc=document.querySelector('.inkwave-editor-surface'); if(!s) return false; sc.scrollTop=Math.max(0,s.getBoundingClientRect().top+sc.scrollTop-40); return true }, P)
if (!ok) { console.log('no sheet for refList page', P); await b.close(); process.exit(0) }
await page.waitForTimeout(600)
const box = await page.evaluate((i)=>{ const r=document.querySelectorAll('.inkwave-sheet')[i].getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} }, P)
if (box.y < 0 || box.y+box.height > 1400) { console.log('refList page off-screen'); await b.close(); process.exit(0) }
const ed = PNG.sync.read(await page.screenshot({ clip: box }))
const si = (ed.width*20+20)<<2
const parch = `rgb(${ed.data[si]}, ${ed.data[si+1]}, ${ed.data[si+2]})`
const color = await page.evaluate(()=>getComputedStyle(document.querySelector('.ProseMirror')).color)
const mine = await page.evaluate(({i,color,bg})=>{ const p=window.__iwTextRenderProbe; const {model}=p.build(); const {canvas}=p.paint(model,i,{mode:'text',ink:color,background:bg}); return canvas.toDataURL('image/png') }, {i:P,color,bg:parch})
const mp = PNG.sync.read(Buffer.from(mine.split(',')[1],'base64'))
const W=Math.min(ed.width,mp.width), H=Math.min(ed.height,mp.height), G=8
const sheet = new PNG({ width: W*2+G, height: H })
for(let i=0;i<sheet.data.length;i+=4){sheet.data[i]=220;sheet.data[i+1]=40;sheet.data[i+2]=40;sheet.data[i+3]=255}
function blit(src,ox){for(let y=0;y<H;y++)for(let x=0;x<W;x++){const s=(src.width*y+x)<<2,d=(sheet.width*y+(ox+x))<<2;for(let c=0;c<4;c++)sheet.data[d+c]=src.data[s+c]}}
blit(ed,0); blit(mp,W+G)
writeFileSync(join(OUT,'reflist-compare.png'), PNG.sync.write(sheet))
console.log('wrote reflist-compare.png — LEFT: real editor bibliography | RIGHT: our render (placeholdered)')
await b.close()
