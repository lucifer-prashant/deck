import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import './PanelContextMenu.css'

interface Props {
  anchor: { x: number; y: number }
  onClose: () => void
}

const BookmarksMenu: React.FC<Props> = ({ anchor, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  const { viewportBookmarks, saveViewportBookmark, loadViewportBookmark, deleteViewportBookmark } = useWorkspaceStore()

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

  const setBookmarks = Object.keys(viewportBookmarks || {})
    .map(Number)
    .sort((a, b) => a - b)

  const left = Math.max(6, Math.min(anchor.x, window.innerWidth - 260))
  const top = Math.max(6, anchor.y - Math.min(300, 100 + setBookmarks.length * 32))

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top, minWidth: 240 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-section">Quick Save Current Viewport</div>
      <div style={{ padding: '6px 12px 10px', display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 4 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
          const isSet = !!(viewportBookmarks && viewportBookmarks[num])
          return (
            <button
              key={num}
              onClick={() => {
                saveViewportBookmark(num)
              }}
              style={{
                background: isSet ? 'rgba(0,120,212,0.6)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                color: '#fff',
                fontSize: 10,
                padding: '4px 0',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'center',
                fontWeight: isSet ? 'bold' : 'normal'
              }}
              title={isSet ? `Overwrite Bookmark ${num}` : `Save to Bookmark ${num}`}
            >
              {num}
            </button>
          )
        })}
      </div>

      <div className="ctx-sep" />
      <div className="ctx-section">Saved Bookmarks</div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {setBookmarks.length > 0 ? (
          setBookmarks.map(num => {
            const vp = viewportBookmarks[num]
            const coordsStr = `X: ${Math.round(vp.x)}, Y: ${Math.round(vp.y)} (${Math.round(vp.zoom * 100)}%)`
            return (
              <div
                key={num}
                className="ctx-item"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
              >
                <button
                  style={{ flex: 1, background: 'none', border: 'none', color: 'inherit', fontSize: 11, textAlign: 'left', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                  onClick={() => { loadViewportBookmark(num); onClose() }}
                  title={`Jump to Bookmark ${num}\n${coordsStr}`}
                >
                  <span style={{ fontWeight: 'bold', marginRight: 8 }}>#{num}</span>
                  <span style={{ opacity: 0.6, fontSize: 10 }}>{coordsStr}</span>
                </button>
                <button
                  style={{ flex: '0 0 auto', background: 'none', border: 'none', color: 'rgba(255,80,80,0.7)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}
                  onClick={() => deleteViewportBookmark(num)}
                  title={`Clear Bookmark ${num}`}
                >
                  ✕
                </button>
              </div>
            )
          })
        ) : (
          <div style={{ padding: '6px 12px 10px', fontSize: 10, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
            No bookmarks saved yet
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default BookmarksMenu
