// INSTALLED-PWA FILE-LAUNCH PROBE — real production build, Chromium, OPFS and LaunchQueue timing.
// Delivers an actual FileSystemFileHandle before React mounts Edit's listener, then proves the
// cold window opens that document instead of losing the event and falling through to Recent/blank.

import { chromium } from '@playwright/test'
import { startProbeServer } from './textrender-probe/serve.mjs'

const { base, stop } = await startProbeServer()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ serviceWorkers: 'block' })
let failed = 0
let voided = 0
class VoidRun extends Error {}
const check = (condition, label, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failed++
}

try {
  // Seed a REAL, structured-cloneable OPFS file handle from the same origin. A separate setup page
  // keeps the target navigation a true new document with no mounted Edit listener.
  const setup = await context.newPage()
  await setup.goto(`${base}/about`, { waitUntil: 'domcontentloaded' })
  const setupResult = await setup.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return 'OPFS unavailable'
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('one-click.studio', { create: true })
    if (typeof handle.createWritable !== 'function') return 'writable OPFS handle unavailable'
    const now = new Date().toISOString()
    const doc = {
      id: 'os-launched-doc',
      title: 'One-click studio file',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Opened by the operating system.' }] }],
      },
      createdAt: now,
      updatedAt: now,
      schemaVersion: '0.1.0',
      scasLimitN: 'infinite',
      scasSessionSeed: 'file-launch-probe',
    }
    const writable = await handle.createWritable()
    // Use the portable bundle shape so the document's identity travels exactly as a downloaded
    // `.studio` does. A raw OPFS current.json deliberately receives a fresh id on external import.
    await writable.write(JSON.stringify({ document: doc, snapshots: [] }))
    await writable.close()
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('iw-filelaunch-probe', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('handles')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('handles', 'readwrite')
        tx.objectStore('handles').put(handle, 'studio')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    return ''
  })
  await setup.close()
  if (setupResult) throw new VoidRun(setupResult)

  const page = await context.newPage()
  // Give the init script's IndexedDB read a deterministic head start over React. This makes the
  // control exact: LaunchParams reaches the app before the listener, every run, rather than only
  // when OPFS happens to beat hydration on this machine.
  await page.route('**/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.continue()
  })
  await page.addInitScript(() => {
    const probe = { consumerInstalled: false, delivered: false, readyAtDelivery: null, error: '' }
    window.__iwFileLaunchProbe = probe
    let consumer = null
    let handle = null
    const deliver = () => {
      if (!consumer || !handle || probe.delivered) return
      probe.readyAtDelivery = window.__iwOpenDocListenerReady === true
      probe.delivered = true
      consumer({ files: [handle] })
    }
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer(nextConsumer) {
          probe.consumerInstalled = true
          consumer = nextConsumer
          deliver()
        },
      },
    })
    void new Promise((resolve, reject) => {
      const request = indexedDB.open('iw-filelaunch-probe', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const get = db.transaction('handles').objectStore('handles').get('studio')
        get.onerror = () => reject(get.error)
        get.onsuccess = () => { handle = get.result; db.close(); resolve() }
      }
    }).then(deliver).catch((error) => { probe.error = String(error) })
  })

  await page.goto(`${base}/?file-launch=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => !!document.querySelector('.ProseMirror[contenteditable="true"]') && !document.querySelector('.iw-loading-tip'),
    null,
    { timeout: 60_000 },
  ).catch(() => {})

  const premise = await page.evaluate(() => window.__iwFileLaunchProbe)
  if (!premise?.consumerInstalled || premise.error || !premise.delivered) {
    throw new VoidRun(premise?.error || 'LaunchQueue consumer or OPFS file delivery was unavailable')
  }

  const result = await page.evaluate(() => ({
    title: document.title,
    body: document.querySelector('.ProseMirror')?.textContent ?? '',
    id: sessionStorage.getItem('inkwave:tabDocumentId'),
    actionStillInUrl: new URL(location.href).searchParams.has('file-launch'),
    readyNow: window.__iwOpenDocListenerReady === true,
  }))
  check(premise.readyAtDelivery === false, 'the file arrived before Edit mounted its listener (cold-launch control)')
  check(result.id === 'os-launched-doc', 'the OS-delivered document becomes this tab’s document', result.id ?? 'none')
  check(result.body.includes('Opened by the operating system.'), 'the delivered .studio body is visible')
  check(result.title.toLowerCase().includes('one-click'), 'the delivered file names the Inkwave window', result.title)
  check(!result.actionStillInUrl, 'the one-shot file-launch URL marker is consumed')
  check(result.readyNow, 'the editor’s open-doc listener remains ready for later file launches')
} catch (error) {
  if (error instanceof VoidRun) {
    console.log(`  ∅ VOID — ${error.message}; this run proves nothing about installed-PWA file opening`)
    voided++
  } else {
    console.log(`  ✗ probe crashed — ${error instanceof Error ? error.message : String(error)}`)
    failed++
  }
} finally {
  await browser.close()
  await stop()
}

console.log(voided ? `\nVOID (${voided})` : failed ? `\nFAIL (${failed})` : '\nPASS')
process.exitCode = failed ? 1 : voided ? 2 : 0
