import React, { useEffect } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './HelpOverlay.css'

const SHORTCUTS: Array<{ section: string; items: Array<[string, string]> }> = [
  {
    section: 'Annotations',
    items: [
      ['Toggle annotate mode', 'A'],
      ['Pen / freehand', '1'],
      ['Arrow (click port→port)', '2'],
      ['Rectangle', '3'],
      ['Highlight', '4'],
      ['Eraser (drag to sweep)', '5'],
      ['Toggle visibility', '👁 button in toolbar'],
      ['Send to back / front', '↓ button in toolbar'],
      ['Clear drawings', '🗑 button in toolbar'],
      ['Sticky note / Label', 'Right-click canvas']
    ]
  },
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
      ['Toggle minimap', 'Map chip']
    ]
  }
]

const GithubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23A11.51 11.51 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/>
  </svg>
)

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
            <div className="help-title">Deck</div>
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
          <div className="help-footer-links">
            <a
              className="help-link"
              href="https://github.com/lucifer-prashant/deck/issues"
              onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://github.com/lucifer-prashant/deck/issues') }}
              title="Feature requests &amp; bug reports"
            >
              <GithubIcon />
              <span>Issues / Feature requests</span>
            </a>
            <a
              className="help-link"
              href="mailto:prashantverma1357@gmail.com"
              onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('mailto:prashantverma1357@gmail.com') }}
              title="Contact"
            >
              <span>✉ prashantverma1357@gmail.com</span>
            </a>
          </div>
          <span className="help-footer-hint">Press <kbd>Esc</kbd> or click outside to close.</span>
        </div>
      </div>
    </div>
  )
}

export default HelpOverlay
