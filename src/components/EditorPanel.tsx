import React, { useEffect, useRef, useState, useCallback } from 'react'
import Editor, { OnMount, OnChange, Monaco } from '@monaco-editor/react'
import type * as monacoNS from 'monaco-editor'
import { Panel as PanelType, useWorkspaceStore } from '../store/workspaceStore'

interface Props { panel: PanelType }

interface EditorSettings {
  // code-server mode (preferred)
  folderPath?: string
  // monaco fallback mode (when code-server not installed)
  filePath?: string
  content?: string
  language?: string
  wordWrap?: 'on' | 'off'
  fontSize?: number
}

type Mode = 'loading' | 'codeserver' | 'install' | 'monaco'

const EditorPanel: React.FC<Props> = ({ panel }) => {
  const settings = (panel.settings || {}) as EditorSettings
  const [mode, setMode] = useState<Mode>('loading')
  const [serverUrl, setServerUrl] = useState<string>('')
  const folderPath = settings.folderPath
  const [startError, setStartError] = useState<string>('')

  // Try to bring up code-server on mount. Falls back to install prompt or monaco fallback.
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI?.codeServer
    if (!api) { setMode('monaco'); return }
    (async () => {
      const status = await api.status()
      if (cancelled) return

      const authenticate = async () => {
        if (api.authenticatePartition) {
          await api.authenticatePartition('persist:wts-code-server-' + panel.id)
        }
      }

      if (status.running && status.url) {
        await authenticate()
        setServerUrl(status.url)
        setMode('codeserver')
        return
      }
      if (status.available === false) {
        setMode('install')
        return
      }
      const r = await api.start()
      if (cancelled) return
      if (r.ok && r.url) {
        await authenticate()
        setServerUrl(r.url)
        setMode('codeserver')
      } else {
        setStartError(r.error || 'unknown')
        setMode('install')
      }
    })()
    return () => { cancelled = true }
  }, [panel.id])

  if (mode === 'loading') {
    return <div style={loadingStyle}>starting code-server…</div>
  }

  if (mode === 'install') {
    return (
      <InstallPrompt
        error={startError}
        onRetry={async () => {
          const r = await window.electronAPI?.codeServer?.start()
          if (r?.ok && r.url) {
            setServerUrl(r.url)
            setMode('codeserver')
          } else {
            const errMsg = r?.error || 'unknown'
            setStartError(errMsg)
            throw new Error(errMsg)
          }
        }}
        onFallback={() => setMode('monaco')}
      />
    )
  }

  if (mode === 'monaco') {
    return <MonacoFallback panel={panel} />
  }

  // codeserver mode
  const filePath = settings.filePath

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-wts-path')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-wts-path')
    if (!raw) return
    e.preventDefault()
    try {
      const data = JSON.parse(raw)
      const items = data.items ? (data.items as Array<{ path: string; isDir: boolean }>) : [data]
      if (items && items.length > 0) {
        const item = items[0]
        const dir = item.isDir ? item.path : (await window.electronAPI?.file?.dirname(item.path)) || item.path
        useWorkspaceStore.getState().updatePanel(panel.id, {
          folderPath: dir,
          settings: {
            ...(panel.settings || {}),
            folderPath: dir,
            filePath: item.isDir ? undefined : item.path
          }
        }, { skipHistory: true })
      }
    } catch { /* ignore */ }
  }

  return (
    <div
      className="editor-panel-root"
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CodeServerWebview
        panelId={panel.id}
        serverUrl={serverUrl}
        folderPath={folderPath}
        filePath={filePath}
        onFolderChanged={(dir) => {
          useWorkspaceStore.getState().updatePanel(panel.id, {
            folderPath: dir,
            settings: {
              ...(panel.settings || {}),
              folderPath: dir,
              filePath: undefined
            }
          }, { skipHistory: true })
        }}
      />
    </div>
  )
}

// Wraps the <webview> so we can attach did-navigate / dom-ready listeners and
// extract the active code-server folder from the URL (?folder=...).
// Singleton — fetch preload path once for the whole app, cache promise so every editor
// panel mounts instantly after the first resolution.
let editorPreloadPromise: Promise<string> | null = null
const getEditorPreloadPath = (): Promise<string> => {
  if (!editorPreloadPromise) {
    editorPreloadPromise = (window.electronAPI?.getWebviewPreloadPath?.() ?? Promise.resolve(''))
      .then((p: string) => (p ? `file://${p}` : ''))
      .catch(() => '')
  }
  return editorPreloadPromise
}

const CodeServerWebview: React.FC<{
  panelId: string
  serverUrl: string
  folderPath?: string
  filePath?: string
  onFolderChanged: (dir: string) => void
}> = ({ panelId, serverUrl, folderPath, filePath, onFolderChanged }) => {
  const wvRef = useRef<HTMLElement | null>(null)
  const lastFolderRef = useRef<string>('')
  const [preloadPath, setPreloadPath] = useState<string | null>(null)

  // Track the initial URL for the webview mount
  const [initialUrl] = useState<string>(() => {
    return folderPath
      ? `${serverUrl}/?folder=${encodeURIComponent(folderPath)}${filePath ? `&file=${encodeURIComponent(filePath)}` : ''}&isCodeServer=true`
      : `${serverUrl}/?folder=&isCodeServer=true`
  })

  // Compute the latest URL based on props
  const currentUrl = folderPath
    ? `${serverUrl}/?folder=${encodeURIComponent(folderPath)}${filePath ? `&file=${encodeURIComponent(filePath)}` : ''}&isCodeServer=true`
    : `${serverUrl}/?folder=&isCodeServer=true`

  // Use a ref to prevent running the loadURL effect on the initial render
  const isFirstRender = useRef(true)

  // Direct Electron webview navigation to bypass React custom element attribute reconciliation issues
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const webview = wvRef.current as any
    if (webview?.loadURL && folderPath) {
      webview.loadURL(currentUrl)
    }
  }, [currentUrl, folderPath])

  useEffect(() => {
    let cancelled = false
    getEditorPreloadPath().then(p => {
      if (!cancelled) setPreloadPath(p || '')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const el = wvRef.current as unknown as (HTMLElement & {
      getURL?: () => string
      getZoomLevel?: () => number
      setZoomLevel?: (n: number) => void
    }) | null
    if (!el) return
    const parseFolder = (u: string): string | null => {
      try {
        const parsed = new URL(u)
        const f = parsed.searchParams.get('folder')
        return f ? decodeURIComponent(f) : null
      } catch { return null }
    }
    const sync = (u?: string) => {
      const current = u || el.getURL?.() || ''
      const folder = parseFolder(current)
      if (folder && folder !== lastFolderRef.current) {
        lastFolderRef.current = folder
        onFolderChanged(folder)
      }
    }
    const onNav = (e: Event) => sync((e as unknown as { url: string }).url)
    const onDomReady = () => {
      sync()
    }
    // Webview-preload forwards Ctrl+= / Ctrl+- / Ctrl+0 as ipc-message channel='shortcut'.
    // Apply zoom directly on the webview rather than letting code-server's own zoom kick in,
    // because Chromium's setZoomLevel feels more responsive and persists per-panel.
    const onIpc = (e: Event) => {
      const ev = e as unknown as { channel: string; args: unknown[] }
      if (ev.channel === 'focus-claim') {
        // User clicked/typed inside code-server. Switch selection + body-active to THIS
        // panel so any other panel's stale selection ring goes away.
        const s = useWorkspaceStore.getState()
        const panel = s.panels[panelId]
        if (!panel) return
        if (s.headerActivePanelId) s.setHeaderActivePanel(null)
        if (s.bodyActivePanelId !== panelId) s.setBodyActivePanel(panelId)
        if (s.selectedPanelIds.length !== 1 || s.selectedPanelIds[0] !== panelId) {
          s.selectPanel(panelId)
        }
        if (panel.type !== 'region' && !panel.pinFront && !panel.pinBack) {
          const otherZs = Object.values(s.panels)
            .filter(p => p.id !== panel.id && !p.pinFront && !p.pinBack)
            .map(p => p.zIndex || 1)
          const maxOtherZ = otherZs.length > 0 ? Math.max(...otherZs) : 1
          if (panel.zIndex === undefined || panel.zIndex <= maxOtherZ) {
            s.updatePanel(panel.id, { zIndex: maxOtherZ + 1 }, { skipHistory: true })
          }
        }
        return
      }
      if (ev.channel === 'escape') {
        const s = useWorkspaceStore.getState()
        try { (el as unknown as { blur?: () => void }).blur?.() } catch { /* ignore */ }
        s.setBodyActivePanel(null)
        s.setHeaderActivePanel(panelId)
        if (!s.selectedPanelIds.includes(panelId)) s.selectPanel(panelId)
        return
      }
      if (ev.channel !== 'shortcut') return
      const p = (ev.args[0] || {}) as { name?: string }
      if (!el.setZoomLevel || !el.getZoomLevel) return
      const cur = el.getZoomLevel() || 0
      if (p.name === 'zoom-in') el.setZoomLevel(Math.min(cur + 0.5, 6))
      else if (p.name === 'zoom-out') el.setZoomLevel(Math.max(cur - 0.5, -3))
      else if (p.name === 'zoom-reset') el.setZoomLevel(0)
    }
    el.addEventListener('did-navigate', onNav as EventListener)
    el.addEventListener('did-navigate-in-page', onNav as EventListener)
    el.addEventListener('dom-ready', onDomReady as EventListener)
    el.addEventListener('ipc-message', onIpc as EventListener)
    return () => {
      el.removeEventListener('did-navigate', onNav as EventListener)
      el.removeEventListener('did-navigate-in-page', onNav as EventListener)
      el.removeEventListener('dom-ready', onDomReady as EventListener)
      el.removeEventListener('ipc-message', onIpc as EventListener)
    }
    // Re-run when the webview element actually mounts (preloadPath resolution gate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, preloadPath])

  const setRef = (el: HTMLElement | null): void => { wvRef.current = el }
  // Wait until the preload path resolution attempt finishes (null = still resolving).
  // Empty string means the IPC failed — render the webview anyway, just without preload
  // (the user can still use code-server, just no Esc/zoom forwarding).
  if (preloadPath === null) return <div style={{ flex: 1, minHeight: 0, background: '#1e1e1e' }} />
  const props: Record<string, unknown> = {
    ref: setRef,
    src: initialUrl,
    allowpopups: 'true',
    partition: 'persist:wts-code-server-' + panelId,
    style: { flex: 1, minHeight: 0, display: 'flex' }
  }
  if (preloadPath) props.preload = preloadPath
  return React.createElement('webview', props)
}

const InstallPrompt: React.FC<{ error: string; onRetry: () => Promise<void>; onFallback: () => void }> = ({ error, onRetry, onFallback }) => {
  const isWin = (window.electronAPI?.platform || 'linux') === 'win32'
  const [activeTab, setActiveTab] = useState<'windows' | 'nix'>(isWin ? 'windows' : 'nix')
  const [manualOpen, setManualOpen] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [localError, setLocalError] = useState(error)

  useEffect(() => {
    setLocalError(error)
  }, [error])

  const handleCheckAgain = async () => {
    if (isChecking) return
    setIsChecking(true)
    setLocalError('')
    try {
      await onRetry()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }

  const npmCmd = 'npm install -g code-server'
  const nixCmd = 'curl -fsSL https://code-server.dev/install.sh | sh'

  return (
    <div className="codeserver-install-root">
      <style>{`
        .codeserver-install-root {
          padding: 24px;
          color: #d4d4d4;
          font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
          font-size: 13px;
          overflow-y: auto;
          height: 100%;
          box-sizing: border-box;
          background: rgba(20, 20, 25, 0.6);
          backdrop-filter: blur(16px);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .codeserver-title {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
          margin-bottom: 4px;
        }
        .codeserver-error {
          background: rgba(255, 107, 107, 0.08);
          border: 1px solid rgba(255, 107, 107, 0.2);
          border-radius: 6px;
          padding: 10px 14px;
          color: #ff8888;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          line-height: 1.4;
          word-break: break-all;
        }
        .codeserver-tabs {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          gap: 16px;
        }
        .codeserver-tab-btn {
          background: none;
          border: none;
          padding: 8px 4px 10px 4px;
          color: rgba(255, 255, 255, 0.5);
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          position: relative;
          transition: color 0.15s ease;
        }
        .codeserver-tab-btn:hover {
          color: rgba(255, 255, 255, 0.85);
        }
        .codeserver-tab-btn.active {
          color: var(--selection-color, #4dabe8);
        }
        .codeserver-tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          width: 100%;
          height: 2px;
          background: var(--selection-color, #4dabe8);
          border-radius: 2px;
        }
        .codeserver-section-title {
          font-size: 13px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .codeserver-wsl-callout {
          color: #ffcc66;
          font-size: 11px;
          font-style: italic;
          opacity: 0.85;
          margin-top: 4px;
        }
        .codeserver-code-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          padding: 8px 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          overflow-x: auto;
          gap: 12px;
        }
        .codeserver-code-text {
          white-space: nowrap;
          color: #e6e8ec;
        }
        .codeserver-copy-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          color: rgba(255, 255, 255, 0.7);
          padding: 4px 8px;
          font-family: inherit;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s ease;
          flex-shrink: 0;
        }
        .codeserver-copy-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .codeserver-copy-btn.copied {
          background: rgba(78, 203, 113, 0.15);
          border-color: rgba(78, 203, 113, 0.3);
          color: #cfeebd;
        }
        .codeserver-collapsible-header {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.85);
          transition: background 0.15s ease;
          user-select: none;
        }
        .codeserver-collapsible-header:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .codeserver-collapsible-content {
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-top: none;
          border-bottom-left-radius: 6px;
          border-bottom-right-radius: 6px;
          margin-top: -6px;
          font-size: 12.5px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.7);
        }
        .codeserver-footer-info {
          font-size: 11.5px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.4);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 12px;
          margin-top: 8px;
        }
        .codeserver-actions {
          display: flex;
          gap: 10px;
          margin-top: 4px;
        }
        .codeserver-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.85);
          padding: 8px 16px;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .codeserver-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .codeserver-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .codeserver-btn.primary {
          background: color-mix(in srgb, var(--selection-color, #4dabe8) 20%, rgba(255, 255, 255, 0.05));
          border-color: rgba(77, 171, 232, 0.35);
          color: #cfe6ff;
        }
        .codeserver-btn.primary:hover:not(:disabled) {
          background: color-mix(in srgb, var(--selection-color, #4dabe8) 30%, rgba(255, 255, 255, 0.05));
          border-color: rgba(77, 171, 232, 0.5);
          box-shadow: 0 0 10px rgba(77, 171, 232, 0.15);
        }
      `}</style>

      <div>
        <div className="codeserver-title">code-server not available</div>
        <div style={{ opacity: 0.6 }}>An instance of code-server is required to power the workspace editor panel.</div>
      </div>

      {localError && (
        <div className="codeserver-error">
          <strong>Startup Error:</strong> {localError}
        </div>
      )}

      <div className="codeserver-tabs">
        <button
          className={`codeserver-tab-btn ${activeTab === 'windows' ? 'active' : ''}`}
          onClick={() => setActiveTab('windows')}
        >
          Windows
        </button>
        <button
          className={`codeserver-tab-btn ${activeTab === 'nix' ? 'active' : ''}`}
          onClick={() => setActiveTab('nix')}
        >
          macOS / Linux
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {activeTab === 'windows' ? (
          <>
            <div>
              <div className="codeserver-section-title">Recommended: Install via npm</div>
              <div style={{ marginBottom: 8, opacity: 0.75 }}>Run this command globally inside Windows PowerShell or CMD (not WSL):</div>
              <CodeBlock text={npmCmd} />
              <div className="codeserver-wsl-callout" style={{ opacity: 0.7 }}>
                <em>Run this in Windows PowerShell or CMD — not your WSL terminal.</em>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <div
                className="codeserver-collapsible-header"
                onClick={() => setManualOpen(!manualOpen)}
              >
                <span>{manualOpen ? '▼' : '▶'}</span>
                <span>Alternative: Manual Installation (GitHub Release)</span>
              </div>
              {manualOpen && (
                <div className="codeserver-collapsible-content">
                  1. Go to the <a href="https://github.com/coder/code-server/releases" target="_blank" rel="noreferrer" style={{ color: 'var(--selection-color, #4dabe8)' }}>code-server GitHub Releases</a> page.<br/>
                  2. Download the latest Windows release zip (e.g. <code>code-server-*-windows-amd64.zip</code>).<br/>
                  3. Extract it and place the folder in your Program Files directory.<br/>
                  4. Add the extracted folder&apos;s <code>bin/</code> folder to your Windows system environment variables <strong>PATH</strong>.
                </div>
              )}
            </div>
          </>
        ) : (
          <div>
            <div className="codeserver-section-title">Install via script</div>
            <div style={{ marginBottom: 8, opacity: 0.75 }}>Execute the official installation script inside your terminal:</div>
            <CodeBlock text={nixCmd} />
          </div>
        )}
      </div>

      <div className="codeserver-actions">
        <button
          className="codeserver-btn primary"
          onClick={handleCheckAgain}
          disabled={isChecking}
        >
          {isChecking ? (
            <>
              <span className="spinner" style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                border: '2px solid rgba(255,255,255,0.3)',
                borderRadius: '50%',
                borderTopColor: '#fff',
                animation: 'spin 0.8s linear infinite',
                marginRight: 4
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              Probing PATH...
            </>
          ) : (
            "I've installed it — check again"
          )}
        </button>
        <button
          className="codeserver-btn"
          onClick={onFallback}
          disabled={isChecking}
        >
          Use Deck&apos;s built-in editor
        </button>
      </div>

      <div className="codeserver-footer-info">
        • runs locally on 127.0.0.1 with a randomly allocated port, --auth password (auto-managed), and --disable-telemetry<br/>
        • user data and extension plugins reside in this application&apos;s isolated userData directory<br/>
        • a single running process is safely shared across all of your active editor panels
      </div>
    </div>
  )
}

const CodeBlock: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="codeserver-code-box">
      <div className="codeserver-code-text">{text}</div>
      <button
        type="button"
        className={`codeserver-copy-btn ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
      >
        <i className={copied ? "ti ti-check" : "ti ti-copy"} />
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>
    </div>
  )
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', lua: 'lua',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
  md: 'markdown', html: 'html', xml: 'xml', css: 'css', scss: 'scss',
  sh: 'shell', bash: 'shell', sql: 'sql', txt: 'plaintext'
}
const detectLang = (path?: string) => {
  if (!path) return 'plaintext'
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? (EXT_LANG[m[1]] || 'plaintext') : 'plaintext'
}
const basenameOf = (p?: string) => (p ? p.replace(/.*\//, '') : 'untitled')

const MonacoFallback: React.FC<{ panel: PanelType }> = ({ panel }) => {
  const settings = (panel.settings || {}) as EditorSettings
  const [content, setContent] = useState<string>(settings.content ?? '')
  const [filePath, setFilePath] = useState<string | undefined>(settings.filePath)
  const [language, setLanguage] = useState<string>(settings.language || detectLang(settings.filePath))
  const [dirty, setDirty] = useState(false)
  const prefs = useWorkspaceStore(s => s.prefs)
  const defaultFontSize = settings.fontSize || prefs.editorFontSize || 14
  const defaultWordWrap = settings.wordWrap || prefs.editorWordWrap || 'off'
  const [fontSize] = useState<number>(defaultFontSize)
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>(defaultWordWrap)
  const [statusMsg, setStatusMsg] = useState<string>('')
  const flashTimerRef = useRef<number>(0)
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null)
  const lastSavedRef = useRef<string>(settings.content ?? '')

  // Create stable refs to avoid stale closures in handleMount commands
  const contentRef = useRef(content)
  const filePathRef = useRef(filePath)
  const dirtyRef = useRef(dirty)

  useEffect(() => { contentRef.current = content }, [content])
  useEffect(() => { filePathRef.current = filePath }, [filePath])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const persist = useCallback((next: Partial<EditorSettings>) => {
    useWorkspaceStore.getState().updatePanel(panel.id, {
      settings: { ...(panel.settings || {}), ...next }
    }, { skipHistory: true })
  }, [panel.id, panel.settings])

  const persistRef = useRef(persist)
  useEffect(() => { persistRef.current = persist }, [persist])

  useEffect(() => {
    let cancelled = false
    if (settings.filePath && (settings.content === undefined || settings.content === '')) {
      window.electronAPI?.file?.read(settings.filePath).then(r => {
        if (cancelled) return
        if (r.ok && r.content !== undefined) {
          setContent(r.content)
          lastSavedRef.current = r.content
          setDirty(false)
        }
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id])

  useEffect(() => () => { window.clearTimeout(flashTimerRef.current) }, [])

  const flash = (m: string) => {
    window.clearTimeout(flashTimerRef.current)
    setStatusMsg(m)
    flashTimerRef.current = window.setTimeout(() => setStatusMsg(s => s === m ? '' : s), 1800)
  }

  const doSave = useCallback(async (saveAs = false) => {
    const api = window.electronAPI?.file
    if (!api) return
    let target = filePathRef.current
    if (!target || saveAs) {
      const r = await api.saveDialog({ suggestedName: basenameOf(target) })
      if (!r.ok || !r.path) return
      target = r.path
    }
    const currentContent = contentRef.current
    const w = await api.write(target, currentContent)
    if (!w.ok) { flash(`save failed: ${w.error}`); return }
    setFilePath(target); setLanguage(detectLang(target))
    lastSavedRef.current = currentContent
    setDirty(false)
    persistRef.current({ filePath: target, content: currentContent, language: detectLang(target) })
    flash('saved')
  }, [])

  const doOpen = useCallback(async () => {
    const api = window.electronAPI?.file
    if (!api) return
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return
    const r = await api.openDialog()
    if (!r.ok || !r.path) return
    const read = await api.read(r.path)
    if (!read.ok || read.content === undefined) { flash(`read failed: ${read.error}`); return }
    setFilePath(r.path); setContent(read.content); setLanguage(detectLang(r.path))
    lastSavedRef.current = read.content; setDirty(false)
    persistRef.current({ filePath: r.path, content: read.content, language: detectLang(r.path) })
  }, [])

  const handleMount: OnMount = (editor, monaco: Monaco) => {
    editorRef.current = editor
    editor.updateOptions({
      fontFamily: prefs.editorFontFamily || "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      fontLigatures: true, fontSize, lineNumbers: 'on',
      minimap: { enabled: true, renderCharacters: false },
      scrollBeyondLastLine: false, smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on', cursorBlinking: 'smooth',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap, renderWhitespace: 'selection', automaticLayout: true,
      padding: { top: 8, bottom: 8 }, tabSize: 2
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => doSave(false))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => doSave(true))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => doOpen())
  }

  const handleChange: OnChange = (value) => {
    const next = value ?? ''
    setContent(next)
    setDirty(next !== lastSavedRef.current)
  }

  return (
    <div className="editor-panel-root" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
      <div className="editor-toolbar" style={toolbarStyle}>
        <button style={btnStyle} onClick={doOpen}>Open</button>
        <button style={btnStyle} onClick={() => doSave(false)}>Save</button>
        <button style={btnStyle} onClick={() => doSave(true)}>Save As</button>
        <span style={{ flex: 1, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filePath || '(built-in editor · code-server not installed)'}{dirty ? ' ●' : ''}
        </span>
        <span style={{ opacity: 0.55 }}>{language}</span>
        <button style={{ ...btnStyle, opacity: wordWrap === 'on' ? 1 : 0.6 }} onClick={() => {
          setWordWrap(prev => {
            const next: 'on' | 'off' = prev === 'on' ? 'off' : 'on'
            editorRef.current?.updateOptions({ wordWrap: next })
            persist({ wordWrap: next })
            return next
          })
        }}>wrap</button>
        {statusMsg && <span style={{ color: '#4dabe8' }}>{statusMsg}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor theme="vs-dark" language={language} value={content}
          onMount={handleMount} onChange={handleChange}
          options={{ automaticLayout: true, fontSize }} />
      </div>
    </div>
  )
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
  background: '#181818', borderBottom: '1px solid #2a2a2a',
  fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace'
}

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '2px 8px',
  fontFamily: 'inherit',
  fontSize: 11,
  cursor: 'pointer'
}

const loadingStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '100%', height: '100%',
  color: 'rgba(255,255,255,0.6)',
  fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
  background: '#1e1e1e'
}

export default EditorPanel
