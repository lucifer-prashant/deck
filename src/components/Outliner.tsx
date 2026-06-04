import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import PanelContextMenu from './PanelContextMenu'
import './Outliner.css'

const TYPE_LABEL: Record<string, string> = {
  terminal: 'TERM',
  editor: 'EDIT',
  browser: 'WEB',
  note: 'NOTE',
  region: 'REGION'
}

const PANEL_TYPES: Panel['type'][] = ['terminal', 'editor', 'browser']

const HEALTH_COLOR: Record<string, string> = {
  alive: '#22c55e',
  loading: '#f59e0b',
  sleeping: '#6b7280',
  crashed: '#ef4444',
}

const Outliner: React.FC = () => {
  const {
    tabs,
    activeTabId,
    outlinerOpen,
    selectedPanelIds,
    selectPanel,
    switchTab,
    toggleOutliner,
    updatePanel,
    deletePanel
  } = useWorkspaceStore()
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsedTabs, setCollapsedTabs] = useState<Record<string, boolean>>({})
  const [ctxMenu, setCtxMenu] = useState<{ panel: Panel; x: number; y: number } | null>(null)
  // Type filter pills (multi-select).
  const [activeTypes, setActiveTypes] = useState<Set<Panel['type']>>(new Set())
  // Keyboard navigation focus.
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const bodyRef = useRef<HTMLDivElement>(null)

  const filteredByTab = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hasFilter = activeTypes.size > 0
    return tabs.map(tab => {
      const all = Object.values(tab.panels)
        .filter(p => {
          if (hasFilter && p.type !== 'region' && !activeTypes.has(p.type)) return false
          if (q && !p.title.toLowerCase().includes(q) && !p.type.includes(q)) return false
          return true
        })
      const regions = all.filter(p => p.type === 'region')
      const orphans = all.filter(p => p.type !== 'region' && !p.regionId)
      const byRegion: Record<string, Panel[]> = {}
      all.forEach(p => {
        if (p.regionId) {
          if (!byRegion[p.regionId]) byRegion[p.regionId] = []
          byRegion[p.regionId].push(p)
        }
      })
      return { tab, regions, orphans, byRegion, total: all.length }
    })
  }, [tabs, query, activeTypes])

  // Cross-tab starred panels
  const starred = useMemo(() => {
    const out: Array<{ tabId: string; tabTitle: string; panel: Panel }> = []
    tabs.forEach(t => {
      Object.values(t.panels).forEach(p => {
        if (p.starred) out.push({ tabId: t.id, tabTitle: t.title, panel: p })
      })
    })
    return out
  }, [tabs])

  // Build flat list of focusable rows for keyboard nav.
  const focusableRows = useMemo(() => {
    const rows: Array<{ tabId: string; panel: Panel }> = []
    // Starred rows first.
    starred.forEach(({ tabId, panel: p }) => rows.push({ tabId, panel: p }))
    // Then tab body rows.
    filteredByTab.forEach(({ tab, regions, orphans, byRegion }) => {
      const collapsed = collapsedTabs[tab.id] ?? (tab.id !== activeTabId)
      if (collapsed) return
      regions.forEach(r => {
        rows.push({ tabId: tab.id, panel: r })
        ;(byRegion[r.id] || []).forEach(c => rows.push({ tabId: tab.id, panel: c }))
      })
      orphans.forEach(p => rows.push({ tabId: tab.id, panel: p }))
    })
    return rows
  }, [starred, filteredByTab, collapsedTabs, activeTabId])

  const toggleType = (t: Panel['type']) => {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
    setFocusedIdx(-1)
  }

  const commitRename = (id: string) => {
    const next = draft.trim()
    if (next) updatePanel(id, { title: next })
    setRenamingId(null)
  }

  const jumpTo = useCallback((tabId: string, panel: Panel) => {
    if (tabId !== activeTabId) switchTab(tabId)
    requestAnimationFrame(() => {
      selectPanel(panel.id)
      // Use the same focus behavior as pressing F — proper zoom, padding, sidebar awareness.
      useWorkspaceStore.getState().enterFocusMode()
      executeWorkspaceCommand('focus-selected')
    })
  }, [activeTabId, switchTab, selectPanel])

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!outlinerOpen || renamingId) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx(i => Math.min(i + 1, focusableRows.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        e.preventDefault()
        const row = focusableRows[focusedIdx]
        if (row) jumpTo(row.tabId, row.panel)
      } else if (e.key === 'Escape') {
        setFocusedIdx(-1)
        setCtxMenu(null)
      }
    }
    // Capture phase so we get the event before the sidebar/canvas can consume it.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [outlinerOpen, renamingId, focusedIdx, focusableRows, jumpTo])

  // Scroll focused row into view.
  useEffect(() => {
    if (focusedIdx < 0 || !bodyRef.current) return
    const row = bodyRef.current.querySelectorAll('.outliner-row')[focusedIdx] as HTMLElement | null
    row?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx])

  // Pre-compute focus index for each panel.
  const focusIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    focusableRows.forEach((r, i) => map.set(r.panel.id, i))
    return map
  }, [focusableRows])

  if (!outlinerOpen) return null

  const renderRow = (tabId: string, p: Panel, idx: number, indent = 0) => {
    const isActiveTab = tabId === activeTabId
    const isSel = isActiveTab && selectedPanelIds.includes(p.id)
    const isFocused = idx === focusedIdx
    const lazyLoad = (p.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad
    const healthState = p.healthState || (lazyLoad ? 'sleeping' : 'alive')
    const healthColor = HEALTH_COLOR[healthState]
    return (
      <div
        key={`${tabId}:${p.id}`}
        ref={isFocused ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
        className={`outliner-row ${isSel ? 'selected' : ''} ${!isActiveTab ? 'foreign' : ''} ${isFocused ? 'focused' : ''}`}
        style={{ paddingLeft: 10 + indent * 14 }}
        draggable={isActiveTab}
        onDragStart={(e) => {
          if (!isActiveTab) return
          e.dataTransfer.setData('text/wts-panel', p.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => jumpTo(tabId, p)}
        onDoubleClick={() => {
          if (!isActiveTab) return
          setDraft(p.title)
          setRenamingId(p.id)
        }}
        onContextMenu={(e) => {
          if (!isActiveTab) return
          e.preventDefault()
          if (!selectedPanelIds.includes(p.id)) selectPanel(p.id)
          setCtxMenu({ panel: p, x: e.clientX, y: e.clientY })
        }}
        title={`${p.title} (${p.type})${!isActiveTab ? ' — other canvas' : ''}`}
      >
        <span className={`outliner-type t-${p.type}`}>{TYPE_LABEL[p.type] || p.type}</span>
        {p.color && <span className="outliner-color" style={{ background: p.color }} />}
        <span
          className={`outliner-health ${healthState === 'loading' ? 'pulse' : ''}`}
          style={{ background: healthColor }}
          title={`Health: ${healthState}`}
        />
        {renamingId === p.id ? (
          <input
            autoFocus
            className="outliner-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitRename(p.id)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename(p.id)
              else if (e.key === 'Escape') setRenamingId(null)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="outliner-title">{p.title}</span>
        )}
        {/* Star toggle */}
        <button
          className={`outliner-star-btn ${p.starred ? 'active' : ''}`}
          title={p.starred ? 'Unstar' : 'Star'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); updatePanel(p.id, { starred: !p.starred }, { skipHistory: true }) }}
        >{p.starred ? '★' : '☆'}</button>
        {p.locked && <span className="outliner-flag" title="Locked">🔒</span>}
        {p.minimized && <span className="outliner-flag" title="Minimized">▭</span>}
        {p.pinFront && <span className="outliner-flag" title="Pinned to front">📌</span>}
        {p.pinBack && <span className="outliner-flag" title="Pinned to back">📍</span>}
        {isActiveTab && (
          <button
            className="outliner-del"
            title="Delete panel"
            onClick={(e) => { e.stopPropagation(); deletePanel(p.id) }}
          >×</button>
        )}
      </div>
    )
  }

  return (
    <aside className="outliner">
      <div className="outliner-header">
        <span>Outline</span>
        <button className="outliner-close" onClick={toggleOutliner} title="Close">×</button>
      </div>
      <input
        className="outliner-search"
        placeholder="Filter panels..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="outliner-filters">
        {PANEL_TYPES.map(t => {
          const active = activeTypes.has(t)
          return (
            <button
              key={t}
              className={`outliner-pill ${active ? 'active' : ''}`}
              onClick={() => toggleType(t)}
              title={active ? `Hide ${TYPE_LABEL[t]}` : `Show ${TYPE_LABEL[t]}`}
            >{TYPE_LABEL[t]}</button>
          )
        })}
      </div>
      <div className="outliner-body" ref={bodyRef}>
        {starred.length > 0 && (
          <div className="outliner-tab-group starred">
            <div className="outliner-tab-header">
              <span className="outliner-caret">★</span>
              <span className="outliner-tab-name">Starred</span>
              <span className="outliner-tab-count">{starred.length}</span>
            </div>
            <div className="outliner-tab-body">
              {starred.map(({ tabId, tabTitle, panel: p }) => (
                <div
                  key={`star:${tabId}:${p.id}`}
                  className={`outliner-row ${tabId !== activeTabId ? 'foreign' : ''} ${focusedIdx === (focusIndexMap.get(p.id) ?? -1) ? 'focused' : ''}`}
                  style={{ paddingLeft: 10 }}
                  onClick={() => jumpTo(tabId, p)}
                  title={`${p.title} — ${tabTitle}`}
                >
                  <span className={`outliner-type t-${p.type}`}>{TYPE_LABEL[p.type] || p.type}</span>
                  {p.color && <span className="outliner-color" style={{ background: p.color }} />}
                  {(() => {
                    const ll = (p.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad
                    const hs = p.healthState || (ll ? 'sleeping' : 'alive')
                    const hc = HEALTH_COLOR[hs]
                    return (
                      <span
                        className={`outliner-health ${hs === 'loading' ? 'pulse' : ''}`}
                        style={{ background: hc }}
                        title={`Health: ${hs}`}
                      />
                    )
                  })()}
                  <span className="outliner-title">{p.title}</span>
                  <span className="outliner-foreign-tab">{tabTitle}</span>
                  {/* Star toggle */}
                  <button
                    className="outliner-star-btn active"
                    title="Unstar"
                    onClick={(e) => { e.stopPropagation(); updatePanel(p.id, { starred: false }, { skipHistory: true }) }}
                  >★</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {filteredByTab.every(t => t.total === 0) && (
          <div className="outliner-empty">No panels match</div>
        )}
        {filteredByTab.map(({ tab, regions, orphans, byRegion, total }) => {
          if (total === 0 && query) return null
          const collapsed = collapsedTabs[tab.id] ?? (tab.id !== activeTabId)
          const isActive = tab.id === activeTabId
          return (
            <div key={tab.id} className={`outliner-tab-group ${isActive ? 'active-tab' : ''}`}>
              <div
                className="outliner-tab-header"
                onClick={() => setCollapsedTabs(prev => ({ ...prev, [tab.id]: !collapsed }))}
              >
                <span className="outliner-caret">{collapsed ? '▸' : '▾'}</span>
                <span className="outliner-tab-name">{tab.title}</span>
                <span className="outliner-tab-count">{total}</span>
                {!isActive && (
                  <button
                    className="outliner-tab-switch"
                    title="Switch to this canvas"
                    onClick={(e) => { e.stopPropagation(); switchTab(tab.id) }}
                  >→</button>
                )}
              </div>
              {!collapsed && (
                <div className="outliner-tab-body">
                  {regions.map(region => (
                    <div key={region.id} className="outliner-group">
                      {renderRow(tab.id, region, focusIndexMap.get(region.id) ?? -1)}
                      {(byRegion[region.id] || []).map(child => renderRow(tab.id, child, focusIndexMap.get(child.id) ?? -1, 1))}
                    </div>
                  ))}
                  {orphans.length > 0 && regions.length > 0 && <div className="outliner-divider" />}
                  {orphans.map(p => renderRow(tab.id, p, focusIndexMap.get(p.id) ?? -1))}
                  {total === 0 && <div className="outliner-empty thin">(empty)</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="outliner-footer">
        {tabs.length} canvas{tabs.length === 1 ? '' : 'es'} · {selectedPanelIds.length} selected
      </div>
      {ctxMenu && (
        <PanelContextMenu
          panel={ctxMenu.panel}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onRename={() => { setDraft(ctxMenu.panel.title); setRenamingId(ctxMenu.panel.id) }}
        />
      )}
    </aside>
  )
}

export default Outliner
