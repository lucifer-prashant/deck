import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, SidebarSection } from '../store/workspaceStore'
import { getActiveContextPanel, readPanelContext, resolvePanelRoots, explorerRootFor } from '../panelContext'
import ExplorerSection from './sidebar/ExplorerSection'
import GitSection from './sidebar/GitSection'
import TokensSection from './sidebar/TokensSection'
import './Sidebar.css'
import './PanelContextMenu.css'

const SECTIONS: Array<{ id: SidebarSection; label: string; icon: string }> = [
  { id: 'explorer', label: 'Explorer', icon: '📁' },
  { id: 'git', label: 'Git', icon: '⎇' },
  { id: 'tokens', label: 'Token Usage', icon: '◈' },
  { id: 'notes', label: 'Notes', icon: '✦' },
  { id: 'outline', label: 'Outline', icon: '☰' }
]

const Sidebar: React.FC = () => {
  const open = useWorkspaceStore(s => s.sidebarOpen)
  const section = useWorkspaceStore(s => s.sidebarSection)
  const toggleSidebar = useWorkspaceStore(s => s.toggleSidebar)
  const setSidebarSection = useWorkspaceStore(s => s.setSidebarSection)
  const sidebarPin = useWorkspaceStore(s => s.sidebarPin)
  const setSidebarPin = useWorkspaceStore(s => s.setSidebarPin)
  const hiddenSections = useWorkspaceStore(s => s.hiddenSidebarSections)
  const toggleSidebarSectionHidden = useWorkspaceStore(s => s.toggleSidebarSectionHidden)
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)
  const panels = useWorkspaceStore(s => s.panels)
  const lastFocusedPanelId = useWorkspaceStore(s => s.lastFocusedPanelId)
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)

  // Recompute active context whenever any context-relevant input changes.
  const activeCtx = useMemo(() => {
    const p = getActiveContextPanel()
    return p ? readPanelContext(p) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, lastFocusedPanelId, selectedPanelIds])

  // Resolve project/repo roots in main when the active panel changes.
  useEffect(() => {
    if (activeCtx) resolvePanelRoots(activeCtx.panelId)
  }, [activeCtx])

  // If active section gets hidden (e.g. via the header menu), jump to first visible.
  useEffect(() => {
    if (hiddenSections.includes(section)) {
      const ALL: SidebarSection[] = ['explorer', 'git', 'tokens', 'notes', 'outline']
      const next = ALL.find(x => !hiddenSections.includes(x))
      if (next) setSidebarSection(next)
    }
  }, [hiddenSections, section, setSidebarSection])

  if (!open) return null

  const explorerRoot = sidebarPin.explorer || explorerRootFor(activeCtx)
  const explorerPinned = !!sidebarPin.explorer
  const repoRoot = sidebarPin.git || activeCtx?.repoRoot
  const gitPinned = !!sidebarPin.git

  return (
    <div className="sidebar">
      <div
        className="sidebar-tabs"
        onContextMenu={(e) => {
          e.preventDefault()
          setHeaderMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {SECTIONS.filter(s => s.id === 'outline' || !hiddenSections.includes(s.id)).map(s => (
          <button
            key={s.id}
            className={`sidebar-tab ${section === s.id ? 'active' : ''}`}
            onClick={() => setSidebarSection(s.id)}
            title={s.label}
          >
            <span className="sidebar-tab-icon">{s.icon}</span>
            <span className="sidebar-tab-label">{s.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="sidebar-close" onClick={toggleSidebar} title="Close (Ctrl+Shift+B)">×</button>
      </div>

      <div className="sidebar-context">
        <ContextStrip ctx={activeCtx} />
      </div>

      <div className="sidebar-body">
        {section === 'explorer' && (
          <ExplorerSection
            rootPath={explorerRoot}
            pinned={explorerPinned}
            onTogglePin={() => setSidebarPin('explorer', explorerPinned ? undefined : (explorerRoot || undefined))}
          />
        )}
        {section === 'git' && (
          <GitSection
            repoRoot={repoRoot}
            pinned={gitPinned}
            onTogglePin={() => setSidebarPin('git', gitPinned ? undefined : (repoRoot || undefined))}
          />
        )}
        {section === 'tokens' && (
          <TokensSection activeProject={activeCtx?.projectPath} />
        )}
        {section === 'notes' && (
          <SectionStub title="Notes" body="saved + unsaved notes" hint="coming next" />
        )}
        {section === 'outline' && <OutlineEmbed />}
      </div>
      {headerMenu && (
        <SidebarHeaderMenu
          x={headerMenu.x}
          y={headerMenu.y}
          hidden={hiddenSections}
          onToggle={(s) => toggleSidebarSectionHidden(s)}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  )
}

const SidebarHeaderMenu: React.FC<{
  x: number
  y: number
  hidden: SidebarSection[]
  onToggle: (s: SidebarSection) => void
  onClose: () => void
}> = ({ x, y, hidden, onToggle, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
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
  const left = Math.max(6, Math.min(x, window.innerWidth - 220))
  const top = Math.max(6, Math.min(y, window.innerHeight - 220))
  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left, top, minWidth: 200 }} onContextMenu={(e) => e.preventDefault()}>
      <div style={{ padding: '6px 10px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.5 }}>Sections</div>
      {SECTIONS.map(s => {
        const locked = s.id === 'outline'
        const visible = locked || !hidden.includes(s.id)
        return (
          <button
            key={s.id}
            className="ctx-item"
            disabled={locked}
            onClick={() => !locked && onToggle(s.id)}
            title={locked ? 'Outline is always shown' : undefined}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>{visible ? '✓' : ''}</span>
              <span style={{ opacity: 0.7 }}>{s.icon}</span>
              <span>{s.label}</span>
            </span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

const ContextStrip: React.FC<{ ctx: ReturnType<typeof readPanelContext> | null }> = ({ ctx }) => {
  if (!ctx) return <div className="sidebar-ctx-empty">no active panel</div>
  const project = ctx.projectPath ? ctx.projectPath.split('/').pop() : null
  const main = ctx.folderPath || ctx.projectPath || ctx.cwd || ctx.filePath || '(no path)'
  return (
    <div className="sidebar-ctx">
      <span className="sidebar-ctx-type">{ctx.panelType}</span>
      {project && <span className="sidebar-ctx-project">{project}</span>}
      <span className="sidebar-ctx-path" title={main}>{main}</span>
    </div>
  )
}

const SectionStub: React.FC<{ title: string; body: string; hint?: string; pinned?: boolean; onTogglePin?: () => void }> = ({ title, body, hint, pinned, onTogglePin }) => (
  <div className="sidebar-section">
    <div className="sidebar-section-head">
      <span className="sidebar-section-title">{title}</span>
      {onTogglePin && (
        <button className={`sidebar-pin ${pinned ? 'on' : ''}`} onClick={onTogglePin} title={pinned ? 'Unpin (follow active panel)' : 'Pin to current'}>
          📌
        </button>
      )}
    </div>
    <div className="sidebar-section-body">
      <div style={{ opacity: 0.85 }}>{body}</div>
      {hint && <div className="stub-hint">{hint}</div>}
    </div>
  </div>
)

// Outline section — flat list of panels in the active tab.
const OutlineEmbed: React.FC = () => {
  const panels = useWorkspaceStore(s => s.panels)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const setViewport = useWorkspaceStore(s => s.setViewport)
  const items = Object.values(panels)
    .filter(p => p.type !== 'region')
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const focusPanel = (id: string) => {
    selectPanel(id)
    const p = panels[id]
    if (!p) return
    window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
    setViewport({
      zoom: 1,
      x: window.innerWidth / 2 - (p.x + p.width / 2),
      y: window.innerHeight / 2 - (p.y + p.height / 2)
    })
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-head">
        <span className="sidebar-section-title">Panels ({items.length})</span>
      </div>
      <div className="sidebar-section-body" style={{ padding: 0 }}>
        {items.length === 0 && <div style={{ padding: 12, opacity: 0.45 }}>no panels</div>}
        {items.map(p => (
          <div key={p.id} className="tree-row" onClick={() => focusPanel(p.id)} title={p.title}>
            <span className="tree-icon">{p.type === 'terminal' ? '▶' : p.type === 'editor' ? '✎' : p.type === 'browser' ? '◐' : '✦'}</span>
            <span className="tree-name">{p.title}</span>
            {p.starred && <span style={{ opacity: 0.7 }}>★</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Sidebar
