import { chromium } from '@playwright/test'
const BASE = `http://127.0.0.1:${process.env.PROBE_PORT||4231}`
const b = await chromium.launch({ headless: true, args: ['--font-render-hinting=none','--disable-lcd-text'] })
const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/?textRender`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tiptap-editor', { timeout: 30000 })
await page.waitForFunction(()=>document.fonts&&document.fonts.status==='loaded',{timeout:30000})
await page.waitForTimeout(2500)
let s=1337; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648
const W=('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds difficult waffles first fifth flourish effigy scaffold').split(/\s+/)
const paras=[]; let w=0
while(w<4000){const n=Math.min(30+Math.floor(rnd()*40),4000-w); const o=[]; for(let i=0;i<n;i++)o.push(W[Math.floor(rnd()*W.length)]); const t=o.join(' '); paras.push(t[0].toUpperCase()+t.slice(1)+'.'); w+=n}
const doc={id:'brk',title:'brk',contentJson:{type:'doc',content:paras.map(t=>({type:'paragraph',content:[{type:'text',text:t}]}))},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),schemaVersion:1,scasLimitN:'infinite',scasSessionSeed:'fid'}
await page.evaluate((d)=>window.dispatchEvent(new CustomEvent('inkwave:open-doc',{detail:{id:d.id,doc:d}})), doc)
await page.waitForFunction(()=>!!window.__iwTextRenderProbe&&window.__iwTextRenderProbe.words()>3000,null,{timeout:60000})
await page.waitForTimeout(4000)
const r = await page.evaluate(() => {
  const p = window.__iwTextRenderProbe
  const { model } = p.build()
  const live = p.liveBreaks()
  return { mine: model.breaks.map(b=>b.at), live, pages: model.pages, sig: model.sig.slice(0,120), geom: p.geom() }
})
console.log('mine :', JSON.stringify(r.mine.slice(0,10)))
console.log('live :', JSON.stringify(r.live.slice(0,10)))
console.log('pages(model)=', r.pages, ' liveGaps=', r.live.length)
const same = r.mine.length===r.live.length && r.mine.every((v,i)=>v===r.live[i])
console.log('IDENTICAL BREAKS:', same)
if(!same){ for(let i=0;i<Math.max(r.mine.length,r.live.length)&&i<10;i++) if(r.mine[i]!==r.live[i]) { console.log(`first divergence at break ${i}: mine=${r.mine[i]} live=${r.live[i]} (delta ${r.mine[i]-r.live[i]})`); break } }
console.log('geom contentWidth=', r.geom.contentWidthPx)
await b.close()
