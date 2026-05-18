import React, { useMemo, useState } from 'react'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import PanelContextMenu from './PanelContextMenu'
import './Outliner.css'

const TYPE_LABEL: Record<string, string> = {
  terminal: 'TERM',
  editor: 'EDIT',
  browser: 'WEB',
  note: 'NOTE',
  region: 'REGION'
}

const Outliner: React.FC = () => {
  const {
    tabs,
    activeTabId,
    outlinerOpen,
    selectedPanelIds,
    selectPanel,
    setViewport,
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

  const filteredByTab = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabs.map(tab => {
      const all = Object.values(tab.panels)
        .filter(p => !q || p.title.toLowerCase().includes(q) || p.type.includes(q))
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
  }, [tabs, query])

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

  const jumpTo = (tabId: string, panel: Panel) => {
    if (tabId !== activeTabId) switchTab(tabId)
    requestAnimationFrame(() => {
      selectPanel(panel.id)
      window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
      setViewport({
        zoom: 1,
        x: window.innerWidth / 2 - (panel.x + panel.width / 2),
        y: window.innerHeight / 2 - (panel.y + panel.height / 2)
      })
    })
  }

  const commitRename = (id: string) => {
    const next = draft.trim()
    if (next) updatePanel(id, { title: next })
    setRenamingId(null)
  }

  if (!outlinerOpen) return null

  const renderRow = (tabId: string, p: Panel, indent = 0) => {
    const isActiveTab = tabId === activeTabId
    const isSel = isActiveTab && selectedPanelIds.includes(p.id)
    return (
      <div
        key={`${tabId}:${p.id}`}
        className={`outliner-row ${isSel ? 'selected' : ''} ${!isActiveTab ? 'foreign' : ''}`}
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
        {p.starred && <span className="outliner-flag" title="Starred">★</span>}
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
      <div className="outliner-body">
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
                  className={`outliner-row ${tabId !== activeTabId ? 'foreign' : ''}`}
                  style={{ paddingLeft: 10 }}
                  onClick={() => jumpTo(tabId, p)}
                  title={`${p.title} — ${tabTitle}`}
                >
                  <span className={`outliner-type t-${p.type}`}>{TYPE_LABEL[p.type] || p.type}</span>
                  <span className="outliner-title">{p.title}</span>
                  <span className="outliner-foreign-tab">{tabTitle}</span>
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
                      {renderRow(tab.id, region)}
                      {(byRegion[region.id] || []).map(child => renderRow(tab.id, child, 1))}
                    </div>
                  ))}
                  {orphans.length > 0 && regions.length > 0 && <div className="outliner-divider" />}
                  {orphans.map(p => renderRow(tab.id, p))}
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
