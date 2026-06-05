import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useWorkspaceStore, type Panel } from '../store/workspaceStore'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './WinTabSwitcher.css'

const TYPE_META: Record<string, { label: string; cls: string; icon: string }> = {
  terminal: { label: 'TERM', cls: 'terminal', icon: '🖥' },
  editor: { label: 'EDIT', cls: 'editor', icon: '📝' },
  browser: { label: 'WEB', cls: 'browser', icon: '🌐' },
  region: { label: 'RG', cls: 'editor', icon: '▢' },
}

const HEALTH_COLOR: Record<string, string> = {
  alive: '#22c55e', loading: '#f59e0b', sleeping: '#6b7280', crashed: '#ef4444',
}

function getContext(p: Panel): string {
  const s = p.settings as Record<string, unknown> | undefined
  if (p.type === 'browser') {
    const tabs = s?.browserTabs as Array<{ url?: string }> | undefined
    const url = tabs?.[0]?.url || p.content || ''
    try { return new URL(url).hostname.replace('www.', '') } catch { return url.slice(0, 30) }
  }
  if (p.type === 'terminal') {
    return p.cwd || p.folderPath || '~/'
  }
  if (p.type === 'editor') {
    return p.filePath ? p.filePath.replace(/.*\//, '') : p.folderPath?.replace(/.*\//, '') || 'scratch'
  }
  return ''
}

const CARDS_PER_ROW = 4

const WinTabSwitcher: React.FC = () => {
  const { winTabOpen, winTabSelectedPanelId, winTabSessionPanels, panels, activeTabId } = useWorkspaceStore()
  const [mouseActive, setMouseActive] = useState(false)
  const initialMousePos = useRef<{ x: number; y: number } | null>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (winTabOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null
    } else {
      if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
        previousActiveElement.current.focus()
      }
    }
  }, [winTabOpen])

  const closeWinTabSwitcher = useWorkspaceStore(s => s.closeWinTabSwitcher)
  const cycleWinTabSelection = useWorkspaceStore(s => s.cycleWinTabSelection)
  const selectWinTabPanel = useWorkspaceStore(s => s.selectWinTabPanel)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)

  // Build card data from session snapshot.
  const cards = useMemo(() => {
    return winTabSessionPanels
      .map(id => panels[id])
      .filter(Boolean)
      .map((p: Panel) => ({
        panel: p,
        meta: TYPE_META[p.type] || TYPE_META.editor,
        context: getContext(p),
        healthState: (() => {
          const ll = (p.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad
          return p.healthState || (ll ? 'sleeping' : 'alive')
        })(),
      }))
  }, [winTabSessionPanels, panels])

  // Current panel ID for dimming.
  const currentPanelId = activeTabId
    ? useWorkspaceStore.getState().tabs.find(t => t.id === activeTabId)?.selectedPanelIds?.[0]
    : null

  // Commit on release.
  const commit = useCallback((targetId?: string | null) => {
    const id = targetId || winTabSelectedPanelId
    if (id && panels[id]) {
      selectPanel(id)
      useWorkspaceStore.getState().enterFocusMode()
      executeWorkspaceCommand('focus-selected')
    }
    closeWinTabSwitcher(true)
  }, [winTabSelectedPanelId, panels, selectPanel, closeWinTabSwitcher])

  // Keyboard & Mouse movement while open.
  useEffect(() => {
    if (!winTabOpen) {
      setMouseActive(false)
      initialMousePos.current = null
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (initialMousePos.current === null) {
        initialMousePos.current = { x: e.clientX, y: e.clientY }
        return
      }
      const dx = e.clientX - initialMousePos.current.x
      const dy = e.clientY - initialMousePos.current.y
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        setMouseActive(true)
      }
    }

    const handler = (e: KeyboardEvent) => {
      const trap = () => { e.preventDefault(); e.stopImmediatePropagation() }

      // Esc → cancel.
      if (e.key === 'Escape') {
        trap()
        closeWinTabSwitcher(false)
        return
      }
      // Tab / Shift+Tab → cycle.
      if (e.key === 'Tab') {
        trap()
        cycleWinTabSelection(e.shiftKey ? -1 : 1)
        return
      }
      // Enter → commit.
      if (e.key === 'Enter') {
        trap()
        commit()
        return
      }
    }

    // Meta keyup → commit.
    const onMetaUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Super' || e.key === 'OS') {
        e.preventDefault()
        // If the user has moved the mouse, they are trying to click.
        // We do NOT commit on release so that they can release the Super key
        // and click the card normally without the window manager intercepting it.
        if (!mouseActive) {
          commit()
        }
      }
    }

    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', onMetaUp, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keyup', onMetaUp, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
    }
  }, [winTabOpen, winTabSelectedPanelId, cards, closeWinTabSwitcher, cycleWinTabSelection, selectPanel, commit, mouseActive])

  if (!winTabOpen || cards.length === 0) return null

  // Split into rows.
  const rows: typeof cards[] = []
  for (let i = 0; i < cards.length; i += CARDS_PER_ROW) {
    rows.push(cards.slice(i, i + CARDS_PER_ROW))
  }

  return (
    <div className="wintab-backdrop">
      <div className="wintab-container">
        {rows.map((row, ri) => (
          <div key={ri} className="wintab-row">
            {row.map((card, ci) => {
              const globalIdx = ri * CARDS_PER_ROW + ci
              const isSelected = card.panel.id === winTabSelectedPanelId
              const isCurrent = card.panel.id === currentPanelId
              const healthColor = HEALTH_COLOR[card.healthState] || HEALTH_COLOR.alive
              return (
                <div
                  key={card.panel.id}
                  className={`wintab-card${isSelected ? ' selected' : ''}${isCurrent ? ' current' : ''}`}
                  onMouseEnter={() => selectWinTabPanel(globalIdx)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    commit(card.panel.id)
                  }}
                >
                  <div className="wintab-header">
                    <span className="wintab-icon">{card.meta.icon}</span>
                    <span className="wintab-num">{globalIdx + 1}</span>
                  </div>
                  <div className="wintab-title">{card.panel.title}</div>
                  <div className="wintab-context">{card.context}</div>
                  <div className="wintab-footer">
                    <span className={`wintab-type ${card.meta.cls}`}>{card.meta.label}</span>
                    <span className="wintab-health" style={{ background: healthColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default WinTabSwitcher
