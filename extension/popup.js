const btn = document.getElementById('cap')
const status = document.getElementById('status')

btn.addEventListener('click', () => {
  btn.disabled = true
  status.className = 's'
  status.textContent = 'Looking up…'
  chrome.runtime.sendMessage({ type: 'inkwave:capture' }, (res) => {
    btn.disabled = false
    if (chrome.runtime.lastError) {
      status.className = 's err'; status.textContent = chrome.runtime.lastError.message; return
    }
    if (res?.ok) {
      status.className = 's ok'
      status.textContent = `Captured "${res.id}" (queued ${res.queued}). Open Inkwave to see it.`
    } else {
      status.className = 's err'
      status.textContent = res?.error || 'Nothing citable found on this page.'
    }
  })
})
