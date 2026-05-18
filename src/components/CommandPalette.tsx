import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { executeWorkspaceCommand, WorkspaceCommand } from '../workspaceCommands'
import './CommandPalette.css'

type Category = 'Create' | 'View' | 'Selection' | 'Arrange' | 'Workspace' | 'Presets' | 'Other'

interface Item {
  id: string
  label: string
  category: Category
  glyph?: string
  shortcut?: string
  run: () => void
  // Cached lowercase for matching.
  _l?: string
}

// Subsequence fuzzy match: returns score (lower = better) or -1 if no match.
const fuzzyScore = (query: string, text: string): number => {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let firstMatch = -1
  let lastMatch = -1
  let consecutive = 0
  let bestConsecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti
      lastMatch = ti
      if (ti === lastMatch && ti > 0 && t[ti - 1] === q[qi - 1]) {
        consecutive++
        bestConsecutive = Math.max(bestConsecutive, consecutive)
      } else {
        consecutive = 1
      }
      qi++
    }
  }
  if (qi < q.length) return -1
  // Score: prefer early match + tight span + consecutive runs.
  const span = lastMatch - firstMatch
  return firstMatch + span * 1.5 - bestConsecutive * 3
}

const CATEGORY_ORDER: Category[] = ['Create', 'Selection', 'Arrange', 'View', 'Workspace', 'Presets', 'Other']

const CommandPalette: React.FC = () => {
  const overlayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Subscribe only to what affects rendering — actions read via getState() inside callbacks.
  const commandPaletteOpen = useWorkspaceStore(s => s.commandPaletteOpen)
  const toggleCommandPalette = useWorkspaceStore(s => s.toggleCommandPalette)
  const theme = useWorkspaceStore(s => s.theme)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const runWorkspaceCommand = useCallback((cmd: WorkspaceCommand) => {
    executeWorkspaceCommand(cmd)
  }, [])

  const close = useCallback(() => {
    setQuery('')
    toggleCommandPalette()
  }, [toggleCommandPalette])

  const items: Item[] = useMemo(() => {
    const wc = (id: WorkspaceCommand) => () => runWorkspaceCommand(id)
    const store = () => useWorkspaceStore.getState()
    const list: Item[] = [
      // Create
      { id: 'new-note', label: 'New Note', category: 'Create', glyph: '✦', shortcut: 'Ctrl+N', run: wc('new-note') },
      { id: 'new-terminal', label: 'New Terminal', category: 'Create', glyph: '▶', shortcut: 'Ctrl+T', run: wc('new-terminal') },
      { id: 'new-editor', label: 'New Editor', category: 'Create', glyph: '✎', shortcut: 'Ctrl+E', run: wc('new-editor') },
      { id: 'new-browser', label: 'New Browser Preview', category: 'Create', glyph: '◐', run: wc('new-browser') },
      { id: 'new-region', label: 'New Region', category: 'Create', glyph: '▢', run: wc('new-region') },
      { id: 'new-tab', label: 'New Canvas Tab', category: 'Create', glyph: '+', run: wc('new-tab') },
      // Selection
      { id: 'select-all', label: 'Select All Panels', category: 'Selection', shortcut: 'Ctrl+A', run: wc('select-all') },
      { id: 'clear-selection', label: 'Clear Selection', category: 'Selection', shortcut: 'Esc', run: wc('clear-selection') },
      { id: 'duplicate-selected', label: 'Duplicate Selected', category: 'Selection', shortcut: 'Ctrl+D', run: wc('duplicate-selected') },
      { id: 'rename-selected', label: 'Rename Selected', category: 'Selection', shortcut: 'F2', run: wc('rename-selected') },
      { id: 'toggle-lock', label: 'Lock / Unlock Selected', category: 'Selection', run: wc('toggle-lock') },
      { id: 'toggle-minimize', label: 'Minimize / Restore Selected', category: 'Selection', run: wc('toggle-minimize') },
      { id: 'toggle-pin-front', label: 'Pin / Unpin Selected to Front', category: 'Selection', glyph: '📌', run: wc('toggle-pin-front') },
      { id: 'bring-front', label: 'Bring Selected to Front', category: 'Selection', run: wc('bring-front') },
      { id: 'send-back', label: 'Send Selected to Back', category: 'Selection', run: wc('send-back') },
      { id: 'focus-selected', label: 'Focus Selected (fly to)', category: 'Selection', shortcut: 'F', run: wc('focus-selected') },
      // Arrange
      { id: 'align-left', label: 'Align Selected Left', category: 'Arrange', run: wc('align-left') },
      { id: 'align-right', label: 'Align Selected Right', category: 'Arrange', run: wc('align-right') },
      { id: 'align-top', label: 'Align Selected Top', category: 'Arrange', run: wc('align-top') },
      { id: 'align-bottom', label: 'Align Selected Bottom', category: 'Arrange', run: wc('align-bottom') },
      { id: 'distribute-horizontal', label: 'Distribute Horizontally', category: 'Arrange', run: wc('distribute-horizontal') },
      { id: 'distribute-vertical', label: 'Distribute Vertically', category: 'Arrange', run: wc('distribute-vertical') },
      { id: 'group-region', label: 'Group into Region', category: 'Arrange', shortcut: 'Ctrl+G', run: wc('group-region') },
      { id: 'ungroup-region', label: 'Ungroup Region', category: 'Arrange', shortcut: 'Ctrl+Shift+G', run: wc('ungroup-region') },
      // View
      { id: 'fit-all', label: 'Fit All Panels', category: 'View', run: wc('fit-all') },
      { id: 'reset-viewport', label: 'Reset Viewport', category: 'View', shortcut: 'Ctrl+0', run: wc('reset-viewport') },
      { id: 'zoom-in', label: 'Zoom In', category: 'View', shortcut: 'Ctrl+=', run: wc('zoom-in') },
      { id: 'zoom-out', label: 'Zoom Out', category: 'View', shortcut: 'Ctrl+-', run: wc('zoom-out') },
      { id: 'toggle-minimap', label: 'Toggle Minimap', category: 'View', shortcut: 'M', run: wc('toggle-minimap') },
      { id: 'toggle-snap', label: 'Toggle Snap to Grid', category: 'View', run: wc('toggle-snap') },
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+Shift+B', run: () => store().toggleSidebar() },
      { id: 'toggle-help', label: 'Show Keyboard Shortcuts', category: 'View', shortcut: '?', run: () => store().toggleHelp() },
      { id: 'cycle-theme', label: `Theme — ${theme} (cycle)`, category: 'View', glyph: '◐', shortcut: 'Ctrl+Shift+T', run: () => store().cycleTheme() },
      { id: 'toggle-chrome', label: 'Toggle Top Bar', category: 'View', shortcut: 'Ctrl+\\', run: () => store().toggleChrome() },
      // Workspace
      { id: 'mark-saved', label: 'Mark Canvas as Saved', category: 'Workspace', shortcut: 'Ctrl+Alt+S', run: () => store().markTabSaved() },
      { id: 'find-panel', label: 'Find Panel by Name', category: 'Workspace', shortcut: 'Ctrl+F', run: () => store().togglePanelFinder() },
      { id: 'clear-canvas', label: 'Clear Canvas (delete all panels)', category: 'Workspace', run: wc('clear-canvas') },
      // Presets — curated tabs that survive restarts. Reuse-or-create by title.
      { id: 'preset-life', label: 'Open Preset: Life (YouTube · Spotify · IG · WA · TG)', category: 'Presets', glyph: '✦', shortcut: 'Ctrl+Shift+L', run: () => store().loadPreset('life') },
      { id: 'preset-no-life', label: 'Open Preset: No-Life (Gmail · LinkedIn · GitHub · Reddit · VSCode · Terminal)', category: 'Presets', glyph: '⚒', shortcut: 'Ctrl+Shift+K', run: () => store().loadPreset('no-life') }
    ]
    return list
  }, [runWorkspaceCommand, theme])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return items
    const scored: Array<{ item: Item; score: number }> = []
    items.forEach(it => {
      const score = fuzzyScore(q, it.label + ' ' + it.category)
      if (score >= 0) scored.push({ item: it, score })
    })
    scored.sort((a, b) => a.score - b.score)
    return scored.map(s => s.item)
  }, [query, items])

  // Group by category for display when no query (preserve order). With query, flat by score.
  type Row = { type: 'header'; label: string } | { type: 'item'; item: Item; flatIndex: number }
  const rows: Row[] = useMemo(() => {
    if (query.trim()) {
      return filtered.map((item, i) => ({ type: 'item' as const, item, flatIndex: i }))
    }
    const out: Row[] = []
    let flat = 0
    CATEGORY_ORDER.forEach(cat => {
      const inCat = filtered.filter(it => it.category === cat)
      if (inCat.length === 0) return
      out.push({ type: 'header', label: cat })
      inCat.forEach(item => {
        out.push({ type: 'item', item, flatIndex: flat++ })
      })
    })
    return out
  }, [filtered, query])

  // Reset selection when query changes.
  useEffect(() => { setSelectedIndex(0) }, [query])

  // Scroll selected item into view (auto).
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-flat-index="${selectedIndex}"]`)
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) inputRef.current.focus()
  }, [commandPaletteOpen])

  const totalItems = filtered.length
  const runAt = useCallback((flatIdx: number) => {
    const it = filtered[flatIdx]
    if (!it) return
    it.run()
    close()
  }, [filtered, close])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!commandPaletteOpen) return
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, Math.max(0, totalItems - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Home') {
        e.preventDefault(); setSelectedIndex(0)
      } else if (e.key === 'End') {
        e.preventDefault(); setSelectedIndex(Math.max(0, totalItems - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault(); runAt(selectedIndex)
      } else if (e.key === 'Tab') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, totalItems, selectedIndex, runAt, close])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) close()
  }, [close])

  if (!commandPaletteOpen) return null

  const highlightMatch = (text: string): React.ReactNode => {
    const q = query.trim().toLowerCase()
    if (!q) return text
    const t = text.toLowerCase()
    const nodes: React.ReactNode[] = []
    let qi = 0
    let buf = ''
    for (let ti = 0; ti < text.length; ti++) {
      if (qi < q.length && t[ti] === q[qi]) {
        if (buf) { nodes.push(buf); buf = '' }
        nodes.push(<mark key={ti}>{text[ti]}</mark>)
        qi++
      } else {
        buf += text[ti]
      }
    }
    if (buf) nodes.push(buf)
    return <>{nodes}</>
  }

  return (
    <div className="command-palette-overlay" ref={overlayRef} onMouseDown={handleOverlayClick}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <span className="command-palette-prefix">›</span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={`Search ${items.length} commands…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
          />
          <span className="command-palette-count">{totalItems}</span>
        </div>
        <div className="command-palette-list" ref={listRef}>
          {rows.map((row, i) => {
            if (row.type === 'header') {
              return <div key={`h-${row.label}-${i}`} className="command-palette-section">{row.label}</div>
            }
            const isSel = row.flatIndex === selectedIndex
            return (
              <div
                key={row.item.id}
                data-flat-index={row.flatIndex}
                className={`command-palette-item ${isSel ? 'selected' : ''}`}
                onMouseEnter={() => {
                  if (selectedIndex !== row.flatIndex) setSelectedIndex(row.flatIndex)
                }}
                onClick={() => runAt(row.flatIndex)}
              >
                <span className="command-palette-glyph">{row.item.glyph || ' '}</span>
                <span className="command-palette-label">{highlightMatch(row.item.label)}</span>
                <span className="command-palette-category">{row.item.category}</span>
                {row.item.shortcut && <span className="command-palette-shortcut">{row.item.shortcut}</span>}
              </div>
            )
          })}
          {totalItems === 0 && (
            <div className="command-palette-empty">No commands match “{query}”</div>
          )}
        </div>
        <div className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
