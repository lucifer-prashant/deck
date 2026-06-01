import React from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './EmptyState.css'

const TIPS = [
  ['Tab', 'jump mode — letter overlay on every panel'],
  ['F', 'fly viewport to selected'],
  ['Ctrl+G', 'group selected into a region'],
  ['Ctrl+B', 'sidebar — explorer · git · tokens · notes'],
  ['Ctrl+,', 'preferences'],
  ['Ctrl+P', 'command palette'],
  ['↑↓←→', 'spatial nearest-panel navigation']
]

const EmptyState: React.FC = () => {
  const tabs = useWorkspaceStore(s => s.tabs)
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const switchTab = useWorkspaceStore(s => s.switchTab)
  const loadPreset = useWorkspaceStore(s => s.loadPreset)

  // Recent canvases: tabs other than current, sorted by lastEditedAt desc, limit 4.
  const recent = tabs
    .filter(t => t.id !== activeTabId && Object.keys(t.panels || {}).length > 0)
    .sort((a, b) => (b.lastEditedAt || 0) - (a.lastEditedAt || 0))
    .slice(0, 4)

  return (
    <div className="empty-state">
      <div className="empty-card welcome">
        <div className="welcome-head">
          <div className="empty-glyph">▢</div>
          <div>
            <div className="empty-title">Worktree Studio</div>
            <div className="empty-sub">Spatial workspace — terminals, editors, browsers, notes on an infinite canvas.</div>
          </div>
        </div>

        <div className="welcome-section">
          <div className="welcome-section-title">Start</div>
          <div className="empty-actions">
            <button className="quick-btn" onClick={() => executeWorkspaceCommand('new-terminal')}>
              <span className="empty-key">T</span><span>Terminal</span>
            </button>
            <button className="quick-btn" onClick={() => executeWorkspaceCommand('new-editor')}>
              <span className="empty-key">E</span><span>Editor</span>
            </button>
            <button className="quick-btn" onClick={() => executeWorkspaceCommand('new-browser')}>
              <span className="empty-key">B</span><span>Browser</span>
            </button>
          </div>
        </div>

        <div className="welcome-section">
          <div className="welcome-section-title">Presets</div>
          <div className="empty-actions">
            <button className="quick-btn preset-life" onClick={() => loadPreset('life')}>
              <span>✦</span><span>life</span>
              <span className="quick-sub">YT · Spotify · IG · WA · TG</span>
            </button>
            <button className="quick-btn preset-no-life" onClick={() => loadPreset('no-life')}>
              <span>⚒</span><span>no-life</span>
              <span className="quick-sub">Gmail · LinkedIn · GitHub · Reddit · code · term</span>
            </button>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="welcome-section">
            <div className="welcome-section-title">Recent canvases</div>
            <div className="welcome-recent">
              {recent.map(t => (
                <button key={t.id} className="recent-row" onClick={() => switchTab(t.id)} title={t.title}>
                  <span className="recent-name">{t.title}</span>
                  <span className="recent-meta">{Object.keys(t.panels).length} panels</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="welcome-section">
          <div className="welcome-section-title">Tips</div>
          <div className="welcome-tips">
            {TIPS.map(([k, label]) => (
              <div className="tip-row" key={k}>
                <kbd>{k}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="empty-hint">
          drag empty canvas to pan · ctrl+scroll to zoom · right-click for menu
        </div>
      </div>
    </div>
  )
}

export default EmptyState
