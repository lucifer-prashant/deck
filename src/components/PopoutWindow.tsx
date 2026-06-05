import React, { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import TerminalPanel from './TerminalPanel'
import EditorPanel from './EditorPanel'
import BrowserPanel from './BrowserPanel'
import './PopoutWindow.css'

interface Props {
  panelId: string
}

const PopoutWindow: React.FC<Props> = ({ panelId }) => {
  const initialize = useWorkspaceStore(s => s.initialize)
  const panel = useWorkspaceStore(s => s.panels[panelId])
  const prefs = useWorkspaceStore(s => s.prefs)
  const [redocking, setRedocking] = useState(false)
  const [systemIsLight, setSystemIsLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => setSystemIsLight(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const theme = useMemo(() => {
    const gridFallbacks: Record<string, string> = {
      none: systemIsLight ? '#f5f6f8' : '#1f2024',
      grid: systemIsLight ? '#f5f6f8' : '#1f2024',
      dot: systemIsLight ? '#f5f6f8' : '#1f2024',
      blueprint: '#182848',
      neon: '#0d0e15'
    }
    const color = prefs.canvasBgColor || gridFallbacks[prefs.canvasGridStyle ?? 'none'] || (systemIsLight ? '#f5f6f8' : '#1f2024')
    if (color.toLowerCase() === '#0d1117') return 'midnight'
    
    const cleanHex = color.replace('#', '')
    let r = 31, g = 32, b = 36
    if (cleanHex.length === 6) {
      const num = parseInt(cleanHex, 16)
      r = (num >> 16) & 255
      g = (num >> 8) & 255
      b = num & 255
    } else if (cleanHex.length === 3) {
      r = parseInt(cleanHex[0] + cleanHex[0], 16)
      g = parseInt(cleanHex[1] + cleanHex[1], 16)
      b = parseInt(cleanHex[2] + cleanHex[2], 16)
    }

    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
    return hsp > 155 ? 'light' : 'dark'
  }, [prefs.canvasBgColor, prefs.canvasGridStyle, systemIsLight])

  useEffect(() => { initialize() }, [initialize])

  // Final-flush handshake: when main process is about to close this window for
  // re-dock, it sends 'popout:flush'. We force a synchronous persist write
  // (touch panels/tabs reference) so localStorage holds our latest changes
  // before main rehydrates and re-renders the panel.
  useEffect(() => {
    const flush = () => {
      const s = useWorkspaceStore.getState()
      useWorkspaceStore.setState({ panels: { ...s.panels }, tabs: [...s.tabs] }, false)
    }
    const off = window.electronAPI?.window?.onPopoutFlush?.(flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      off?.()
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const redock = () => {
    setRedocking(true)
    window.electronAPI?.window?.redockPanel(panelId)
  }

  const body = useMemo(() => {
    if (!panel) return <div className="popout-missing">Panel not found ({panelId}). Close this window.</div>
    switch (panel.type) {
      case 'terminal': return <TerminalPanel panel={panel} />
      case 'editor':   return <EditorPanel panel={panel} />
      case 'browser':  return <BrowserPanel panel={panel} />
      default:
        return <div className="popout-missing">{panel.type} panel not supported in pop-out yet.</div>
    }
  }, [panel, panelId])

  return (
    <div className="popout-shell">
      <div className="popout-bar">
        <span className="popout-title">{panel?.title || 'Panel'}</span>
        <span className="popout-meta">{panel?.type || '—'}</span>
        <div style={{ flex: 1 }} />
        <button className="popout-btn" onClick={redock} disabled={redocking} title="Re-dock onto main canvas (close this window)">
          {redocking ? '…' : '↩ re-dock'}
        </button>
      </div>
      <div className="popout-body">
        {body}
      </div>
    </div>
  )
}

export default PopoutWindow
