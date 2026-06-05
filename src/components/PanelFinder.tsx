import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './PanelFinder.css'

interface SearchResult {
  id: string
  title: string
  kind: string
  isAnno: boolean
  x: number; y: number; width: number; height: number
}

const PanelFinder: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const panels = useWorkspaceStore(s => s.panels)
  const panelFinderOpen = useWorkspaceStore(s => s.panelFinderOpen)
  const setPanelFinderOpen = useWorkspaceStore(s => s.setPanelFinderOpen)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const selectAnnotation = useWorkspaceStore(s => s.selectAnnotation)
  const setViewport = useWorkspaceStore(s => s.setViewport)
  const annotations = useWorkspaceStore(s =>
    s.tabs.find(t => t.id === s.activeTabId)?.annotations || []
  )

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase()

    const panelResults: SearchResult[] = Object.values(panels)
      .filter(p => !q || p.title.toLowerCase().includes(q) || p.type.includes(q))
      .map(p => ({ id: p.id, title: p.title, kind: p.type, isAnno: false, x: p.x, y: p.y, width: p.width, height: p.height }))

    const annoResults: SearchResult[] = annotations
      .filter(a => a.type === 'sticky' || a.type === 'label' || a.type === 'image')
      .filter(a => {
        if (!q) return true
        const title = (a.title || '').toLowerCase()
        const textContent = a.text.toLowerCase()
        const typeLabel = a.type === 'image' ? 'image' : a.type === 'label' ? 'label' : 'sticky'
        return title.includes(q) || textContent.includes(q) || typeLabel.includes(q)
      })
      .map(a => ({
        id: a.id,
        title: a.title || a.text?.slice(0, 30)?.replace(/\n/g, ' ') || (a.type === 'image' ? 'Image' : 'Text'),
        kind: a.type === 'image' ? 'image' : a.type === 'label' ? 'label' : 'sticky',
        isAnno: true,
        x: a.x, y: a.y, width: a.width || 100, height: a.height || 24
      }))

    return [...panelResults, ...annoResults].sort((a, b) => a.title.localeCompare(b.title))
  }, [panels, annotations, query])

  const jumpTo = useCallback((index: number) => {
    const item = results[index]
    if (!item) return
    if (item.isAnno) {
      selectAnnotation(item.id)
    } else {
      selectPanel(item.id)
    }
    window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
    setViewport({
      zoom: 1,
      x: window.innerWidth / 2 - (item.x + item.width / 2),
      y: window.innerHeight / 2 - (item.y + item.height / 2)
    })
    setPanelFinderOpen(false)
    setQuery('')
  }, [results, selectPanel, selectAnnotation, setPanelFinderOpen, setViewport])

  useEffect(() => {
    if (panelFinderOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
        previousActiveElement.current.focus()
      }
    }
  }, [panelFinderOpen])

  useEffect(() => { setSelectedIndex(0) }, [query])

  useEffect(() => {
    if (!panelFinderOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPanelFinderOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, results.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); jumpTo(selectedIndex) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [jumpTo, panelFinderOpen, results.length, selectedIndex, setPanelFinderOpen])

  if (!panelFinderOpen) return null

  return (
    <div className="panel-finder-overlay" onMouseDown={() => setPanelFinderOpen(false)}>
      <div className="panel-finder" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="panel-finder-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find panels, labels, images, notes..."
        />
        <div className="panel-finder-list">
          {results.map((item, index) => (
            <button
              key={item.id}
              className={`panel-finder-item ${index === selectedIndex ? 'selected' : ''} ${item.isAnno ? 'pf-anno' : ''}`}
              onClick={() => jumpTo(index)}
            >
              <span>{item.title}</span>
              <span className="pf-kind">{item.kind}</span>
            </button>
          ))}
          {results.length === 0 && <div className="panel-finder-empty">No results</div>}
        </div>
      </div>
    </div>
  )
}

export default PanelFinder
