import React, { useEffect } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './HelpOverlay.css'

const SHORTCUTS: Array<{ section: string; items: Array<[string, string]> }> = [
  {
    section: 'Canvas',
    items: [
      ['Pan', 'Scroll · drag empty · middle-click drag'],
      ['Zoom', 'Ctrl+Scroll · Pinch · Ctrl+= / Ctrl+-'],
      ['Reset zoom', 'Ctrl+0'],
      ['Fit all', 'Fit chip · command palette'],
      ['Selection box', 'Shift+drag empty space']
    ]
  },
  {
    section: 'Panels',
    items: [
      ['Create', 'Command palette → New …'],
      ['Rename', 'F2 · Double-click title · ✎ button'],
      ['Move', 'Drag header · Ctrl+arrows'],
      ['Resize', 'Drag edges/corners · Alt+arrows · Alt+Shift+arrows shrink'],
      ['Duplicate', 'Ctrl+D'],
      ['Delete', 'Del / Backspace'],
      ['Lock / Minimize', 'Header buttons · context menu'],
      ['Context menu', 'Right-click panel'],
      ['Group / Ungroup', 'Ctrl+G / Ctrl+Shift+G']
    ]
  },
  {
    section: 'Selection / Navigation',
    items: [
      ['Select all', 'Ctrl+A'],
      ['Add to selection', 'Shift / Ctrl + click'],
      ['Clear', 'Esc'],
      ['Find panel', 'Ctrl+F'],
      ['Move selection', '↑ ↓ ← → (single panel)'],
      ['First / last panel', 'Home / End'],
      ['Jump mode (letters)', 'Tab'],
      ['Focus selected', 'F'],
      ['Toggle minimap', 'M'],
      ['Switch canvas', '1 – 9']
    ]
  },
  {
    section: 'Workspace',
    items: [
      ['Command palette', 'Ctrl+P'],
      ['Sidebar (Explorer/Git/Tokens)', 'Ctrl+Shift+B'],
      ['New Browser panel', 'Ctrl+B'],
      ['Help (this)', '?  /  F1'],
      ['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'],
      ['Mark canvas saved', 'Ctrl+Alt+S'],
      ['Toggle top bar', 'Ctrl+\\'],
      ['Cycle theme', 'Ctrl+Shift+T'],
      ['Toggle minimap', 'Map chip'],
      ['Toggle snap', 'Snap chip']
    ]
  }
]

const HelpOverlay: React.FC = () => {
  const { helpOpen, toggleHelp } = useWorkspaceStore()

  useEffect(() => {
    if (!helpOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleHelp()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [helpOpen, toggleHelp])

  if (!helpOpen) return null

  return (
    <div className="help-overlay" onClick={toggleHelp}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <div>
            <div className="help-title">Worktree Studio</div>
            <div className="help-sub">keyboard reference</div>
          </div>
          <button className="help-close" onClick={toggleHelp}>×</button>
        </div>
        <div className="help-grid">
          {SHORTCUTS.map(group => (
            <section key={group.section} className="help-section">
              <h4>{group.section}</h4>
              <dl>
                {group.items.map(([label, keys]) => (
                  <React.Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{keys.split(' · ').map((k, i, arr) => (
                      <React.Fragment key={i}>
                        <kbd>{k}</kbd>
                        {i < arr.length - 1 && <span className="help-or">·</span>}
                      </React.Fragment>
                    ))}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="help-footer">
          Press <kbd>Esc</kbd> or click outside to close.
        </div>
      </div>
    </div>
  )
}

export default HelpOverlay
