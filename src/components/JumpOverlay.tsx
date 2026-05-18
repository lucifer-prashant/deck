import React from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'

const JumpOverlay: React.FC = () => {
  const { jumpMode, panels, viewport } = useWorkspaceStore()

  // Recompute screen positions every render so they track viewport changes during fly-in.
  if (!jumpMode.active) return null

  const entries = Object.entries(jumpMode.letters)
  if (entries.length === 0) return null

  return (
    <>
      <div className="jump-overlay" />
      <div className="jump-banner">JUMP MODE — press letter · Esc to cancel</div>
      {entries.map(([letter, panelId]) => {
        const p = panels[panelId]
        if (!p) return null
        const cx = p.x + p.width / 2
        const cy = p.y + p.height / 2
        const sx = cx * viewport.zoom + viewport.x
        const sy = cy * viewport.zoom + viewport.y
        return (
          <div
            key={letter}
            className="jump-letter"
            style={{ left: sx, top: sy }}
          >
            {letter}
          </div>
        )
      })}
    </>
  )
}

export default JumpOverlay
