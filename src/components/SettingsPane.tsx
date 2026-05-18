import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, Theme } from '../store/workspaceStore'
import './GlobalSearch.css'

type Section = 'appearance' | 'canvas' | 'shortcuts' | 'about'

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' }
]

const SettingsPane: React.FC = () => {
  const open = useWorkspaceStore(s => s.settingsOpen)
  const close = useWorkspaceStore(s => s.toggleSettings)
  const prefs = useWorkspaceStore(s => s.prefs)
  const updatePrefs = useWorkspaceStore(s => s.updatePrefs)
  const theme = useWorkspaceStore(s => s.theme)
  const setTheme = useWorkspaceStore(s => s.setTheme)
  const [active, setActive] = useState<Section>('appearance')
  const [version, setVersion] = useState('')

  // Esc closes — only attach while open.
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [open, close])

  // Fetch version once on first open.
  useEffect(() => {
    if (!open || version) return
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion('dev'))
  }, [open, version])

  // Apply font-size live to document root (single source — no double writes).
  useEffect(() => {
    document.documentElement.style.fontSize = `${prefs.fontSize}px`
  }, [prefs.fontSize])

  if (!open) return null

  return createPortal(
    <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="gs-panel settings-panel" style={{ width: 'min(760px, calc(100vw - 64px))', maxHeight: 'calc(100vh - 120px)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="gs-head">
          <span className="gs-icon">⚙</span>
          <span style={{ flex: 1, fontWeight: 600 }}>Preferences</span>
          <button className="gs-close" onClick={close}>×</button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{
            width: 160, borderRight: '1px solid rgba(255,255,255,0.06)',
            padding: '8px 0', flexShrink: 0
          }}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 14px', border: 'none',
                  background: active === s.id ? 'rgba(77,171,232,0.12)' : 'transparent',
                  color: active === s.id ? '#9ed1ff' : 'rgba(255,255,255,0.75)',
                  fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit'
                }}
              >{s.label}</button>
            ))}
          </div>
          <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
            {active === 'appearance' && (
              <div>
                <Field label="Theme">
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as Theme)}
                    style={inputStyle}
                  >
                    <option value="dark">Dark</option>
                    <option value="midnight">Midnight</option>
                    <option value="light">Light</option>
                    <option value="system">System (follow OS)</option>
                  </select>
                </Field>
                <Field label="UI font size">
                  <input
                    type="range" min={11} max={16} step={0.5}
                    value={prefs.fontSize}
                    onChange={(e) => updatePrefs({ fontSize: parseFloat(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 32, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{prefs.fontSize}px</span>
                </Field>
                <Field label="Density">
                  <select
                    value={prefs.density}
                    onChange={(e) => updatePrefs({ density: e.target.value as 'compact' | 'cozy' | 'comfortable' })}
                    style={inputStyle}
                  >
                    <option value="compact">Compact</option>
                    <option value="cozy">Cozy (default)</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </Field>
                <Field label="Animations">
                  <Toggle on={prefs.animations} onChange={(v) => updatePrefs({ animations: v })} />
                </Field>
              </div>
            )}
            {active === 'canvas' && (
              <div>
                <Field label="Snap grid step">
                  <input
                    type="number" min={4} max={100} step={4}
                    value={prefs.snapStep}
                    onChange={(e) => updatePrefs({ snapStep: parseInt(e.target.value, 10) || 20 })}
                    style={{ ...inputStyle, width: 100 }}
                  />
                  <span style={{ opacity: 0.5, fontSize: 11 }}>world px</span>
                </Field>
                <Field label="Show cursor coords in status bar">
                  <Toggle on={prefs.showCursorReadout} onChange={(v) => updatePrefs({ showCursorReadout: v })} />
                </Field>
                <div style={{ marginTop: 14, padding: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 6, fontSize: 11.5, opacity: 0.7, lineHeight: 1.5 }}>
                  Drag-snap, alignment guides, panel drag/resize behavior are all live — these only configure presentation.
                </div>
              </div>
            )}
            {active === 'shortcuts' && (
              <div style={{ fontSize: 12 }}>
                <p style={{ opacity: 0.6, marginTop: 0 }}>Keyboard reference — see ? overlay for full list.</p>
                <ShortcutRow keys="Ctrl+P" label="Command palette" />
                <ShortcutRow keys="Ctrl+F" label="Find panel" />
                <ShortcutRow keys="Ctrl+B" label="Outliner" />
                <ShortcutRow keys="Ctrl+Shift+B" label="Sidebar (explorer/git/tokens)" />
                <ShortcutRow keys="Ctrl+G" label="Group selected → region" />
                <ShortcutRow keys="Ctrl+Shift+G" label="Ungroup region" />
                <ShortcutRow keys="Ctrl+,]" label="Open settings" />
                <ShortcutRow keys="Tab" label="Jump mode" />
                <ShortcutRow keys="F" label="Focus selected" />
                <ShortcutRow keys="Ctrl+Z / Ctrl+Y" label="Undo / Redo" />
                <ShortcutRow keys="Ctrl+\\" label="Toggle chrome + status bar" />
                <ShortcutRow keys="Ctrl+Shift+T" label="Cycle theme" />
              </div>
            )}
            {active === 'about' && (
              <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Worktree Studio</div>
                <div style={{ opacity: 0.6 }}>version {version || '…'}</div>
                <div style={{ marginTop: 14, opacity: 0.7 }}>
                  Spatial infinite-canvas workspace for terminals, editors, browsers, and notes.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

const inputStyle: React.CSSProperties = {
  background: '#1a1c20',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#e6e8ec',
  padding: '5px 10px',
  borderRadius: 5,
  fontSize: 12,
  fontFamily: 'inherit',
  appearance: 'none',
  WebkitAppearance: 'none',
  cursor: 'pointer',
  minWidth: 180
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
    <div style={{ width: 180, fontSize: 12.5 }}>{label}</div>
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
  </div>
)

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <button
    onClick={() => onChange(!on)}
    style={{
      width: 36, height: 20, border: 'none', cursor: 'pointer',
      borderRadius: 999, padding: 2,
      background: on ? '#4dabe8' : 'rgba(255,255,255,0.18)',
      transition: 'background 120ms',
      position: 'relative'
    }}
  >
    <span style={{
      position: 'absolute', top: 2,
      left: on ? 18 : 2,
      width: 16, height: 16, borderRadius: '50%',
      background: '#fff',
      transition: 'left 120ms cubic-bezier(0.4, 0.0, 0.2, 1)'
    }} />
  </button>
)

const ShortcutRow: React.FC<{ keys: string; label: string }> = ({ keys, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 12 }}>
    <span style={{ minWidth: 160, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, opacity: 0.85 }}>{keys}</span>
    <span style={{ opacity: 0.7 }}>{label}</span>
  </div>
)

export default SettingsPane
