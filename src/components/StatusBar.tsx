import React, { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import ThemeMenu from './ThemeMenu'
import './StatusBar.css'

const StatusBar: React.FC = () => {
  const {
    panels,
    selectedPanelIds,
    viewport,
    snapToGrid,
    theme,
    statusBarVisible,
    toggleSnapToGrid,
    toggleHelp,
    loadPreset
  } = useWorkspaceStore()

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const worldX = (e.clientX - viewport.x) / viewport.zoom
      const worldY = (e.clientY - viewport.y) / viewport.zoom
      setCursor({ x: worldX, y: worldY })
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [viewport.x, viewport.y, viewport.zoom])

  if (!statusBarVisible) return null

  // Count only real panels, not regions.
  const count = Object.values(panels).filter(p => p.type !== 'region').length
  const selCount = selectedPanelIds.length
  const selected = selectedPanelIds.map(id => panels[id]).filter(Boolean)
  const summary = selected.length === 1
    ? `${selected[0].title} · ${Math.round(selected[0].width)}×${Math.round(selected[0].height)} @ (${Math.round(selected[0].x)}, ${Math.round(selected[0].y)})`
    : selCount > 1
      ? `${selCount} panels selected`
      : `${count} panel${count === 1 ? '' : 's'} on canvas`

  return (
    <div className="status-bar">
      <div className="status-left">
        <button
          className="status-chip preset life"
          onClick={() => loadPreset('life')}
          title="Open Life preset (YouTube · Spotify · IG · WA · TG) — Ctrl+Shift+L"
        >✦ life</button>
        <button
          className="status-chip preset no-life"
          onClick={() => loadPreset('no-life')}
          title="Open No-Life preset (Gmail · LinkedIn · GitHub · Reddit · VSCode · Terminal) — Ctrl+Shift+K"
        >⚒ no-life</button>
        <span className="status-sep" />
        <span className="status-item summary">{summary}</span>
      </div>
      <div className="status-right">
        <button className="status-chip ghost" onClick={() => executeWorkspaceCommand('fit-all')}>fit</button>
        <button className={`status-chip toggle ${snapToGrid ? 'on' : ''}`} onClick={toggleSnapToGrid} title="Snap to grid">
          snap
        </button>
        <button
          className="status-chip ghost"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setThemeMenu({ x: r.left, y: r.top - 200 })
          }}
          title="Theme — click to choose"
        >{theme}</button>
        <button
          className="status-chip ghost"
          onClick={() => useWorkspaceStore.getState().toggleStatusBar()}
          title="Hide status bar"
        >▾</button>
        <button className="status-chip ghost help" onClick={toggleHelp} title="Keyboard shortcuts (?)">?</button>
        <span className="status-sep" />
        {cursor && (
          <span className="status-item mono">
            {Math.round(cursor.x)}, {Math.round(cursor.y)}
          </span>
        )}
        <span className="status-item mono">{Math.round(viewport.zoom * 100)}%</span>
      </div>
      {themeMenu && <ThemeMenu anchor={themeMenu} onClose={() => setThemeMenu(null)} />}
    </div>
  )
}

export default StatusBar
