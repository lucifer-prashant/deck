import React, { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import PresetsMenu from './PresetsMenu'
import BookmarksMenu from './BookmarksMenu'
import './StatusBar.css'

const StatusBar: React.FC = () => {
  const {
    panels,
    selectedPanelIds,
    viewport,
    statusBarVisible,
    toggleHelp,
    loadPreset,
    prefs,
    viewportBookmarks,
    saveViewportBookmark,
    loadViewportBookmark
  } = useWorkspaceStore()

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const [presetsMenu, setPresetsMenu] = useState<{ x: number; y: number } | null>(null)
  const [bookmarksMenu, setBookmarksMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const worldX = (e.clientX - viewport.x) / viewport.zoom
      const worldY = (e.clientY - viewport.y) / viewport.zoom
      setCursor({ x: worldX, y: worldY })
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [viewport.x, viewport.y, viewport.zoom])

  useEffect(() => {
    const handler = () => {
      // Open presets menu centered above the presets button, triggered by Ctrl+S with no linked preset.
      const btn = document.querySelector('.status-chip.presets-btn') as HTMLElement | null
      if (btn) {
        const r = btn.getBoundingClientRect()
        setPresetsMenu({ x: r.left, y: r.top })
      } else {
        setPresetsMenu({ x: 100, y: window.innerHeight - 28 })
      }
    }
    window.addEventListener('deck:open-presets-menu', handler)
    return () => window.removeEventListener('deck:open-presets-menu', handler)
  }, [])

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
        <button
          className="status-chip ghost presets-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setPresetsMenu({ x: r.left, y: r.top })
          }}
          title="Canvas presets — save and load your own layouts (Ctrl+S)"
        >⊕ presets</button>
        <span className="status-sep" />
        <span className="status-item summary">{summary}</span>
        <span className="status-sep" />
        <div className="status-bookmarks" title="Viewport Bookmarks (Alt+1-9 to jump, Ctrl+Alt+1-9 to set)">
          <button
            className="bookmarks-btn"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setBookmarksMenu({ x: r.left, y: r.top })
            }}
            title="Manage viewport bookmarks"
          >
            ⚙
          </button>
          <span className="bookmarks-label">Bookmarks:</span>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
            const isSet = !!(viewportBookmarks && viewportBookmarks[num])
            return (
              <button
                key={num}
                className={`bookmark-btn ${isSet ? 'is-set' : ''}`}
                onClick={() => {
                  if (isSet) {
                    loadViewportBookmark(num)
                  } else {
                    saveViewportBookmark(num)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  saveViewportBookmark(num)
                }}
                title={isSet 
                  ? `Jump to Bookmark ${num} (Alt+${num})\nRight-click to overwrite` 
                  : `Save current viewport to Bookmark ${num} (Ctrl+Alt+${num})`
                }
              >
                {num}
              </button>
            )
          })}
        </div>
      </div>
      <div className="status-right">
        <button className="status-chip ghost" onClick={() => executeWorkspaceCommand('fit-all')}>fit</button>
        <button
          className="status-chip ghost"
          onClick={() => useWorkspaceStore.getState().toggleStatusBar()}
          title="Hide status bar"
        >▾</button>
        <button className="status-chip ghost help" onClick={toggleHelp} title="Keyboard shortcuts (?)">?</button>
        <span className="status-sep" />
        {prefs.showCursorReadout && cursor && (
          <span className="status-item mono">
            {Math.round(cursor.x)}, {Math.round(cursor.y)}
          </span>
        )}
        <span className="status-item mono">{Math.round(viewport.zoom * 100)}%</span>
      </div>

      {presetsMenu && <PresetsMenu anchor={presetsMenu} onClose={() => setPresetsMenu(null)} />}
      {bookmarksMenu && <BookmarksMenu anchor={bookmarksMenu} onClose={() => setBookmarksMenu(null)} />}
    </div>
  )
}

export default StatusBar
