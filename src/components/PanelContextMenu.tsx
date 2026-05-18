import React, { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, Panel as PanelType } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './PanelContextMenu.css'

interface Props {
  panel: PanelType
  x: number
  y: number
  onClose: () => void
  onRename: () => void
}

const COLORS = [
  { name: 'None', value: '' },
  { name: 'Blue', value: '#0078d4' },
  { name: 'Green', value: '#2d8a4e' },
  { name: 'Slate', value: '#475569' },
  { name: 'Magenta', value: '#c026d3' },
  { name: 'Crimson', value: '#dc2626' },
  { name: 'Teal', value: '#0d9488' },
  { name: 'Violet', value: '#7c3aed' }
]

const PanelContextMenu: React.FC<Props> = ({ panel, x, y, onClose, onRename }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const { updatePanel, deletePanel, selectedPanelIds, selectPanel, panels } = useWorkspaceStore()
  const isPresetBrowser =
    (panel.id.startsWith('preset-life-') || panel.id.startsWith('preset-no-life-')) &&
    panel.type === 'browser'
  const isAsleep = panel.type === 'browser' && !!(panel.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad

  // Per-panel front/back state so user can toggle individually.
  const isAtFront = useMemo(() => {
    const maxZ = Math.max(1, ...Object.values(panels).map(p => p.zIndex || 1))
    return (panel.zIndex || 1) >= maxZ && Object.values(panels).filter(p => (p.zIndex || 1) === maxZ).length === 1
  }, [panels, panel.zIndex])
  const isAtBack = useMemo(() => {
    const zs = Object.values(panels).map(p => p.zIndex || 1)
    const minZ = Math.min(...zs, panel.zIndex || 1)
    return (panel.zIndex || 1) <= minZ && zs.filter(z => z === minZ).length === 1
  }, [panels, panel.zIndex])

  const raise = () => {
    const maxZ = Math.max(1, ...Object.values(panels).map(p => p.zIndex || 1))
    updatePanel(panel.id, { zIndex: maxZ + 1 }, { skipHistory: true })
  }
  const lower = () => {
    const minZ = Math.min(...Object.values(panels).map(p => p.zIndex || 1), panel.zIndex || 1)
    updatePanel(panel.id, { zIndex: minZ - 1 }, { skipHistory: true })
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // capture: true so child stopPropagation doesn't swallow the close signal.
    window.addEventListener('mousedown', handler, true)
    window.addEventListener('contextmenu', handler, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', handler, true)
      window.removeEventListener('contextmenu', handler, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const ensureSelected = () => {
    if (!selectedPanelIds.includes(panel.id)) selectPanel(panel.id)
  }

  const run = (fn: () => void) => () => {
    ensureSelected()
    fn()
    onClose()
  }

  const cmd = (c: Parameters<typeof executeWorkspaceCommand>[0]) => () => {
    ensureSelected()
    executeWorkspaceCommand(c)
    onClose()
  }

  // Clamp position to viewport; never let top/left go negative on short windows.
  const left = Math.max(6, Math.min(x, window.innerWidth - 246))
  const top = Math.max(6, Math.min(y, window.innerHeight - 366))

  return createPortal(
    <div ref={menuRef} className="ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <button className="ctx-item" onClick={() => { onRename(); onClose() }}>
        <span>Rename</span><span className="ctx-kbd">F2</span>
      </button>
      <button className="ctx-item" onClick={cmd('duplicate-selected')}>
        <span>Duplicate</span><span className="ctx-kbd">Ctrl+D</span>
      </button>
      {panel.type !== 'region' && (
        <button className="ctx-item" onClick={run(() => {
          // If stacked, unstack first so the panel keeps its original size.
          if (panel.stackParentId) {
            useWorkspaceStore.getState().unstackPanel(panel.id)
          }
          window.electronAPI?.window?.popoutPanel(panel.id)
        })}>
          <span>Pop out to window</span><span className="ctx-kbd">⇱</span>
        </button>
      )}
      {(panel.stackParentId || (panel.stackChildren && panel.stackChildren.length > 0)) && (
        <button className="ctx-item" onClick={run(() => {
          useWorkspaceStore.getState().unstackPanel(panel.id)
        })}>
          <span>Unstack panel</span>
        </button>
      )}
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={run(() => updatePanel(panel.id, { locked: !panel.locked }))}>
        <span>{panel.locked ? 'Unlock' : 'Lock'}</span>
      </button>
      <button className="ctx-item" onClick={run(() => updatePanel(panel.id, { minimized: !panel.minimized }))}>
        <span>{panel.minimized ? 'Restore' : 'Minimize'}</span>
      </button>
      {panel.type === 'browser' && (
        <button className="ctx-item" onClick={run(() => updatePanel(panel.id, {
          settings: { ...(panel.settings || {}), lazyLoad: !isAsleep }
        }, { skipHistory: true }))}>
          <span>{isAsleep ? 'Wake panel' : 'Put to sleep'}</span>
        </button>
      )}
      {isPresetBrowser && !isAsleep && (
        <>
          <button className="ctx-item" onClick={run(() => updatePanel(panel.id, {
            settings: { ...(panel.settings || {}), browserCommand: { name: 'reload', nonce: Date.now() } }
          }, { skipHistory: true }))}>
            <span>Reload view</span>
          </button>
          <button className="ctx-item" onClick={run(() => updatePanel(panel.id, {
            settings: { ...(panel.settings || {}), browserCommand: { name: 'back', nonce: Date.now() } }
          }, { skipHistory: true }))}>
            <span>Go back</span>
          </button>
          <button className="ctx-item" onClick={run(() => updatePanel(panel.id, {
            settings: { ...(panel.settings || {}), browserCommand: { name: 'forward', nonce: Date.now() } }
          }, { skipHistory: true }))}>
            <span>Go forward</span>
          </button>
        </>
      )}
      <button className="ctx-item" onClick={run(() => updatePanel(panel.id, { pinFront: !panel.pinFront, pinBack: false }))}>
        <span>{panel.pinFront ? 'Unpin from front' : 'Pin to front'}</span>
        {panel.pinFront && <span className="ctx-kbd">on</span>}
      </button>
      <button className="ctx-item" onClick={run(() => updatePanel(panel.id, { pinBack: !panel.pinBack, pinFront: false }))}>
        <span>{panel.pinBack ? 'Unpin from back' : 'Pin to back'}</span>
        {panel.pinBack && <span className="ctx-kbd">on</span>}
      </button>
      <button className="ctx-item" onClick={run(() => updatePanel(panel.id, { starred: !panel.starred }))}>
        <span>{panel.starred ? 'Unstar' : 'Star'}</span>
        {panel.starred && <span className="ctx-kbd">★</span>}
      </button>
      <button className="ctx-item" onClick={run(() => {
        const next = window.prompt('Subtitle / description', panel.description || '')
        if (next !== null) updatePanel(panel.id, { description: next.trim() || undefined })
      })}>
        <span>Set description…</span>
      </button>
      <button className="ctx-item" onClick={run(raise)} disabled={isAtFront}>
        <span>Bring to front</span>
        {isAtFront && <span className="ctx-kbd">at top</span>}
      </button>
      <button className="ctx-item" onClick={run(lower)} disabled={isAtBack}>
        <span>Send to back</span>
        {isAtBack && <span className="ctx-kbd">at back</span>}
      </button>
      <div className="ctx-sep" />
      <div className="ctx-section">Color</div>
      <div className="ctx-colors">
        {COLORS.map(c => (
          <button
            key={c.name}
            className={`ctx-swatch ${panel.color === c.value || (!panel.color && !c.value) ? 'active' : ''}`}
            style={{ background: c.value || 'transparent', borderColor: c.value || 'rgba(255,255,255,0.3)' }}
            title={c.name}
            onClick={run(() => updatePanel(panel.id, { color: c.value || undefined }))}
          />
        ))}
      </div>
      <div className="ctx-sep" />
      {selectedPanelIds.length > 1 && (
        <>
          <button className="ctx-item" onClick={cmd('group-region')}><span>Group into region</span><span className="ctx-kbd">Ctrl+G</span></button>
          <button className="ctx-item" onClick={cmd('align-left')}><span>Align left</span></button>
          <button className="ctx-item" onClick={cmd('align-top')}><span>Align top</span></button>
          <button className="ctx-item" onClick={cmd('distribute-horizontal')}><span>Distribute horiz.</span></button>
          <div className="ctx-sep" />
        </>
      )}
      {panel.type === 'region' && (
        <>
          <button className="ctx-item" onClick={cmd('ungroup-region')}><span>Ungroup region</span></button>
          <div className="ctx-sep" />
        </>
      )}
      <button className="ctx-item danger" onClick={run(() => deletePanel(panel.id))}>
        <span>Delete</span><span className="ctx-kbd">Del</span>
      </button>
    </div>,
    document.body
  )
}

export default PanelContextMenu
