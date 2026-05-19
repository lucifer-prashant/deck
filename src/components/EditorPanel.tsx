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
  const [folderPath, setFolderPath] = useState<string | undefined>(settings.folderPath)
  const [startError, setStartError] = useState<string>('')

  // Try to bring up code-server on mount. Falls back to install prompt or monaco scratch.
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI?.codeServer
    if (!api) { setMode('monaco'); return }
    (async () => {
      const status = await api.status()
      if (cancelled) return
      if (status.running && status.url) {
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
        setServerUrl(r.url)
        setMode('codeserver')
      } else {
        setStartError(r.error || 'unknown')
        setMode('install')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Folder picking now happens inside code-server itself (File → Open Folder).
  // Persist any folder picked via panel context menu in the future; for now no-op here.
  void setFolderPath

  if (mode === 'loading') {
    return <div style={loadingStyle}>starting code-server…</div>
  }

  if (mode === 'install') {
    return <InstallPrompt error={startError} onRetry={async () => {
      setMode('loading')
      const r = await window.electronAPI?.codeServer?.start()
      if (r?.ok && r.url) { setServerUrl(r.url); setMode('codeserver') }
      else { setStartError(r?.error || 'unknown'); setMode('install') }
    }} onFallback={() => setMode('monaco')} />
  }

  if (mode === 'monaco') {
    return <MonacoFallback panel={panel} />
  }

  // codeserver mode
  const url = folderPath
    ? `${serverUrl}/?folder=${encodeURIComponent(folderPath)}`
    : serverUrl

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
      const data = JSON.parse(raw) as { path: string; isDir: boolean }
      const dir = data.isDir ? data.path : (await window.electronAPI?.file?.dirname(data.path)) || data.path
      setFolderPath(dir)
      useWorkspaceStore.getState().updatePanel(panel.id, {
        folderPath: dir,
        settings: { ...(panel.settings || {}), folderPath: dir }
      }, { skipHistory: true })
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
        url={url}
        onFolderChanged={(dir) => {
          setFolderPath(dir)
          useWorkspaceStore.getState().updatePanel(panel.id, {
            folderPath: dir,
            settings: { ...(panel.settings || {}), folderPath: dir }
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

const CodeServerWebview: React.FC<{ panelId: string; url: string; onFolderChanged: (dir: string) => void }> = ({ panelId, url, onFolderChanged }) => {
  const wvRef = useRef<HTMLElement | null>(null)
  const lastFolderRef = useRef<string>('')
  const [preloadPath, setPreloadPath] = useState<string | null>(null)

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
    const onDomReady = () => sync()
    // Webview-preload forwards Ctrl+= / Ctrl+- / Ctrl+0 as ipc-message channel='shortcut'.
    // Apply zoom directly on the webview rather than letting code-server's own zoom kick in,
    // because Chromium's setZoomLevel feels more responsive and persists per-panel.
    const onIpc = (e: Event) => {
      const ev = e as unknown as { channel: string; args: unknown[] }
      if (ev.channel === 'focus-claim') {
        // User clicked/typed inside code-server. Switch selection + body-active to THIS
        // panel so any other panel's stale selection ring goes away.
        const s = useWorkspaceStore.getState()
        if (s.headerActivePanelId) s.setHeaderActivePanel(null)
        if (s.bodyActivePanelId !== panelId) s.setBodyActivePanel(panelId)
        if (s.selectedPanelIds.length !== 1 || s.selectedPanelIds[0] !== panelId) {
          s.selectPanel(panelId)
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
    src: url,
    allowpopups: 'true',
    partition: 'persist:wts-code-server',
    style: { flex: 1, minHeight: 0, display: 'flex' }
  }
  if (preloadPath) props.preload = preloadPath
  return React.createElement('webview', props)
}

const InstallPrompt: React.FC<{ error: string; onRetry: () => void; onFallback: () => void }> = ({ error, onRetry, onFallback }) => {
  const cmd = 'curl -fsSL https://code-server.dev/install.sh | sh'
  return (
    <div style={{ padding: 20, color: '#d4d4d4', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>code-server not available</div>
      {error && <div style={{ color: '#ff8888', marginBottom: 12 }}>{error}</div>}
      <div style={{ marginBottom: 8, opacity: 0.85 }}>install once, then click retry:</div>
      <div style={{
        background: '#0d0d10', padding: '10px 12px', borderRadius: 6, border: '1px solid #2a2a2a',
        userSelect: 'all', cursor: 'text', marginBottom: 12, fontFamily: 'inherit', fontSize: 12, overflowX: 'auto', whiteSpace: 'nowrap'
      }}>
        {cmd}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={btnStyle} onClick={() => navigator.clipboard.writeText(cmd)}>copy command</button>
        <button style={{ ...btnStyle, background: 'rgba(77,171,232,0.18)', color: '#cfe6ff' }} onClick={onRetry}>retry</button>
        <button style={btnStyle} onClick={onFallback}>use scratch editor</button>
      </div>
      <div style={{ opacity: 0.55, fontSize: 11, lineHeight: 1.5 }}>
        - runs locally on 127.0.0.1 with a random port, --auth none, --disable-telemetry<br/>
        - data lives in this app&apos;s userData dir (independent from any system code-server)<br/>
        - one process shared across all editor panels
      </div>
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
  const [fontSize] = useState<number>(settings.fontSize || 14)
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>(settings.wordWrap || 'off')
  const [statusMsg, setStatusMsg] = useState<string>('')
  const flashTimerRef = useRef<number>(0)
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null)
  const lastSavedRef = useRef<string>(settings.content ?? '')

  const persist = useCallback((next: Partial<EditorSettings>) => {
    useWorkspaceStore.getState().updatePanel(panel.id, {
      settings: { ...(panel.settings || {}), ...next }
    }, { skipHistory: true })
  }, [panel.id, panel.settings])

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
    let target = filePath
    if (!target || saveAs) {
      const r = await api.saveDialog({ suggestedName: basenameOf(target) })
      if (!r.ok || !r.path) return
      target = r.path
    }
    const w = await api.write(target, content)
    if (!w.ok) { flash(`save failed: ${w.error}`); return }
    setFilePath(target); setLanguage(detectLang(target))
    lastSavedRef.current = content
    setDirty(false)
    persist({ filePath: target, content, language: detectLang(target) })
    flash('saved')
  }, [filePath, content, persist])

  const doOpen = useCallback(async () => {
    const api = window.electronAPI?.file
    if (!api) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    const r = await api.openDialog()
    if (!r.ok || !r.path) return
    const read = await api.read(r.path)
    if (!read.ok || read.content === undefined) { flash(`read failed: ${read.error}`); return }
    setFilePath(r.path); setContent(read.content); setLanguage(detectLang(r.path))
    lastSavedRef.current = read.content; setDirty(false)
    persist({ filePath: r.path, content: read.content, language: detectLang(r.path) })
  }, [dirty, persist])

  const handleMount: OnMount = (editor, monaco: Monaco) => {
    editorRef.current = editor
    editor.updateOptions({
      fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
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
          {filePath || '(scratch · code-server not installed)'}{dirty ? ' ●' : ''}
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
