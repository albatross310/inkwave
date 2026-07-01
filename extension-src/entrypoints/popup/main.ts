const btn = document.getElementById('cap') as HTMLButtonElement
const status = document.getElementById('status') as HTMLElement

btn.addEventListener('click', () => {
  btn.disabled = true
  status.className = 's'
  status.textContent = 'Looking up…'

  browser.runtime.sendMessage({ type: 'inkwave:capture' }).then((res: unknown) => {
    btn.disabled = false
    const r = res as { ok: boolean; id?: string; queued?: number; error?: string } | null
    if (r?.ok) {
      status.className = 's ok'
      status.textContent = `Captured "${r.id}" (queued ${r.queued}). Open Inkwave to see it.`
    } else {
      status.className = 's err'
      status.textContent = r?.error || 'Nothing citable found on this page.'
    }
  }).catch((e: Error) => {
    btn.disabled = false
    status.className = 's err'
    status.textContent = e.message || 'Extension error.'
  })
})
