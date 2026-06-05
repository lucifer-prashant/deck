import React, { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Panel as PanelType, useWorkspaceStore } from '../store/workspaceStore'

interface Props {
  panel: PanelType
}

const THEME = {
  background: '#0e0e10',
  foreground: '#e6e6e6',
  cursor: '#ffffff',
  cursorAccent: '#0e0e10',
  selectionBackground: 'rgba(77,171,232,0.35)',
  black: '#1d1f21',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdfe4',
  brightBlack: '#5c6370',
  brightRed: '#ff7b85',
  brightGreen: '#a8d989',
  brightYellow: '#f5d07b',
  brightBlue: '#7ac0ff',
  brightMagenta: '#d693e6',
  brightCyan: '#6cc7d1',
  brightWhite: '#ffffff'
}

const TerminalPanel: React.FC<Props> = ({ panel }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const disposeData = useRef<(() => void) | null>(null)
    const disposeExit = useRef<(() => void) | null>(null)
    const spawnedRef = useRef(false)
    const updatePanel = useWorkspaceStore(s => s.updatePanel)

    // Set initial health state.
    useEffect(() => {
      updatePanel(panel.id, { healthState: 'alive' }, { skipHistory: true })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const prefs = useWorkspaceStore.getState().prefs
    const initialFontSize = (panel.settings?.fontSize as number | undefined) ?? prefs.terminalFontSize ?? 15
    const term = new Terminal({
      fontFamily: prefs.terminalFontFamily || "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, monospace",
      fontSize: initialFontSize,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      allowTransparency: false,
      scrollback: prefs.terminalScrollback ?? 10000,
      smoothScrollDuration: 80,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)

    // Try WebGL renderer for crisp text at any DPR. Dynamic import so any failure
    // (missing dep, no GL context) cannot break the component.
    import('xterm-addon-webgl').then(mod => {
      try {
        const webgl = new mod.WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch (err) {
        console.warn('[TerminalPanel] webgl addon init failed, using canvas', err)
      }
    }).catch(err => {
      console.warn('[TerminalPanel] webgl module load failed, using canvas', err)
    })

    termRef.current = term
    fitRef.current = fit

    const api = window.electronAPI?.pty
    if (!api) {
      term.writeln('\x1b[31m[pty bridge unavailable — preload not loaded]\x1b[0m')
      return () => { term.dispose() }
    }

    // Buffer any incoming data that arrives before the scrollback replay
    // completes, so we don't drop bytes during the async fetch window.
    const preReplayQueue: string[] = []
    let replayed = false
    disposeData.current = api.onData((id, data) => {
      if (id !== panel.id) return
      if (!replayed) preReplayQueue.push(data)
      else term.write(data)
    })
    disposeExit.current = api.onExit((id, info) => {
      if (id !== panel.id) return
      term.writeln(`\r\n\x1b[90m[process exited code=${info.exitCode}]\x1b[0m`)
      updatePanel(panel.id, { healthState: 'dead' }, { skipHistory: true })
    })
    // Pull existing scrollback (preserved per-pty in main process) so a new
    // xterm — fresh pop-out window or re-attach after restart — shows the
    // history the user already produced. Without this every new mount looks
    // empty even though the pty is still running.
    api.scrollback?.(panel.id).then(r => {
      if (r?.ok && r.data) term.write(r.data)
      replayed = true
      // Flush whatever data arrived between subscribe and replay.
      while (preReplayQueue.length) term.write(preReplayQueue.shift()!)
    }).catch(() => { replayed = true })
    const inputDisp = term.onData(d => api.write(panel.id, d))

    const doFit = () => {
      try {
        fit.fit()
        return { cols: term.cols, rows: term.rows }
      } catch { return { cols: 80, rows: 24 } }
    }

    requestAnimationFrame(() => {
      const { cols, rows } = doFit()
      if (!spawnedRef.current) {
        spawnedRef.current = true
        const cwd = (panel.settings?.cwd as string | undefined) || undefined
        const shell = prefs.defaultTerminalShell || undefined
        api.spawn({ panelId: panel.id, cwd, cols, rows, shell }).catch(err => {
          term.writeln(`\x1b[31m[spawn failed: ${String(err)}]\x1b[0m`)
        })
      }
      term.focus()
      // Expose cwd as panel context so sidebar/git can read it.
      const cwd = (panel.settings?.cwd as string | undefined) || undefined
      if (cwd) {
        useWorkspaceStore.getState().updatePanel(panel.id, { cwd }, { skipHistory: true })
      }
    })

    // Poll /proc/<pid>/cwd so sidebar Explorer follows cd's. Cheap symlink read every 1.5s.
    let lastCwd = ''
    const cwdInterval = window.setInterval(async () => {
      const r = await api.cwd(panel.id)
      if (r?.ok && r.cwd && r.cwd !== lastCwd) {
        lastCwd = r.cwd
        useWorkspaceStore.getState().updatePanel(panel.id, { cwd: r.cwd }, { skipHistory: true })
      }
    }, 1500)

    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      try {
        fitRef.current.fit()
        api.resize(panel.id, termRef.current.cols, termRef.current.rows)
      } catch { /* ignore */ }
    })
    ro.observe(containerRef.current)

    return () => {
      try { ro.disconnect() } catch { /* ignore */ }
      try { inputDisp.dispose() } catch { /* ignore */ }
      try { disposeData.current?.() } catch { /* ignore */ }
      try { disposeExit.current?.() } catch { /* ignore */ }
      try { window.clearInterval(cwdInterval) } catch { /* ignore */ }
      // Do NOT kill the pty on unmount — the panel may be popping out into a
      // separate window or being temporarily detached. The pty session lives
      // in the main process and survives across windows. It is explicitly
      // killed only when the panel is deleted (see store.deletePanel).
      try { term.dispose() } catch { /* ignore */ }
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id])

  // Esc handled globally in App.tsx. Here we intercept Ctrl+= / Ctrl+- / Ctrl+0 for font sizing,
  // plus Ctrl+Shift+C copy and Ctrl+Shift+V paste.
  const handleKeyDownCapture = (e: React.KeyboardEvent) => {
    const t = termRef.current
    if (!t) return
    // Copy / paste using Ctrl+Shift+C and Ctrl+Shift+V (linux terminal convention).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
      if (e.key === 'C' || e.key === 'c') {
        const sel = t.getSelection()
        if (sel) {
          e.preventDefault(); e.stopPropagation()
          navigator.clipboard?.writeText(sel).catch(() => {})
          return
        }
      }
      if (e.key === 'V' || e.key === 'v') {
        e.preventDefault(); e.stopPropagation()
        navigator.clipboard?.readText?.().then(text => {
          if (text) window.electronAPI?.pty?.write(panel.id, text)
        }).catch(() => {})
        return
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const adjust = (delta: number | 'reset') => {
        const cur = t.options.fontSize ?? 15
        const next = delta === 'reset' ? 15 : Math.max(8, Math.min(40, cur + delta))
        t.options.fontSize = next
        try { fitRef.current?.fit() } catch { /* ignore */ }
        // Persist so size survives reload.
        useWorkspaceStore.getState().updatePanel(panel.id, {
          settings: { ...(panel.settings || {}), fontSize: next }
        }, { skipHistory: true })
      }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); e.stopPropagation(); adjust(+1); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); e.stopPropagation(); adjust(-1); return }
      if (e.key === '0') { e.preventDefault(); e.stopPropagation(); adjust('reset'); return }
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-wts-path')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-wts-path')
    if (!raw) return
    e.preventDefault()
    try {
      const data = JSON.parse(raw) as { path: string; isDir: boolean }
      const api = window.electronAPI?.pty
      if (!api) return
      // For dirs → cd. For files → cd to parent and echo the file (most useful in practice).
      const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
      if (data.isDir) {
        api.write(panel.id, ` cd ${shellQuote(data.path)}\n`)
      } else {
        // Strip trailing filename → parent dir. Root files (e.g. /file.txt) produce
        // empty string after replace, fall back to / so cd doesn't fail.
        const parent = data.path.replace(/\/[^/]+$/, '') || '/'
        api.write(panel.id, ` cd ${shellQuote(parent)} && ls ${shellQuote(data.path.split('/').pop() || '')}\n`)
      }
    } catch { /* ignore */ }
  }

  return (
    <div
      ref={containerRef}
      className="terminal-xterm"
      onKeyDownCapture={handleKeyDownCapture}
      onClick={() => termRef.current?.focus()}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // Wheel inside terminal must scroll the terminal scrollback, not the canvas.
      // Stop propagation so Canvas's wheel handler (zoom/pan) never sees the event.
      onWheel={(e) => { e.stopPropagation() }}
      style={{ width: '100%', height: '100%', background: '#0e0e10' }}
    />
  )
}

export default TerminalPanel
