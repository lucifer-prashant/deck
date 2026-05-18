import React, { useEffect, useRef } from 'react'
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
  note: { width: 340, height: 240, title: 'Note', content: '' },
  browser: { width: 800, height: 600, title: 'Browser' },
  region: { width: 800, height: 600, title: 'Region' }
}

const CanvasContextMenu: React.FC<Props> = ({ x, y, worldX, worldY, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
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
      id,
      type,
      x: worldX - d.width / 2,
      y: worldY - d.height / 2,
      width: d.width,
      height: d.height,
      title: d.title,
      content: d.content
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
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-section">New at cursor</div>
      <button className="ctx-item" onClick={createAt('terminal')}><span>Terminal</span><span className="ctx-kbd">Ctrl+T</span></button>
      <button className="ctx-item" onClick={createAt('editor')}><span>Editor</span><span className="ctx-kbd">Ctrl+E</span></button>
      <button className="ctx-item" onClick={createAt('note')}><span>Note</span><span className="ctx-kbd">Ctrl+N</span></button>
      <button className="ctx-item" onClick={createAt('browser')}><span>Browser</span></button>
      <button className="ctx-item" onClick={createAt('region')}><span>Region</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => {
        addAnnotation({
          id: `anno-${Date.now()}`,
          type: 'sticky',
          x: worldX - 90, y: worldY - 60,
          width: 180, height: 120,
          text: '',
          color: 'rgba(255, 221, 87, 0.92)'
        })
        onClose()
      }}><span>Sticky note</span></button>
      <button className="ctx-item" onClick={() => {
        addAnnotation({
          id: `anno-${Date.now()}`,
          type: 'label',
          x: worldX, y: worldY,
          width: 0, height: 0,
          text: 'Label',
          color: ''
        })
        onClose()
      }}><span>Text label</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={cmd('select-all')}><span>Select all</span><span className="ctx-kbd">Ctrl+A</span></button>
      <button className="ctx-item" onClick={cmd('fit-all')}><span>Fit all panels</span></button>
      <button className="ctx-item" onClick={cmd('reset-viewport')}><span>Reset viewport</span><span className="ctx-kbd">Ctrl+0</span></button>
      <button className="ctx-item" onClick={cmd('zoom-in')}><span>Zoom in</span><span className="ctx-kbd">Ctrl+=</span></button>
      <button className="ctx-item" onClick={cmd('zoom-out')}><span>Zoom out</span><span className="ctx-kbd">Ctrl+-</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={cmd('toggle-snap')}><span>Toggle snap to grid</span></button>
      <button className="ctx-item" onClick={cmd('toggle-minimap')}><span>Toggle minimap</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={cmd('clear-canvas')}>
        <span>Clear canvas</span>
      </button>
    </div>,
    document.body
  )
}

export default CanvasContextMenu
