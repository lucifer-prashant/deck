import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './PanelFinder.css'

const PanelFinder: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    panels,
    panelFinderOpen,
    setPanelFinderOpen,
    selectPanel,
    setViewport
  } = useWorkspaceStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(panels)
      .filter(panel => !q || panel.title.toLowerCase().includes(q) || panel.type.includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [panels, query])

  const jumpToPanel = useCallback((index: number) => {
    const panel = results[index]
    if (!panel) return
    selectPanel(panel.id)
    window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
    setViewport({
      zoom: 1,
      x: window.innerWidth / 2 - (panel.x + panel.width / 2),
      y: window.innerHeight / 2 - (panel.y + panel.height / 2)
    })
    setPanelFinderOpen(false)
    setQuery('')
  }, [results, selectPanel, setPanelFinderOpen, setViewport])

  useEffect(() => {
    if (panelFinderOpen) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [panelFinderOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!panelFinderOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPanelFinderOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(index => Math.min(index + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(index => Math.max(index - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        jumpToPanel(selectedIndex)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [jumpToPanel, panelFinderOpen, results.length, selectedIndex, setPanelFinderOpen])

  if (!panelFinderOpen) return null

  return (
    <div className="panel-finder-overlay" onMouseDown={() => setPanelFinderOpen(false)}>
      <div className="panel-finder" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="panel-finder-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find panel by name..."
        />
        <div className="panel-finder-list">
          {results.map((panel, index) => (
            <button
              key={panel.id}
              className={`panel-finder-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => jumpToPanel(index)}
            >
              <span>{panel.title}</span>
              <span>{panel.type}</span>
            </button>
          ))}
          {results.length === 0 && <div className="panel-finder-empty">No panels found</div>}
        </div>
      </div>
    </div>
  )
}

export default PanelFinder
