import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import './BrowserPanel.css'

interface Props {
  panel: Panel
}

interface WebviewElement extends HTMLElement {
  src: string
  loadURL: (url: string) => Promise<void>
  reload: () => void
  reloadIgnoringCache: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  stop: () => void
  getURL: () => string
  getTitle: () => string
  focus: () => void
  setZoomLevel: (level: number) => void
  getZoomLevel: () => number
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
  print: (options?: Record<string, unknown>) => Promise<void>
  executeJavaScript: (code: string) => Promise<unknown>
}

interface BrowserTab {
  id: string
  url: string
  title: string
  incognito?: boolean
  zoom?: number
}

const DEFAULT_HOME = 'https://www.google.com'
const CLOSED_STACK_LIMIT = 10

const normalizeUrl = (input: string): string => {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_HOME
  // Already has a protocol — use as-is.
  if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) return trimmed
  // Looks like a domain (e.g. github.com, example.com/path).
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed)) return `https://${trimmed}`
  // Has spaces or special chars — likely a search query.
  if (/\s/.test(trimmed)) return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  // Fallback: could be a localhost dev server or short domain.
  return `https://${trimmed}`
}

const makeTab = (url = DEFAULT_HOME, incognito = false): BrowserTab => ({
  id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  url,
  title: incognito ? 'Incognito' : 'New tab',
  incognito,
  zoom: 0
})

const shouldOpenPopupExternally = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return host === 'accounts.google.com' ||
      host === 'myaccount.google.com' ||
      host.endsWith('.accounts.google.com')
  } catch {
    return false
  }
}

// Singleton: fetch preload path once for whole app, cache promise so every
// BrowserPanel resolves it instantly after the first one.
let preloadPathPromise: Promise<string> | null = null
const getWebviewPreloadPath = (): Promise<string> => {
  if (!preloadPathPromise) {
    preloadPathPromise = (window.electronAPI?.getWebviewPreloadPath?.() ?? Promise.resolve(''))
      .then((p: string) => p ? `file://${p}` : '')
      .catch(() => '')
  }
  return preloadPathPromise
}

interface PanelSettings {
  browserTabs?: BrowserTab[]
  browserActiveTabId?: string
  // Kiosk mode hides the tabstrip + toolbar / URL bar entirely. Used by canvas presets
  // (Life / No-Life) where a panel should feel like a dedicated app, not a browser.
  kiosk?: boolean
  // Lazy-load: don't spin up the webview until the user clicks the placeholder. Saves
  // hundreds of MB of RAM per preset panel until they're actually used.
  lazyLoad?: boolean
  browserCommand?: { name: 'back' | 'forward' | 'reload' | 'open-external' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'new-tab' | 'close-tab' | 'next-tab' | 'prev-tab' | 'view-source' | 'find-in-page' | 'print'; nonce: number }
}

const BrowserPanel: React.FC<Props> = ({ panel }) => {
  const updatePanel = useWorkspaceStore(s => s.updatePanel)
  const settings = panel.settings as PanelSettings | undefined
  const browserCommand = settings?.browserCommand

  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    if (settings?.browserTabs && settings.browserTabs.length > 0) return settings.browserTabs
    if (panel.content) return [{ id: 'bt-init', url: panel.content, title: 'Tab', zoom: 0 }]
    return [makeTab()]
  })
  const [activeId, setActiveId] = useState<string>(() =>
    settings?.browserActiveTabId && (settings?.browserTabs || []).some(t => t.id === settings.browserActiveTabId)
      ? settings.browserActiveTabId
      : tabs[0].id
  )
  const [draftUrl, setDraftUrl] = useState('')
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})
  const [navMap, setNavMap] = useState<Record<string, { canBack: boolean; canFwd: boolean }>>({})
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const closedStack = useRef<BrowserTab[]>([])
  const webviewRefs = useRef<Map<string, WebviewElement>>(new Map())
  const boundWebviews = useRef<WeakSet<HTMLElement>>(new WeakSet())
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)
  const runShortcutRef = useRef<(name: string, n?: number) => void>(() => {})
  const addTabRef = useRef<(url?: string, incognito?: boolean) => string>(() => '')

  // Refs mirror state so shortcut handlers always see latest values without re-binding listeners.
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  // When active tab changes, restore focus to its webview so subsequent shortcuts route correctly.
  // Skip if user is actively typing in the URL bar.
  useEffect(() => {
    requestAnimationFrame(() => {
      if (document.activeElement === urlInputRef.current) return
      const wv = webviewRefs.current.get(activeId)
      try { wv?.focus() } catch { /* */ }
    })
  }, [activeId])

  // Resolve preload path before mounting any webview (avoids preload race).
  useEffect(() => {
    let cancelled = false
    getWebviewPreloadPath().then(p => { if (!cancelled) setPreloadPath(p) })
    return () => { cancelled = true }
  }, [])

  // Persist tabs.
  useEffect(() => {
    updatePanel(panel.id, {
      settings: { ...(panel.settings || {}), browserTabs: tabs, browserActiveTabId: activeId },
      content: tabs.find(t => t.id === activeId)?.url || ''
    }, { skipHistory: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId])

  // Sync URL bar text to active tab url when not editing.
  useEffect(() => {
    const active = tabs.find(t => t.id === activeId)
    setDraftUrl(active?.url || '')
  }, [activeId, tabs])

  const activeTab = tabs.find(t => t.id === activeId)
  useEffect(() => {
    if (activeTab && activeTab.title && activeTab.title !== panel.description) {
      updatePanel(panel.id, { description: activeTab.title }, { skipHistory: true })
    }
  }, [activeTab?.title, panel.id, panel.description, updatePanel, activeTab])

  // --- Tab operations ---
  const addTab = useCallback((url = DEFAULT_HOME, incognito = false, activate = true) => {
    const t = makeTab(url, incognito)
    setTabs(ts => [...ts, t])
    if (activate) {
      setActiveId(t.id)
      requestAnimationFrame(() => { urlInputRef.current?.focus(); urlInputRef.current?.select() })
    }
    return t.id
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(ts => {
      if (ts.length <= 1) return ts
      const idx = ts.findIndex(t => t.id === id)
      const closed = ts[idx]
      if (closed && !closed.incognito && closed.url && closed.url !== 'about:blank') {
        closedStack.current.push(closed)
        if (closedStack.current.length > CLOSED_STACK_LIMIT) closedStack.current.shift()
      }
      const next = ts.filter(t => t.id !== id)
      if (id === activeIdRef.current) {
        const fallback = next[Math.max(0, idx - 1)] || next[0]
        setActiveId(fallback.id)
      }
      return next
    })
  }, [])

  const reopenClosed = useCallback(() => {
    const t = closedStack.current.pop()
    if (!t) return
    addTab(t.url, false)
  }, [addTab])

  const cycleTab = useCallback((dir: 1 | -1) => {
    const ts = tabsRef.current
    const idx = ts.findIndex(t => t.id === activeIdRef.current)
    const next = ts[(idx + dir + ts.length) % ts.length]
    if (next) setActiveId(next.id)
  }, [])

  const gotoTab = useCallback((n: number) => {
    const ts = tabsRef.current
    const idx = Math.min(n - 1, ts.length - 1)
    if (ts[idx]) setActiveId(ts[idx].id)
  }, [])

  // --- Webview ops on active tab ---
  const activeWv = () => webviewRefs.current.get(activeIdRef.current)

  const back = useCallback(() => { try { activeWv()?.goBack() } catch { /* */ } }, [])
  const forward = useCallback(() => { try { activeWv()?.goForward() } catch { /* */ } }, [])
  const reload = useCallback(() => { try { activeWv()?.reload() } catch { /* */ } }, [])
  const hardReload = useCallback(() => { try { activeWv()?.reloadIgnoringCache() } catch { /* */ } }, [])
  const stop = useCallback(() => { try { activeWv()?.stop() } catch { /* */ } }, [])
  const openActiveExternal = useCallback(() => {
    const wv = activeWv()
    try {
      const url = wv?.getURL() || tabsRef.current.find(t => t.id === activeIdRef.current)?.url || ''
      if (url) void window.electronAPI?.openExternal?.(url)
    } catch { /* */ }
  }, [])

  const zoom = useCallback((dir: 'in' | 'out' | 'reset') => {
    const wv = activeWv()
    if (!wv) return
    try {
      const cur = wv.getZoomLevel()
      const next = dir === 'reset' ? 0 : dir === 'in' ? Math.min(9, cur + 1) : Math.max(-7, cur - 1)
      wv.setZoomLevel(next)
      setTabs(ts => ts.map(t => t.id === activeIdRef.current ? { ...t, zoom: next } : t))
    } catch { /* */ }
  }, [])

  // Execute browser commands triggered from context menu (kiosk mode).
  useEffect(() => {
    const command = browserCommand
    if (!command) return
    if (command.name === 'back') back()
    else if (command.name === 'forward') forward()
    else if (command.name === 'reload') reload()
    else if (command.name === 'open-external') openActiveExternal()
    else if (command.name === 'zoom-in') zoom('in')
    else if (command.name === 'zoom-out') zoom('out')
    else if (command.name === 'zoom-reset') zoom('reset')
    else if (command.name === 'new-tab') addTab()
    else if (command.name === 'close-tab') closeTab(activeIdRef.current)
    else if (command.name === 'next-tab') cycleTab(1)
    else if (command.name === 'prev-tab') cycleTab(-1)
    else if (command.name === 'view-source') {
      const wv = activeWv()
      try { const u = wv?.getURL() || ''; if (u) addTab(`view-source:${u}`) } catch { /* */ }
    }
    else if (command.name === 'find-in-page') setFindOpen(true)
    else if (command.name === 'print') {
      const wv = activeWv()
      try { wv?.print({}) } catch { /* */ }
    }
    updatePanel(panel.id, {
      settings: { ...(panel.settings || {}), browserCommand: undefined }
    }, { skipHistory: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserCommand])

  const focusUrl = useCallback(() => {
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
  }, [])

  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const findInputRef = useRef<HTMLInputElement | null>(null)

  // Unified shortcut dispatcher — used by both webview-IPC and host keydown.
  const runShortcut = useCallback((name: string, n?: number) => {
    switch (name) {
      case 'new-tab': addTab(); break
      case 'new-incognito': addTab(DEFAULT_HOME, true); break
      case 'reopen-closed': reopenClosed(); break
      case 'close-tab': closeTab(activeIdRef.current); break
      case 'focus-url': focusUrl(); break
      case 'next-tab': cycleTab(1); break
      case 'prev-tab': cycleTab(-1); break
      case 'goto-tab': if (typeof n === 'number') gotoTab(n); break
      case 'reload': reload(); break
      case 'hard-reload': hardReload(); break
      case 'back': back(); break
      case 'forward': forward(); break
      case 'zoom-in': zoom('in'); break
      case 'zoom-out': zoom('out'); break
      case 'zoom-reset': zoom('reset'); break
      case 'devtools': {
        const wv = activeWv()
        try { wv?.isDevToolsOpened() ? wv.closeDevTools() : wv?.openDevTools() } catch { /* */ }
        break
      }
      case 'view-source': {
        const wv = activeWv()
        try {
          const u = wv?.getURL() || ''
          if (u) addTab(`view-source:${u}`)
        } catch { /* */ }
        break
      }
      case 'print': {
        const wv = activeWv()
        try { wv?.print({}) } catch { /* */ }
        break
      }
      case 'open-external': openActiveExternal(); break
      case 'find-in-page': {
        setFindOpen(true)
        requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select() })
        break
      }
      case 'history': /* TODO: history panel */ break
    }
  }, [addTab, closeTab, cycleTab, focusUrl, gotoTab, reopenClosed, reload, hardReload, back, forward, zoom, openActiveExternal])

  // Keep refs to latest dispatcher / addTab so attach doesn't need to re-bind listeners on every render.
  useEffect(() => { runShortcutRef.current = runShortcut }, [runShortcut])
  useEffect(() => { addTabRef.current = addTab }, [addTab])

  // Wire webview events per tab. Stable identity (empty deps) so React.memo'd WebviewSlot
  // never sees a new attach prop → doesn't double-bind listeners on re-render.
  const attachWebview = useCallback((tabId: string, el: WebviewElement | null) => {
    if (!el) {
      // Don't remove from boundWebviews — WeakSet drops when GC'd.
      if (webviewRefs.current.get(tabId) === null || webviewRefs.current.get(tabId) === undefined) return
      // Keep entry; the element may briefly be null between renders. Skip cleanup work.
      return
    }
    if (boundWebviews.current.has(el)) {
      webviewRefs.current.set(tabId, el)
      return
    }
    boundWebviews.current.add(el)
    webviewRefs.current.set(tabId, el)

    const onStart = () => setLoadingMap(m => ({ ...m, [tabId]: true }))
    const onStop = () => {
      setLoadingMap(m => ({ ...m, [tabId]: false }))
      try {
        setNavMap(m => ({ ...m, [tabId]: { canBack: el.canGoBack(), canFwd: el.canGoForward() } }))
        const u = el.getURL()
        if (u && u !== 'about:blank') {
          setTabs(ts => ts.map(t => t.id === tabId ? { ...t, url: u } : t))
        }
      } catch { /* */ }
    }
    const onNav = (e: Event) => {
      const ev = e as unknown as { url: string }
      if (ev.url) setTabs(ts => ts.map(t => t.id === tabId ? { ...t, url: ev.url } : t))
    }
    const onTitle = (e: Event) => {
      const ev = e as unknown as { title: string }
      if (ev.title) setTabs(ts => ts.map(t => t.id === tabId ? { ...t, title: ev.title } : t))
    }
    const onIpc = (e: Event) => {
      const ev = e as unknown as { channel: string; args: unknown[] }
      if (ev.channel === 'focus-claim') {
        // User interacted inside the embedded page → make this panel the single active
        // selection (clears any stale ring on other panels) and mark body-active so the
        // selection ring is suppressed on this panel.
        const s = useWorkspaceStore.getState()
        if (s.headerActivePanelId) s.setHeaderActivePanel(null)
        if (s.bodyActivePanelId !== panel.id) s.setBodyActivePanel(panel.id)
        if (s.selectedPanelIds.length !== 1 || s.selectedPanelIds[0] !== panel.id) {
          s.selectPanel(panel.id)
        }
        return
      }
      if (ev.channel === 'escape') {
        // Webview keydown can't bubble out to the host window, so the preload forwards Esc here.
        const s = useWorkspaceStore.getState()
        try { (el as unknown as { blur?: () => void }).blur?.() } catch { /* ignore */ }
        s.setBodyActivePanel(null)
        s.setHeaderActivePanel(panel.id)
        if (!s.selectedPanelIds.includes(panel.id)) s.selectPanel(panel.id)
        return
      }
      if (ev.channel !== 'shortcut') return
      const payload = (ev.args[0] || {}) as { name: string; n?: number }
      runShortcutRef.current(payload.name, payload.n)
    }
    // Pop-up windows from the page → open as a new tab in THIS panel, not a new OS window.
    const onNewWindow = (e: Event) => {
      const ev = e as unknown as { url: string; disposition?: string }
      e.preventDefault?.()
      if (!ev.url) return
      if (shouldOpenPopupExternally(ev.url)) {
        void window.electronAPI?.openExternal?.(ev.url)
        return
      }
      addTabRef.current(ev.url)
    }
    const onDomReady = () => {
      // Apply persisted zoom level once contents are ready.
      try {
        const t = tabsRef.current.find(x => x.id === tabId)
        if (t && typeof t.zoom === 'number' && t.zoom !== 0) el.setZoomLevel(t.zoom)
      } catch { /* */ }
      // Enable background throttling so this webview yields CPU when not focused.
      // Combined with the .offscreen class (visibility:hidden) it stops painting
      // entirely when the panel scrolls outside the viewport.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wc = (el as any).getWebContents?.() || el
        wc.setBackgroundThrottling?.(true)
      } catch { /* */ }
    }

    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', onNav as EventListener)
    el.addEventListener('did-navigate-in-page', onNav as EventListener)
    el.addEventListener('page-title-updated', onTitle as EventListener)
    el.addEventListener('ipc-message', onIpc as EventListener)
    el.addEventListener('new-window', onNewWindow as EventListener)
    el.addEventListener('dom-ready', onDomReady as EventListener)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Host-side keydown — fires when focus is in URL bar, tabstrip, toolbar (anywhere in browser panel except inside webview).
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.repeat) return
    const k = e.key.toLowerCase()
    let name: string | null = null
    let n: number | undefined
    if (k === 'f5') name = e.shiftKey ? 'hard-reload' : 'reload'
    else if (k === 'f6') name = 'focus-url'
    else if (k === 'f4' && (e.ctrlKey || e.metaKey)) name = 'close-tab'
    else if (e.altKey && k === 'arrowleft') name = 'back'
    else if (e.altKey && k === 'arrowright') name = 'forward'
    else if (k === 'f12') name = 'devtools'
    else if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 't') name = e.shiftKey ? 'reopen-closed' : 'new-tab'
      else if (k === 'n' && e.shiftKey) name = 'new-incognito'
      else if (k === 'w') name = 'close-tab'
      else if (k === 'l') name = 'focus-url'
      else if (k === 'r') name = e.shiftKey ? 'hard-reload' : 'reload'
      else if (k === 'h') name = 'history'
      else if (k === 'tab') name = e.shiftKey ? 'prev-tab' : 'next-tab'
      else if (/^[1-9]$/.test(k)) { name = 'goto-tab'; n = parseInt(k, 10) }
      else if (k === '=' || k === '+') name = 'zoom-in'
      else if (k === '-' || k === '_') name = 'zoom-out'
      else if (k === '0') name = 'zoom-reset'
      else if (k === 'i' && e.shiftKey) name = 'devtools'
      else if (k === 'u') name = 'view-source'
      else if (k === 'p') name = 'print'
      else if (k === 'o' && e.shiftKey) name = 'open-external'
      else if (k === 'f') name = 'find-in-page'
    }
    if (name) {
      e.preventDefault()
      e.stopPropagation()
      runShortcut(name, n)
    }
  }, [runShortcut])

  const commitUrl = useCallback(() => {
    const next = normalizeUrl(draftUrl)
    setTabs(ts => ts.map(t => t.id === activeIdRef.current ? { ...t, url: next } : t))
    const wv = activeWv()
    if (wv) { try { wv.loadURL(next) } catch { /* */ } }
  }, [draftUrl])

  const activeLoading = loadingMap[activeId] || false
  const activeNav = navMap[activeId] || { canBack: false, canFwd: false }

  return (
    <div
      className="browser-panel"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handlePanelKeyDown}
      tabIndex={-1}
    >
      <div
        className="browser-tabstrip"
        style={settings?.kiosk ? { display: 'none' } : undefined}
        onWheel={(e) => {
          // Translate vertical wheel into horizontal tab-strip scroll so
          // overflowing tabs are reachable without a horizontal pad.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY
          }
        }}
      >
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`bp-tab ${t.id === activeId ? 'active' : ''} ${t.incognito ? 'incognito' : ''}`}
            onClick={() => setActiveId(t.id)}
            onAuxClick={(e) => { if (e.button === 1) closeTab(t.id) }}
            title={`${t.title} — ${t.url}${t.incognito ? ' (incognito)' : ''}`}
          >
            {t.incognito && <span className="bp-tab-incog">⎈</span>}
            {loadingMap[t.id] && <span className="bp-tab-load">◐</span>}
            <span className="bp-tab-title">{t.title || `Tab ${i + 1}`}</span>
            {tabs.length > 1 && (
              <button
                className="bp-tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
              >×</button>
            )}
          </div>
        ))}
        <button className="bp-newtab" onClick={() => addTab()} title="New tab (Ctrl+T)">+</button>
        <button className="bp-newtab incog" onClick={() => addTab(DEFAULT_HOME, true)} title="New incognito tab (Ctrl+Shift+N)">⎈</button>
      </div>
      <div className="browser-toolbar" style={{ display: settings?.kiosk ? 'none' : undefined }}>
        <button className="bp-btn" onClick={back} disabled={!activeNav.canBack} title="Back (Alt+←)">‹</button>
        <button className="bp-btn" onClick={forward} disabled={!activeNav.canFwd} title="Forward (Alt+→)">›</button>
        <button className="bp-btn" onClick={activeLoading ? stop : reload} title={activeLoading ? 'Stop' : 'Reload (Ctrl+R)'}>
          {activeLoading ? '×' : '↻'}
        </button>
        <input
          ref={urlInputRef}
          className="bp-url"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onPaste={(e) => {
            // Explicitly handle paste so pasted URLs work reliably.
            const text = e.clipboardData.getData('text/plain')?.trim()
            if (text) {
              e.preventDefault()
              const normalized = normalizeUrl(text)
              setDraftUrl(normalized)
              // Auto-navigate after paste.
              const wv = activeWv()
              if (wv) { try { wv.loadURL(normalized) } catch { /* */ } }
            }
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            // Browser-like shortcuts should fire even from inside the URL bar.
            // Don't stopPropagation — let the panel-level handler also see them.
            if (e.key === 'Enter') {
              e.preventDefault()
              commitUrl()
            } else if (e.key === 'Escape') {
              // Reset draft only; global Esc cascade handles blur + focus transfer.
              const active = tabsRef.current.find(t => t.id === activeIdRef.current)
              setDraftUrl(active?.url || '')
            }
          }}
          spellCheck={false}
          placeholder="search Google or paste a URL…"
        />
        <button
          className="bp-btn"
          onClick={() => {
            const active = tabsRef.current.find(t => t.id === activeIdRef.current)
            const url = active?.url
            if (url) void window.electronAPI?.openExternal?.(url)
          }}
          title="Pop out: open in system browser"
        >⇱</button>
      </div>
      {findOpen && (
        <div className="bp-find">
          <input
            ref={findInputRef}
            className="bp-find-input"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value)
              const wv = activeWv()
              if (wv && e.target.value) {
                try { wv.findInPage(e.target.value) } catch { /* */ }
              } else if (wv) {
                try { wv.stopFindInPage('clearSelection') } catch { /* */ }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const wv = activeWv()
                if (wv && findQuery) {
                  try { wv.findInPage(findQuery, { forward: !e.shiftKey, findNext: true }) } catch { /* */ }
                }
              } else if (e.key === 'Escape') {
                setFindOpen(false)
                const wv = activeWv()
                try { wv?.stopFindInPage('clearSelection') } catch { /* */ }
                // Global Esc cascade does the focus transfer; no preventDefault here.
              }
            }}
            placeholder="find in page"
            spellCheck={false}
          />
          <button className="bp-btn" onClick={() => {
            const wv = activeWv()
            if (wv && findQuery) { try { wv.findInPage(findQuery, { forward: false, findNext: true }) } catch { /* */ } }
          }} title="Previous (Shift+Enter)">‹</button>
          <button className="bp-btn" onClick={() => {
            const wv = activeWv()
            if (wv && findQuery) { try { wv.findInPage(findQuery, { forward: true, findNext: true }) } catch { /* */ } }
          }} title="Next (Enter)">›</button>
          <button className="bp-btn" onClick={() => {
            setFindOpen(false)
            try { activeWv()?.stopFindInPage('clearSelection') } catch { /* */ }
          }} title="Close (Esc)">×</button>
        </div>
      )}
      <div className="bp-viewport">
        {preloadPath === null ? (
          <div className="bp-loading">Loading browser…</div>
        ) : settings?.lazyLoad ? (
          <LazyLoadPlaceholder
            title={panel.title}
            color={panel.color}
            host={(() => { try { return new URL(tabs[0]?.url || '').hostname } catch { return '' } })()}
            onLoad={() => {
              // Clear the lazyLoad flag so subsequent tab switches auto-mount the webview.
              useWorkspaceStore.getState().updatePanel(panel.id, {
                settings: { ...(panel.settings || {}), lazyLoad: false }
              }, { skipHistory: true })
            }}
          />
        ) : (
          tabs.map(t => (
            <WebviewSlot
              key={t.id}
              tabId={t.id}
              url={t.url}
              active={t.id === activeId}
              incognito={!!t.incognito}
              preloadPath={preloadPath}
              attach={attachWebview}
            />
          ))
        )}
      </div>
    </div>
  )
}

const WebviewSlot = React.memo<{
  tabId: string
  url: string
  active: boolean
  incognito: boolean
  preloadPath: string
  attach: (id: string, el: WebviewElement | null) => void
  // eslint-disable-next-line react/prop-types
}>(({ tabId, url, active, incognito, preloadPath, attach }) => {
  // Treat src as mount-only. BrowserPanel records navigation back into tab state, but
  // feeding every did-navigate URL back into <webview src> can abort complex redirect
  // flows like Gmail's /mail/u/0/ -> #inbox chain.
  const initialUrlRef = useRef(url)
  const partition = useMemo(() =>
    incognito ? `wts-incognito-${tabId}` : 'persist:wts-browser',
    [incognito, tabId]
  )
  // Pass preload attribute only if non-empty so React doesn't render `preload=""`.
  const props: Record<string, unknown> = {
    ref: (el: HTMLElement | null) => attach(tabId, el as WebviewElement | null),
    src: initialUrlRef.current,
    className: 'bp-webview',
    allowpopups: 'true',
    partition,
    style: { display: active ? 'flex' : 'none' }
  }
  if (preloadPath) props.preload = preloadPath
  return React.createElement('webview', props)
})
WebviewSlot.displayName = 'WebviewSlot'

// Placeholder shown when a browser panel has lazyLoad=true. Spawning a Chromium webview
// costs ~150–300 MB; preset tabs with 5 panels would spike RAM by ~1 GB before the user
// even interacts. This placeholder defers that until the user clicks the panel.
const LazyLoadPlaceholder: React.FC<{ title: string; color?: string; host: string; onLoad: () => void }> = ({ title, color, host, onLoad }) => {
  const accent = color || '#4dabe8'
  return (
    <div
      className="bp-lazy"
      onClick={onLoad}
      role="button"
      title={`Click to load ${title}`}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: `radial-gradient(120% 90% at 50% 30%, ${accent}22, transparent 65%), linear-gradient(180deg, #16181d, #0d0f12)`,
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div style={{
        width: 84, height: 84, borderRadius: 20,
        background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 38, fontWeight: 800, color: '#fff',
        boxShadow: `0 12px 36px ${accent}55, 0 0 0 1px ${accent}66 inset`,
        fontFamily: 'Inter, system-ui, sans-serif'
      }}>
        {title[0]?.toUpperCase() || '◐'}
      </div>
      <div style={{ textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', marginBottom: 4 }}>{title}</div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>{host}</div>
      </div>
      <div style={{
        marginTop: 8,
        padding: '8px 18px',
        borderRadius: 999,
        background: `${accent}22`,
        border: `1px solid ${accent}55`,
        color: '#fff',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}>click to load</div>
      <div style={{
        position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center',
        color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.05em',
        fontFamily: 'JetBrains Mono, monospace'
      }}>saves ~250 MB until used</div>
    </div>
  )
}

export default BrowserPanel
