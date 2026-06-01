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
  const theme = useWorkspaceStore(s => s.theme)
  const [redocking, setRedocking] = useState(false)

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
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = () => document.documentElement.setAttribute('data-theme', mq.matches ? 'light' : 'dark')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
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
