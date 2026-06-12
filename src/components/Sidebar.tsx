import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore, SidebarSection, type Panel } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import { getActiveContextPanel, readPanelContext, resolvePanelRoots, explorerRootFor } from '../panelContext'
import ExplorerSection from './sidebar/ExplorerSection'
import GitSection from './sidebar/GitSection'
import './Sidebar.css'
import './PanelContextMenu.css'

const SECTIONS: Array<{ id: SidebarSection; label: string; icon: string }> = [
  { id: 'explorer', label: 'Explorer', icon: '📁' },
  { id: 'git', label: 'Git', icon: '⎇' },

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
  const activePanelContextKey = useWorkspaceStore(s => {
    const p = s.lastFocusedPanelId ? s.panels[s.lastFocusedPanelId] : null
    if (!p) return null
    return `${p.id}-${p.type}-${(p.settings as any)?.filePath || ''}-${(p.settings as any)?.folderPath || ''}-${(p.settings as any)?.cwd || ''}`
  })
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)
  const sidebarWidth = useWorkspaceStore(s => s.sidebarWidth)
  const setSidebarWidth = useWorkspaceStore(s => s.setSidebarWidth)

  const activeCtx = useMemo(() => {
    const p = getActiveContextPanel()
    return p ? readPanelContext(p) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanelContextKey, selectedPanelIds])

  // Resolve project/repo roots in main when the active panel changes.
  useEffect(() => {
    if (activeCtx) resolvePanelRoots(activeCtx.panelId)
  }, [activeCtx])

  // If active section gets hidden (e.g. via the header menu), jump to first visible.
  useEffect(() => {
    if (hiddenSections.includes(section)) {
      const ALL: SidebarSection[] = ['explorer', 'git', 'outline']
      const next = ALL.find(x => !hiddenSections.includes(x))
      if (next) setSidebarSection(next)
    }
  }, [hiddenSections, section, setSidebarSection])

  if (!open) return null

  const explorerRoot = sidebarPin.explorer || explorerRootFor(activeCtx)
  const explorerPinned = !!sidebarPin.explorer
  const repoRoot = sidebarPin.git || activeCtx?.repoRoot
  const gitPinned = !!sidebarPin.git



  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMouseMove = (moveEvent: MouseEvent) => {
      const hasMargin = document.querySelector('.app.has-chrome, .app.has-statusbar') !== null
      const offset = hasMargin ? 10 : 0
      const nextWidth = Math.max(200, Math.min(800, moveEvent.clientX - offset))
      setSidebarWidth(nextWidth)
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-resizer" onMouseDown={handleResizerMouseDown} />
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

// Outline section — flat list of panels in the active tab.
const PANEL_TYPES: Panel['type'][] = ['terminal', 'editor', 'browser']
const TYPE_LABEL: Record<string, string> = { terminal: 'TERM', editor: 'EDIT', browser: 'WEB' }
const HEALTH_COLOR: Record<string, string> = {
  alive: '#22c55e', loading: '#f59e0b', sleeping: '#6b7280', crashed: '#ef4444',
}

const OutlineEmbed: React.FC = () => {
  const panels = useWorkspaceStore(s => s.panels)
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const tabs = useWorkspaceStore(s => s.tabs)
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const switchTab = useWorkspaceStore(s => s.switchTab)
  const [query, setQuery] = useState('')
  const [activeTypes, setActiveTypes] = useState<Set<Panel['type']>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const bodyRef = useRef<HTMLDivElement>(null)

  const toggleType = (t: Panel['type']) => {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
    setFocusedIdx(-1)
  }

  const items = useMemo(() => {
    const hasFilter = activeTypes.size > 0
    const q = query.trim().toLowerCase()
    return Object.values(panels)
      .filter(p => p.type !== 'region')
      .filter(p => {
        if (hasFilter && !activeTypes.has(p.type)) return false
        if (q && !p.title.toLowerCase().includes(q) && !p.type.includes(q)) return false
        return true
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
  }, [panels, query, activeTypes])

  const focusPanel = useCallback((id: string) => {
    const p = panels[id]
    if (!p) return
    const tab = tabs.find(t => t.panels[id])
    if (tab && tab.id !== activeTabId) switchTab(tab.id)
    requestAnimationFrame(() => {
      selectPanel(id)
      useWorkspaceStore.getState().enterFocusMode()
      executeWorkspaceCommand('focus-selected')
    })
  }, [panels, tabs, activeTabId, switchTab, selectPanel])

  // Keyboard navigation — no focus guard needed, fires whenever sidebar is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx(i => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        e.preventDefault()
        focusPanel(items[focusedIdx].id)
      } else if (e.key === 'Escape') {
        setFocusedIdx(-1)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [focusedIdx, items, focusPanel])

  // Scroll focused row into view.
  useEffect(() => {
    if (focusedIdx < 0 || !bodyRef.current) return
    const row = bodyRef.current.querySelectorAll('.outline-row')[focusedIdx] as HTMLElement | null
    row?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx])

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-head">
        <span className="sidebar-section-title">Panels ({items.length})</span>
      </div>
      {/* Search */}
      <input
        className="sidebar-search"
        placeholder="Filter panels…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 10px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, color: '#e6e8ec', fontSize: 12, outline: 'none',
          margin: '6px 0 4px', fontFamily: 'inherit'
        }}
      />
      {/* Type filter pills */}
      <div style={{ display: 'flex', gap: 4, padding: '2px 0 6px' }}>
        {PANEL_TYPES.map(t => {
          const active = activeTypes.has(t)
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              style={{
                padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em',
                border: active ? '1px solid rgba(77,171,232,0.35)' : '1px solid rgba(255,255,255,0.1)',
                background: active ? 'rgba(77,171,232,0.18)' : 'rgba(255,255,255,0.04)',
                color: active ? '#4dabe8' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer', transition: 'all 0.1s ease'
              }}
            >{TYPE_LABEL[t]}</button>
          )
        })}
      </div>
      <div className="sidebar-section-body" ref={bodyRef} style={{ padding: 0 }}>
        {items.length === 0 && <div style={{ padding: 12, opacity: 0.45 }}>no panels match</div>}
        {items.map((p, i) => {
          const isSel = selectedPanelIds.includes(p.id)
          const isFocused = i === focusedIdx
          // Derive health state: lazyLoad means sleeping, explicit healthState overrides.
          const lazyLoad = (p.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad
          const healthState = p.healthState || (lazyLoad ? 'sleeping' : 'alive')
          const healthColor = HEALTH_COLOR[healthState]
          return (
            <div
              key={p.id}
              className={`outline-row${isSel ? ' selected' : ''}${isFocused ? ' focused' : ''}`}
              onClick={() => focusPanel(p.id)}
              title={p.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                borderRadius: 4, cursor: 'pointer', fontSize: 12,
                background: isFocused ? 'rgba(77,171,232,0.1)' : isSel ? 'rgba(0,120,212,0.2)' : 'transparent',
                transition: 'background 0.1s ease',
                boxShadow: isFocused ? '0 0 0 1px rgba(77,171,232,0.25) inset' : 'none'
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                padding: '1px 5px', borderRadius: 3,
                background: p.type === 'terminal' ? 'rgba(45,138,78,0.25)' : p.type === 'editor' ? 'rgba(0,120,212,0.25)' : 'rgba(108,45,130,0.3)',
                color: p.type === 'terminal' ? '#6ee7a3' : p.type === 'editor' ? '#6abef8' : '#d5a3e8'
              }}>{TYPE_LABEL[p.type]}</span>
              {/* Health dot */}
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%', background: healthColor, flexShrink: 0,
                  animation: healthState === 'loading' ? 'outline-pulse 1.5s ease-in-out infinite' : 'none'
                }}
                title={`Health: ${healthState}`}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              {/* Star toggle */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  useWorkspaceStore.getState().updatePanel(p.id, { starred: !p.starred }, { skipHistory: true })
                }}
                style={{
                  background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer',
                  fontSize: 13, color: p.starred ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                  transition: 'all 0.1s ease', lineHeight: 1
                }}
                title={p.starred ? 'Unstar' : 'Star'}
              >{p.starred ? '★' : '☆'}</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Sidebar
