import React, { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './PanelSwitcher.css'

const TYPE_META: Record<string, { label: string; cls: string; icon: string }> = {
  terminal: { label: 'TERM', cls: 'terminal', icon: '⌘' },
  editor: { label: 'EDIT', cls: 'editor', icon: '{ }' },
  browser: { label: 'WEB', cls: 'browser', icon: '◉' },
  note: { label: 'NOTE', cls: 'note', icon: '✎' },
  region: { label: 'RG', cls: 'region', icon: '▢' },
}

const PanelSwitcher: React.FC = () => {
  const { panelSwitcherOpen, panels, activeTabId, tabs } = useWorkspaceStore()
  const setPanelSwitcherOpen = useWorkspaceStore(s => s.setPanelSwitcherOpen)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const [highlightedIdx, setHighlightedIdx] = useState(0)

  // All panels on the active canvas (no regions), sorted by position.
  const allPanels = useMemo(
    () => Object.values(panels)
      .filter((p: Panel) => p.type !== 'region')
      .sort((a, b) => a.y - b.y || a.x - b.x) as Panel[],
    [panels]
  )
  const panelCount = allPanels.length

  // Reset highlight when panel count changes.
  useEffect(() => {
    setHighlightedIdx(0)
  }, [panelCount])

  useEffect(() => {
    if (!panelSwitcherOpen) return
    const handler = (e: KeyboardEvent) => {
      // Trap ALL keys so canvas never sees them.
      const trap = () => { e.preventDefault(); e.stopImmediatePropagation() }

      if (e.key === 'Escape') {
        trap()
        setPanelSwitcherOpen(false)
        return
      }
      if (e.key === 'Enter') {
        trap()
        const p = allPanels[highlightedIdx]
        if (p) {
          setPanelSwitcherOpen(false)
          selectPanel(p.id)
          useWorkspaceStore.getState().enterFocusMode()
          executeWorkspaceCommand('focus-selected')
        }
        return
      }
      if (e.key === 'ArrowDown') {
        trap()
        setHighlightedIdx(i => (i + 1 >= panelCount ? 0 : i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        trap()
        setHighlightedIdx(i => (i - 1 < 0 ? panelCount - 1 : i - 1))
        return
      }
      if (/^[1-9]$/.test(e.key)) {
        trap()
        const idx = parseInt(e.key, 10) - 1
        const p = allPanels[idx]
        if (p) {
          setPanelSwitcherOpen(false)
          selectPanel(p.id)
          useWorkspaceStore.getState().enterFocusMode()
          executeWorkspaceCommand('focus-selected')
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [panelSwitcherOpen, highlightedIdx, selectPanel, setPanelSwitcherOpen, allPanels, panelCount])

  if (!panelSwitcherOpen || panelCount === 0) return null

  // Current panel id for active highlight.
  const currentPanelIds = tabs.find(t => t.id === activeTabId)?.selectedPanelIds ?? []

  return (
    <div className="panel-switcher-backdrop" onClick={() => setPanelSwitcherOpen(false)}>
      <div className="panel-switcher-card" onClick={e => e.stopPropagation()}>
        <div className="panel-switcher-header">
          Quick Switch · {panelCount} panels{panelCount > 9 ? '' : ' · 1–' + panelCount + ' to jump'}
        </div>
        <div className="panel-switcher-list">
          {allPanels.map((p, i) => {
            const meta = TYPE_META[p.type] || TYPE_META.note
            const isActive = currentPanelIds.includes(p.id)
            return (
              <div
                key={p.id}
                className={`panel-switcher-item${isActive ? ' current' : ''}${i === highlightedIdx ? ' highlighted' : ''}`}
                onClick={() => {
                  setPanelSwitcherOpen(false)
                  selectPanel(p.id)
                  useWorkspaceStore.getState().enterFocusMode()
                  executeWorkspaceCommand('focus-selected')
                }}
                onMouseEnter={() => setHighlightedIdx(i)}
              >
                <span className="ps-number">{i + 1}</span>
                <span className={`ps-type-icon ${meta.cls}`}>{meta.icon}</span>
                <div className="ps-info">
                  <div className="ps-title">{p.title}</div>
                  <div className="ps-meta">{meta.label}{p.description ? ` · ${p.description}` : ''}</div>
                </div>
                {p.color && <span className="ps-color-dot" style={{ background: p.color }} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default PanelSwitcher
