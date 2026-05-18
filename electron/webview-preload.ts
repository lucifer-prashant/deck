import { ipcRenderer } from 'electron'

// Tell host whenever the user interacts with the embedded page so the host can
// clear panel-selection glow and other "focus moved into webview" reactions.
const notifyFocus = () => ipcRenderer.sendToHost('focus-claim')
window.addEventListener('mousedown', notifyFocus, true)
window.addEventListener('focus', notifyFocus, true)
window.addEventListener('touchstart', notifyFocus, true)

// Detect what kind of guest this is. code-server (and any other locally-hosted IDE/dev
// tool we embed in an editor panel) needs all keyboard shortcuts to pass through to the
// app itself — Ctrl+P, Ctrl+Shift+P, Ctrl+F, Ctrl+Shift+F, Ctrl+B, Ctrl+T, etc. Browser
// panels in contrast need us to intercept Ctrl+T (new tab), Ctrl+W (close tab), etc.
// We discriminate by URL: 127.0.0.1 / localhost = locally-hosted app guest.
const isLocalGuest = (() => {
  try {
    const h = window.location.hostname
    return h === '127.0.0.1' || h === 'localhost' || h === '::1'
  } catch { return false }
})()

// Ctrl+Wheel: suppress Chromium's built-in page zoom inside local guests so VSCode's
// own editor.mouseWheelZoom can change the editor font. Without this, Chromium zooms
// the whole webview viewport and the wheel event arrives at VSCode flagged as default-
// prevented, so font zoom never fires.
window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  if (!isLocalGuest) return
  e.preventDefault()
  // No stopPropagation — VSCode's wheel handlers still need to see the event.
}, { passive: false, capture: true })

window.addEventListener('keydown', (e) => {
  // Drop OS key-repeat so holding Ctrl+T doesn't open dozens of tabs.
  if (e.repeat) return
  const k = e.key.toLowerCase()

  // For any guest, forward bare Escape so the host can take focus back to the panel header.
  if (k === 'escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    ipcRenderer.sendToHost('escape')
    return
  }

  // Zoom is universal — applies to both browser pages and code-server.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    let zoomName: string | null = null
    if (k === '=' || k === '+') zoomName = 'zoom-in'
    else if (k === '-' || k === '_') zoomName = 'zoom-out'
    else if (k === '0') zoomName = 'zoom-reset'
    if (zoomName) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('shortcut', { name: zoomName })
      return
    }
  }

  // Local guest (code-server etc.) — DO NOT intercept anything else. Let Ctrl+Shift+P,
  // Ctrl+P, Ctrl+F, Ctrl+Shift+F, Ctrl+B, Ctrl+T, Ctrl+W and friends reach the app.
  if (isLocalGuest) return

  // From here down: browser-panel shortcut interception only.
  let name: string | null = null
  let payload: Record<string, unknown> = {}

  if (k === 'f5') {
    name = e.shiftKey ? 'hard-reload' : 'reload'
  } else if (k === 'f6') {
    name = 'focus-url'
  } else if (k === 'f4' && (e.ctrlKey || e.metaKey)) {
    name = 'close-tab'
  } else if (e.altKey && k === 'arrowleft') {
    name = 'back'
  } else if (e.altKey && k === 'arrowright') {
    name = 'forward'
  } else if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 't') name = e.shiftKey ? 'reopen-closed' : 'new-tab'
    else if (k === 'n' && e.shiftKey) name = 'new-incognito'
    else if (k === 'w') name = 'close-tab'
    else if (k === 'l') name = 'focus-url'
    else if (k === 'r') name = e.shiftKey ? 'hard-reload' : 'reload'
    else if (k === 'h') name = 'history'
    else if (k === 'tab') name = e.shiftKey ? 'prev-tab' : 'next-tab'
    else if (/^[1-9]$/.test(k)) { name = 'goto-tab'; payload = { n: parseInt(k, 10) } }
    else if (k === 'i' && e.shiftKey) name = 'devtools'
    else if (k === 'u') name = 'view-source'
    else if (k === 'p') name = 'print'
    else if (k === 'f') name = 'find-in-page'
  } else if (k === 'f12') {
    name = 'devtools'
  }

  if (name) {
    e.preventDefault()
    e.stopPropagation()
    ipcRenderer.sendToHost('shortcut', { name, ...payload })
  }
}, true)
