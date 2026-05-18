import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import './PanelContextMenu.css'

interface Props {
  anchor: { x: number; y: number }
  onClose: () => void
}

const PresetsMenu: React.FC<Props> = ({ anchor, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const { canvasPresets, saveCanvasPreset, loadCanvasPreset, deleteCanvasPreset } = useWorkspaceStore()

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', h, true)
    window.addEventListener('contextmenu', h, true)
    window.addEventListener('keydown', esc, true)
    setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      window.removeEventListener('mousedown', h, true)
      window.removeEventListener('contextmenu', h, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const sorted = Object.values(canvasPresets).sort((a, b) => b.savedAt - a.savedAt)

  const doSave = () => {
    if (!name.trim()) return
    saveCanvasPreset(name.trim())
    setName('')
  }

  const menuH = Math.min(400, 120 + sorted.length * 32)
  const left = Math.max(6, Math.min(anchor.x, window.innerWidth - 280))
  const top = Math.max(6, anchor.y - menuH)

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top, minWidth: 260 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-section">Save canvas as preset</div>
      <div style={{ padding: '4px 8px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doSave() }}
          placeholder="Preset name…"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.9)',
            fontSize: 11,
            padding: '4px 7px',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />
        <button
          onClick={doSave}
          disabled={!name.trim()}
          style={{
            flexShrink: 0,
            background: name.trim() ? 'rgba(0,120,212,0.85)' : 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            color: name.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
            fontSize: 11,
            padding: '4px 12px',
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}
        >Save</button>
      </div>
      {sorted.length > 0 && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-section">Saved presets</div>
          {sorted.map(p => (
            <div
              key={p.id}
              className="ctx-item"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
            >
              <button
                style={{ flex: 1, background: 'none', border: 'none', color: 'inherit', fontSize: 11, textAlign: 'left', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                onClick={() => { loadCanvasPreset(p.id); onClose() }}
                title={`Saved ${new Date(p.savedAt).toLocaleString()}`}
              >{p.name}</button>
              <button
                style={{ flex: '0 0 auto', background: 'none', border: 'none', color: 'rgba(255,80,80,0.7)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}
                onClick={() => deleteCanvasPreset(p.id)}
                title="Delete preset"
              >✕</button>
            </div>
          ))}
        </>
      )}
      {sorted.length === 0 && (
        <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
          No saved presets yet
        </div>
      )}
    </div>,
    document.body
  )
}

export default PresetsMenu
