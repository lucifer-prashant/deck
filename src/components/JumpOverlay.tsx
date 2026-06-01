import React from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'

const JumpOverlay: React.FC = () => {
  const jumpMode = useWorkspaceStore(s => s.jumpMode)
  const panels = useWorkspaceStore(s => s.panels)
  const viewport = useWorkspaceStore(s => s.viewport)
  const annotations = useWorkspaceStore(s =>
    s.tabs.find(t => t.id === s.activeTabId)?.annotations || []
  )

  if (!jumpMode.active) return null

  const entries = Object.entries(jumpMode.letters)
  if (entries.length === 0) return null

  return (
    <>
      <div className="jump-overlay" />
      <div className="jump-banner">JUMP MODE — press letter · Esc to cancel</div>
      {entries.map(([letter, id]) => {
        const p = panels[id]
        if (p) {
          const cx = p.x + p.width / 2
          const cy = p.y + p.height / 2
          return (
            <div key={letter} className="jump-letter" style={{
              left: cx * viewport.zoom + viewport.x,
              top: cy * viewport.zoom + viewport.y,
            }}>{letter}</div>
          )
        }
        const a = annotations.find(aa => aa.id === id)
        if (a) {
          const cx = a.x + (a.width || 100) / 2
          const cy = a.y + (a.height || 24) / 2
          return (
            <div key={letter} className="jump-letter" style={{
              left: cx * viewport.zoom + viewport.x,
              top: cy * viewport.zoom + viewport.y,
            }}>{letter}</div>
          )
        }
        return null
      })}
    </>
  )
}

export default JumpOverlay
