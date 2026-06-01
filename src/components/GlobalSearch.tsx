import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import { getActiveContextPanel, readPanelContext } from '../panelContext'
import './GlobalSearch.css'

interface FileHit { file: string; line: number; text: string }
type Group = { file: string; hits: FileHit[] }

const GlobalSearch: React.FC = () => {
  const open = useWorkspaceStore(s => s.globalSearchOpen)
  const close = useWorkspaceStore(s => s.toggleGlobalSearch)
  const panels = useWorkspaceStore(s => s.panels)
  const lastFocused = useWorkspaceStore(s => s.lastFocusedPanelId)
  const selectedIds = useWorkspaceStore(s => s.selectedPanelIds)

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileHits, setFileHits] = useState<FileHit[]>([])
  const [tool, setTool] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const reqIdRef = useRef(0)

  const ctx = useMemo(() => {
    const p = getActiveContextPanel()
    return p ? readPanelContext(p) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, lastFocused, selectedIds, open])

  const root = ctx?.projectPath || ctx?.folderPath || ctx?.cwd

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setFileHits([])
    }
  }, [open])

  useEffect(() => {
    if (!open || !query.trim() || !root) {
      setFileHits([])
      return
    }
    const id = ++reqIdRef.current
    setLoading(true)
    const t = setTimeout(() => {
      window.electronAPI?.search?.files(root, query.trim(), 200).then(r => {
        if (id !== reqIdRef.current) return
        setLoading(false)
        setFileHits(r?.results || [])
        setTool(r?.tool || '')
      }).catch(() => {
        if (id !== reqIdRef.current) return
        setLoading(false)
      })
    }, 200) // debounce
    return () => clearTimeout(t)
  }, [query, root, open])

  // Search panel titles + note bodies locally.
  const panelMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as Array<{ id: string; title: string; type: string; snippet?: string }>
    return Object.values(panels)
      .filter(p => p.title.toLowerCase().includes(q))
      .slice(0, 20)
      .map(p => {
        return { id: p.id, title: p.title, type: p.type, snippet: '' }
      })
  }, [panels, query])

  const grouped: Group[] = useMemo(() => {
    const m = new Map<string, FileHit[]>()
    fileHits.forEach(h => {
      if (!m.has(h.file)) m.set(h.file, [])
      m.get(h.file)!.push(h)
    })
    return Array.from(m.entries()).map(([file, hits]) => ({ file, hits }))
  }, [fileHits])

  const openInEditor = (path: string, _line: number) => {
    // For now: select first editor panel and dispatch a custom event with path.
    // Real wire-up would set editor.openFile(path, line) — placeholder.
    const evt = new CustomEvent('wts-open-file', { detail: { path, line: _line } })
    window.dispatchEvent(evt)
    close()
  }

  const focusPanel = (id: string) => {
    const p = panels[id]
    if (!p) return
    const s = useWorkspaceStore.getState()
    s.selectPanel(id)
    window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
    s.setViewport({
      zoom: 1,
      x: window.innerWidth / 2 - (p.x + p.width / 2),
      y: window.innerHeight / 2 - (p.y + p.height / 2)
    })
    close()
  }

  if (!open) return null

  const totalFile = fileHits.length
  const totalPanel = panelMatches.length

  return createPortal(
    <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="gs-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gs-head">
          <span className="gs-icon">⌕</span>
          <input
            ref={inputRef}
            className="gs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
            }}
            placeholder={root ? `search in ${root.split('/').pop() || root}…` : 'no active project — focus a panel inside a project'}
            spellCheck={false}
          />
          <span className="gs-meta">
            {loading ? 'searching…' : query ? `${totalFile} file · ${totalPanel} panel${tool ? ` · ${tool}` : ''}` : ''}
          </span>
          <button className="gs-close" onClick={close} title="Close (Esc)">×</button>
        </div>

        <div className="gs-body">
          {!query && (
            <div className="gs-empty">
              type to search file contents in active project + panel titles + note bodies
            </div>
          )}
          {query && totalPanel > 0 && (
            <div className="gs-section">
              <div className="gs-section-head">Panels ({totalPanel})</div>
              {panelMatches.map(m => (
                <button key={m.id} className="gs-row" onClick={() => focusPanel(m.id)}>
                  <span className="gs-type">{m.type}</span>
                  <span className="gs-title">{m.title}</span>
                  {m.snippet && <span className="gs-snippet">{m.snippet}</span>}
                </button>
              ))}
            </div>
          )}
          {query && grouped.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-head">Files ({totalFile})</div>
              {grouped.map(g => (
                <div key={g.file} className="gs-file-group">
                  <div className="gs-file-head" title={g.file}>{g.file.replace(root + '/', '')}</div>
                  {g.hits.slice(0, 10).map((h, i) => (
                    <button key={i} className="gs-row" onClick={() => openInEditor(h.file, h.line)}>
                      <span className="gs-line">{h.line}</span>
                      <span className="gs-text">{h.text}</span>
                    </button>
                  ))}
                  {g.hits.length > 10 && <div className="gs-more">+{g.hits.length - 10} more</div>}
                </div>
              ))}
            </div>
          )}
          {query && !loading && totalFile === 0 && totalPanel === 0 && (
            <div className="gs-empty">no results</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default GlobalSearch
