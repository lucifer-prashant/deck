import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { TerminalShellType, SHELL_CONFIGS, getShellOptions } from '../types/terminalShells'
import { executeWorkspaceCommand, createPanelAtViewportCenter } from '../workspaceCommands'
import TabContextMenu from './TabContextMenu'
import './WorkspaceChrome.css'

const WorkspaceChrome: React.FC = () => {
  const tabs = useWorkspaceStore(s => s.tabs)
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)
  const minimapVisible = useWorkspaceStore(s => s.minimapVisible)
  const sidebarOpen = useWorkspaceStore(s => s.sidebarOpen)
  const createTab = useWorkspaceStore(s => s.createTab)
  const switchTab = useWorkspaceStore(s => s.switchTab)
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const renameTab = useWorkspaceStore(s => s.renameTab)
  const reorderTab = useWorkspaceStore(s => s.reorderTab)
  const movePanelToTab = useWorkspaceStore(s => s.movePanelToTab)
  const exportWorkspace = useWorkspaceStore(s => s.exportWorkspace)
  const importWorkspace = useWorkspaceStore(s => s.importWorkspace)
  const toggleSidebar = useWorkspaceStore(s => s.toggleSidebar)
  const setBarsVisible = useWorkspaceStore(s => s.setBarsVisible)
  const toggleHelp = useWorkspaceStore(s => s.toggleHelp)
  const toggleCommandPalette = useWorkspaceStore(s => s.toggleCommandPalette)
  const toggleChrome = useWorkspaceStore(s => s.toggleChrome)
  const canvasPresets = useWorkspaceStore(s => s.canvasPresets)
  const overwriteCanvasPreset = useWorkspaceStore(s => s.overwriteCanvasPreset)
  const saveCanvasPreset = useWorkspaceStore(s => s.saveCanvasPreset)
  const saveBuiltinPreset = useWorkspaceStore(s => s.saveBuiltinPreset)
  const prefs = useWorkspaceStore(s => s.prefs)
  const markTabSaved = useWorkspaceStore(s => s.markTabSaved)
  const zoom = useWorkspaceStore(s => s.viewport.zoom)


  const [showTermDropdown, setShowTermDropdown] = useState(false)
  const terminalBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showTermDropdown) return
    const handler = (e: MouseEvent) => {
      if (terminalBtnRef.current && !terminalBtnRef.current.contains(e.target as Node)) {
        setShowTermDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTermDropdown])

  const handleCreateTerminal = (shellType: TerminalShellType) => {
    let shellPath = ''
    if (shellType === 'custom') {
      const customPath = window.prompt("Enter custom shell executable path:", prefs.defaultTerminalShell || '')
      if (!customPath) return
      shellPath = customPath
    } else {
      shellPath = shellType
    }
    createPanelAtViewportCenter('terminal', { shellPath })
  }

  const handleMainCreateTerminal = () => {
    let resolvedShellType: TerminalShellType = 'powershell'

    const defType = prefs.defaultTerminalShellType
    if (defType && defType !== 'remember_last') {
      resolvedShellType = defType as TerminalShellType
    } else {
      resolvedShellType = prefs.lastSpawnedShellType ?? 'powershell'
    }

    let shellPath = ''
    if (resolvedShellType === 'custom') {
      shellPath = prefs.defaultTerminalShell || ''
      if (!shellPath) {
        const customPath = window.prompt("Enter custom shell executable path:")
        if (!customPath) return
        shellPath = customPath
      }
    } else {
      shellPath = resolvedShellType
    }

    createPanelAtViewportCenter('terminal', { shellPath })
  }

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [tabDraft, setTabDraft] = useState('')
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [overflowLeft, setOverflowLeft] = useState(false)
  const [overflowRight, setOverflowRight] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingTabId) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [renamingTabId])

  const updateOverflow = useCallback(() => {
    const el = tabsRef.current
    if (!el) return
    setOverflowLeft(el.scrollLeft > 2)
    setOverflowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    updateOverflow()
    const el = tabsRef.current
    if (!el) return
    el.addEventListener('scroll', updateOverflow)
    window.addEventListener('resize', updateOverflow)
    return () => {
      el.removeEventListener('scroll', updateOverflow)
      window.removeEventListener('resize', updateOverflow)
    }
  }, [updateOverflow, tabs.length])

  const scrollTabs = (dir: -1 | 1) => {
    const el = tabsRef.current
    if (!el) return
    el.scrollBy({ left: dir * 220, behavior: 'smooth' })
  }

  const beginTabRename = (id: string, title: string) => {
    setTabDraft(title)
    setRenamingTabId(id)
  }
  const commitTabRename = () => {
    if (renamingTabId) renameTab(renamingTabId, tabDraft || '')
    setRenamingTabId(null)
  }

  const confirmCloseTab = useCallback((id: string) => {
    const t = tabs.find(x => x.id === id)
    if (!t) return
    if (t.kind === 'scratchpad') {
      closeTab(id)
      return
    }
    const count = Object.keys(t.panels).length
    if (count > 0) {
      const dirty = t.lastEditedAt && t.lastEditedAt > (t.lastSavedAt || 0)
      if (dirty) {
        const isBuiltin = t.kind === 'preset:life' || t.kind === 'preset:no-life'
        const linked = t.linkedPresetId ? canvasPresets[t.linkedPresetId] : null
        const wantSave = window.confirm(
          isBuiltin
            ? `Save layout changes to "${t.title}" preset before closing? OK = save, Cancel = close without saving.`
            : linked
              ? `Save changes to "${linked.name}" before closing? OK = save, Cancel = close without saving.`
              : `Save canvas "${t.title}" as a preset before closing? OK = save, Cancel = close without saving.`
        )
        if (wantSave) {
          if (isBuiltin) {
            saveBuiltinPreset(t.kind as 'preset:life' | 'preset:no-life')
          } else if (linked) {
            overwriteCanvasPreset(linked.id)
            markTabSaved()
          } else {
            const name = window.prompt('Preset name:', t.title)
            if (name?.trim()) {
              saveCanvasPreset(name.trim())
              markTabSaved()
            }
          }
        }
        // Close either way — user made their choice.
        closeTab(id)
        return
      }
      // Clean canvas: just confirm close.
      const ok = window.confirm(`Close canvas "${t.title}"?\n\n${count} panel${count === 1 ? '' : 's'} will be removed.`)
      if (!ok) return
    }
    closeTab(id)
  }, [tabs, closeTab, canvasPresets, overwriteCanvasPreset, saveCanvasPreset, saveBuiltinPreset, markTabSaved])

  const handleExport = () => {
    const json = exportWorkspace()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `worktree-studio-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => fileInputRef.current?.click()
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(text => {
      if (!importWorkspace(text)) {
        window.alert('Failed to import workspace — invalid format.')
      }
    })
    e.target.value = ''
  }

  const selectedIsFront = useWorkspaceStore(s => {
    const targets = s.selectedPanelIds.map(id => s.panels[id]).filter(Boolean)
    return targets.length > 0 && targets.every(panel => panel.pinFront)
  })
  const selectedLocked = useWorkspaceStore(s => {
    const targets = s.selectedPanelIds.map(id => s.panels[id]).filter(Boolean)
    return targets.length > 0 && targets.every(panel => panel.locked)
  })
  const selectedMinimized = useWorkspaceStore(s => {
    const targets = s.selectedPanelIds.map(id => s.panels[id]).filter(Boolean)
    return targets.length > 0 && targets.every(panel => panel.minimized)
  })

  return (
    <div className="workspace-chrome">
      <div className="workspace-tabs-row">
        <button
          className={`chrome-icon ${sidebarOpen ? 'active' : ''}`}
          onClick={() => {
            // Match Ctrl+Shift+B: opening sidebar auto-hides bars, closing restores them.
            const willOpen = !sidebarOpen
            toggleSidebar()
            setBarsVisible(!willOpen)
          }}
          title="Toggle sidebar (Ctrl+Shift+B)"
        >☰</button>
        <div className="workspace-tab-divider" />
        {overflowLeft && (
          <button className="tab-overflow-btn" onClick={() => scrollTabs(-1)} title="Scroll tabs left">‹</button>
        )}
        <div className="workspace-tabs" ref={tabsRef}>
          {tabs.map(tab => {
            const dirty = (tab.lastEditedAt || 0) > (tab.lastSavedAt || 0)
            return (
              <div
                key={tab.id}
                className={`workspace-tab ${tab.id === activeTabId ? 'active' : ''} ${dragTabId === tab.id ? 'dragging' : ''} ${tab.kind === 'scratchpad' ? 'scratchpad-tab' : ''}`}
                onClick={() => tab.id !== activeTabId && switchTab(tab.id)}
                onDoubleClick={() => beginTabRename(tab.id, tab.title)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabCtxMenu({ id: tab.id, x: e.clientX, y: e.clientY })
                }}
                draggable={renamingTabId !== tab.id}
                onDragStart={(e) => {
                  setDragTabId(tab.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/wts-tab', tab.id)
                }}
                onDragOver={(e) => {
                  // Allow drop for tab reorder OR panel from outliner.
                  if (e.dataTransfer.types.includes('text/wts-tab') || e.dataTransfer.types.includes('text/wts-panel')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const tabDragId = e.dataTransfer.getData('text/wts-tab')
                  const panelDragId = e.dataTransfer.getData('text/wts-panel')
                  if (tabDragId && tabDragId !== tab.id) reorderTab(tabDragId, tab.id)
                  else if (panelDragId && tab.id !== activeTabId) movePanelToTab(panelDragId, tab.id)
                  setDragTabId(null)
                }}
                onDragEnd={() => setDragTabId(null)}
                title="Double-click to rename · drag to reorder · right-click for menu · drop a panel from outliner to move it"
              >
                {dirty && <span className="workspace-tab-dot" title="Unsaved changes" />}
                {renamingTabId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    className="workspace-tab-input"
                    value={tabDraft}
                    onChange={(e) => setTabDraft(e.target.value)}
                    onBlur={commitTabRename}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitTabRename()
                      else if (e.key === 'Escape') setRenamingTabId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{tab.title}</span>
                )}
                {tabs.length > 1 && renamingTabId !== tab.id && (
                  <span
                    className="workspace-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmCloseTab(tab.id)
                    }}
                  >×</span>
                )}
              </div>
            )
          })}
        </div>
        {overflowRight && (
          <button className="tab-overflow-btn" onClick={() => scrollTabs(1)} title="Scroll tabs right">›</button>
        )}
        <button className="workspace-tab add" onClick={() => createTab()} title="New canvas tab">+</button>
        <div className="workspace-spacer" />

        <div className="chrome-split-btn" ref={terminalBtnRef}>
          <button
            className="chrome-chip"
            onClick={handleMainCreateTerminal}
            title="Spawn Terminal (Ctrl+T)"
          >
            + Terminal
          </button>
          <button
            className="chrome-chip split-arrow"
            onClick={(e) => { e.stopPropagation(); setShowTermDropdown(!showTermDropdown) }}
            title="Select Terminal Shell Preset"
          >
            ▼
          </button>
          {showTermDropdown && (
            <div className="chrome-split-dropdown">
              {prefs.lastSpawnedShellType && SHELL_CONFIGS[prefs.lastSpawnedShellType] && (
                <>
                  <div className="split-dropdown-header">Recent</div>
                  <button
                    className="split-dropdown-item"
                    onClick={() => {
                      setShowTermDropdown(false)
                      handleCreateTerminal(prefs.lastSpawnedShellType!)
                    }}
                  >
                    <i className={SHELL_CONFIGS[prefs.lastSpawnedShellType].icon} />
                    <span>{SHELL_CONFIGS[prefs.lastSpawnedShellType].label}</span>
                    <span className="split-dropdown-recent-badge">recent</span>
                  </button>
                  <div className="split-dropdown-separator" />
                </>
              )}

              <div className="split-dropdown-header">All Shells</div>
              {getShellOptions(window.electronAPI?.platform || 'linux').map(option => (
                <button
                  key={option.type}
                  className="split-dropdown-item"
                  onClick={() => {
                    setShowTermDropdown(false)
                    handleCreateTerminal(option.type)
                  }}
                >
                  <i className={option.icon} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="chrome-chip" onClick={toggleCommandPalette} title="Command palette (Ctrl+P)">⌘ P</button>
        <button className="chrome-chip" onClick={() => executeWorkspaceCommand('fit-all')} title="Fit all panels">Fit</button>
        <button className={`chrome-chip ${minimapVisible ? 'active' : ''}`} onClick={() => executeWorkspaceCommand('toggle-minimap')}>Map</button>
        <div className="workspace-tab-divider" />
        <button className="chrome-chip ghost" onClick={handleImportClick} title="Import workspace JSON">⬆</button>
        <button className="chrome-chip ghost" onClick={handleExport} title="Export workspace JSON">⬇</button>
        <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleImportFile} />
        <button
          className="chrome-chip ghost"
          onClick={() => useWorkspaceStore.getState().toggleSettings()}
          title="Preferences & Settings (Ctrl+,)"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <i className="ti ti-settings" style={{ fontSize: 13 }} />
          <span>Settings</span>
        </button>
        <button className="chrome-chip ghost help" onClick={toggleHelp} title="Keyboard shortcuts (?)">?</button>
        <button
          className="chrome-chip ghost"
          onClick={toggleChrome}
          title="Hide top bar (Ctrl+\\)"
        >▴</button>
        <span className="chrome-readout">{Math.round(zoom * 100)}%</span>
        <span className="chrome-readout">{selectedPanelIds.length} sel</span>
        {selectedPanelIds.length > 0 && (
          <div className="selection-actions">
            <button
              className={`chrome-chip ${selectedIsFront ? 'active' : ''}`}
              onClick={() => executeWorkspaceCommand('toggle-pin-front')}
              title={selectedIsFront ? 'Unpin from front' : 'Pin to front'}
            >Front</button>
            <button className={`chrome-chip ${selectedLocked ? 'active' : ''}`} onClick={() => executeWorkspaceCommand('toggle-lock')}>Lock</button>
            <button className={`chrome-chip ${selectedMinimized ? 'active' : ''}`} onClick={() => executeWorkspaceCommand('toggle-minimize')}>Min</button>
          </div>
        )}
      </div>

      {tabCtxMenu && (
        <TabContextMenu
          tabId={tabCtxMenu.id}
          x={tabCtxMenu.x}
          y={tabCtxMenu.y}
          onRename={() => {
            const t = tabs.find(t => t.id === tabCtxMenu.id)
            if (t) beginTabRename(t.id, t.title)
          }}
          onClose={() => setTabCtxMenu(null)}
        />
      )}
    </div>
  )
}

export default WorkspaceChrome
