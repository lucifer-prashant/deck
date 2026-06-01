import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './PanelContextMenu.css'

interface Props {
  x: number
  y: number
  worldX: number
  worldY: number
  onClose: () => void
}

const TYPE_DEFAULTS: Record<Panel['type'], { width: number; height: number; title: string; content?: string }> = {
  terminal: { width: 600, height: 400, title: 'Terminal' },
  editor: { width: 600, height: 400, title: 'Editor' },
  browser: { width: 800, height: 600, title: 'Browser' },
  region: { width: 800, height: 600, title: 'Region' }
}

const CanvasContextMenu: React.FC<Props> = ({ x, y, worldX, worldY, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showNew, setShowNew] = useState(false)
  const { addPanel, selectPanel, addAnnotation } = useWorkspaceStore()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handler, true)
    window.addEventListener('contextmenu', handler, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', handler, true)
      window.removeEventListener('contextmenu', handler, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const createAt = (type: Panel['type']) => () => {
    const d = TYPE_DEFAULTS[type]
    const id = `${type}-${Date.now()}`
    addPanel({
      id, type,
      x: worldX - d.width / 2,
      y: worldY - d.height / 2,
      width: d.width, height: d.height,
      title: d.title, content: d.content
    })
    selectPanel(id)
    onClose()
  }

  const cmd = (c: Parameters<typeof executeWorkspaceCommand>[0]) => () => {
    executeWorkspaceCommand(c)
    onClose()
  }

  const left = Math.max(6, Math.min(x, window.innerWidth - 246))
  const top = Math.max(6, Math.min(y, window.innerHeight - 386))

  return createPortal(
    <div ref={menuRef} className="ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>

      {/* ── New panel submenu ── */}
      <div
        className={`ctx-item ctx-submenu-trigger ${showNew ? 'sub-open' : ''}`}
        onMouseEnter={() => setShowNew(true)}
        onMouseLeave={() => setShowNew(false)}
      >
        <span>New</span><span className="ctx-kbd ctx-sub-arrow">▸</span>
        {showNew && (
          <div className="ctx-submenu" onMouseEnter={() => setShowNew(true)} onMouseLeave={() => setShowNew(false)}>
            <button className="ctx-item" onClick={createAt('terminal')}><span>Terminal</span><span className="ctx-kbd">Ctrl+T</span></button>
            <button className="ctx-item" onClick={createAt('editor')}><span>Editor</span><span className="ctx-kbd">Ctrl+E</span></button>
            <button className="ctx-item" onClick={createAt('browser')}><span>Browser</span></button>
            <button className="ctx-item" onClick={createAt('region')}><span>Region</span></button>
          </div>
        )}
      </div>

      <button className="ctx-item" onClick={() => {
        addAnnotation({
          id: `anno-${Date.now()}`,
          type: 'sticky',
          x: worldX - 90, y: worldY - 60,
          width: 180, height: 120,
          text: '',
          color: 'rgba(255, 221, 87, 0.92)',
          title: 'Sticky Note'
        })
        onClose()
      }}><span>Sticky note</span></button>

      <button className="ctx-item" onClick={() => {
        addAnnotation({
          id: `anno-${Date.now()}`,
          type: 'label',
          x: worldX, y: worldY,
          width: 300, height: 0,
          text: '', color: '',
          title: 'Text Label'
        })
        onClose()
      }}><span>Text label</span></button>

      <div className="ctx-sep" />

      <button className="ctx-item" onClick={cmd('select-all')}><span>Select all</span><span className="ctx-kbd">Ctrl+A</span></button>
      <button className="ctx-item" onClick={cmd('fit-all')}><span>Fit all panels</span></button>
      <button className="ctx-item" onClick={cmd('reset-viewport')}><span>Reset viewport</span><span className="ctx-kbd">Ctrl+0</span></button>

      <div className="ctx-sep" />

      <button className="ctx-item" onClick={cmd('toggle-minimap')}><span>Toggle minimap</span></button>

      <div className="ctx-sep" />

      <button className="ctx-item danger" onClick={cmd('clear-canvas')}><span>Clear canvas</span></button>
    </div>,
    document.body
  )
}

export default CanvasContextMenu
