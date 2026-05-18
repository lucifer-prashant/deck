import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, Theme } from '../store/workspaceStore'
import './PanelContextMenu.css'

const THEMES: Array<{ id: Theme; label: string; hint: string }> = [
  { id: 'dark', label: 'Dark', hint: 'default' },
  { id: 'midnight', label: 'Midnight', hint: 'deep blue' },
  { id: 'light', label: 'Light', hint: 'bright' },
  { id: 'system', label: 'System', hint: 'follow OS' }
]

interface Props {
  anchor: { x: number; y: number }
  onClose: () => void
}

const ThemeMenu: React.FC<Props> = ({ anchor, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useWorkspaceStore(s => s.theme)
  const setTheme = useWorkspaceStore(s => s.setTheme)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', h, true)
    window.addEventListener('contextmenu', h, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', h, true)
      window.removeEventListener('contextmenu', h, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const left = Math.max(6, Math.min(anchor.x, window.innerWidth - 230))
  const top = Math.max(6, Math.min(anchor.y, window.innerHeight - 200))

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left, top, minWidth: 210 }} onContextMenu={(e) => e.preventDefault()}>
      <div style={{ padding: '6px 10px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.5 }}>Theme</div>
      {THEMES.map(t => (
        <button
          key={t.id}
          className="ctx-item"
          onClick={() => { setTheme(t.id); onClose() }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>{theme === t.id ? '✓' : ''}</span>
            <span>{t.label}</span>
          </span>
          <span className="ctx-kbd">{t.hint}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

export default ThemeMenu
