import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './Minimap.css'

const DEFAULT_SIZE = 260
const HEADER_HEIGHT = 28
const MIN_PANEL_MARK = 6
const EDGE_PADDING = 8

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const TYPE_COLORS: Record<string, string> = {
  terminal: '#2d8a4e',
  editor: '#0078d4',
  browser: '#7c3aed',
  note: '#888888',
  region: 'rgba(0,120,212,0.25)'
}

const Minimap: React.FC = () => {
  const minimapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const panels = useWorkspaceStore(s => s.panels)
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)
  const viewport = useWorkspaceStore(s => s.viewport)
  const setViewport = useWorkspaceStore(s => s.setViewport)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const toggleMinimap = useWorkspaceStore(s => s.toggleMinimap)
  const viewportBookmarks = useWorkspaceStore(s => s.viewportBookmarks)

  const [pos, setPos] = useState(() => {
    const saved = localStorage.getItem('worktree-studio-minimap-pos')
    return saved ? JSON.parse(saved) as { x: number; y: number } : { x: 16, y: 46 }
  })
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem('worktree-studio-minimap-size')
    return saved ? Number(saved) || DEFAULT_SIZE : DEFAULT_SIZE
  })
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState<null | 'br' | 'tl'>(null)
  const [draggingViewport, setDraggingViewport] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const resizeStart = useRef({ x: 0, y: 0, s: 0 })
  const viewportDragStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const posFlushTimer = useRef<number>(0)
  const sizeFlushTimer = useRef<number>(0)

  const bounds = useMemo(() => {
    const values = Object.values(panels)
    if (values.length === 0) return { x: -500, y: -500, width: 2000, height: 2000 }
    const minX = Math.min(...values.map(p => p.x))
    const minY = Math.min(...values.map(p => p.y))
    const maxX = Math.max(...values.map(p => p.x + p.width))
    const maxY = Math.max(...values.map(p => p.y + p.height))
    // Include current viewport rect in bounds so the viewport indicator never goes off-map.
    const vpLeft = -viewport.x / viewport.zoom
    const vpTop = -viewport.y / viewport.zoom
    const vpRight = vpLeft + window.innerWidth / viewport.zoom
    const vpBottom = vpTop + window.innerHeight / viewport.zoom
    const x0 = Math.min(minX, vpLeft) - 200
    const y0 = Math.min(minY, vpTop) - 200
    const x1 = Math.max(maxX, vpRight) + 200
    const y1 = Math.max(maxY, vpBottom) + 200
    return { x: x0, y: y0, width: Math.max(x1 - x0, 1000), height: Math.max(y1 - y0, 800) }
  }, [panels, viewport])

  const viewSize = size - 4
  const viewHeight = size - HEADER_HEIGHT - 4
  const scale = Math.min(viewSize / bounds.width, viewHeight / bounds.height)

  const vpX = (-viewport.x / viewport.zoom - bounds.x) * scale
  const vpY = (-viewport.y / viewport.zoom - bounds.y) * scale
  const vpW = Math.max((window.innerWidth / viewport.zoom) * scale, 12)
  const vpH = Math.max((window.innerHeight / viewport.zoom) * scale, 12)

  useEffect(() => {
    // Debounce: minimap pos updates at 60fps during drag — batch writes to avoid
    // 60 synchronous localStorage calls/sec blocking the main thread.
    window.clearTimeout(posFlushTimer.current)
    posFlushTimer.current = window.setTimeout(() => {
      localStorage.setItem('worktree-studio-minimap-pos', JSON.stringify(pos))
    }, 300)
  }, [pos])

  useEffect(() => {
    window.clearTimeout(sizeFlushTimer.current)
    sizeFlushTimer.current = window.setTimeout(() => {
      localStorage.setItem('worktree-studio-minimap-size', String(size))
    }, 300)
  }, [size])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (dragging || resizing || draggingViewport) return
    const rect = viewRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const worldX = mx / scale + bounds.x
    const worldY = my / scale + bounds.y
    setViewport({
      x: window.innerWidth / 2 - worldX * viewport.zoom,
      y: window.innerHeight / 2 - worldY * viewport.zoom
    })
  }, [dragging, resizing, draggingViewport, scale, bounds, viewport.zoom, setViewport])

  const jumpToPanel = useCallback((id: string) => {
    const p = panels[id]
    if (!p) return
    selectPanel(id)
    const z = Math.max(viewport.zoom, 1)
    window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
    setViewport({
      zoom: z,
      x: window.innerWidth / 2 - (p.x + p.width / 2) * z,
      y: window.innerHeight / 2 - (p.y + p.height / 2) * z
    })
  }, [panels, selectPanel, setViewport, viewport.zoom])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }, [pos])

  const handleResizeStart = useCallback((corner: 'br' | 'tl') => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setResizing(corner)
    resizeStart.current = { x: e.clientX, y: e.clientY, s: size }
  }, [size])

  useEffect(() => {
    if (!dragging && !resizing && !draggingViewport) return

    const handleMouseMove = (e: MouseEvent) => {
      if (dragging) {
        const nextRight = dragStart.current.px - (e.clientX - dragStart.current.x)
        const nextBottom = dragStart.current.py - (e.clientY - dragStart.current.y)
        setPos({
          x: clamp(nextRight, EDGE_PADDING, window.innerWidth - size - EDGE_PADDING),
          y: clamp(nextBottom, EDGE_PADDING, window.innerHeight - size - EDGE_PADDING)
        })
      }
      if (resizing) {
        // br: drag right/down grows. tl: drag up/left grows (use signed avg of -dx -dy).
        const dx = e.clientX - resizeStart.current.x
        const dy = e.clientY - resizeStart.current.y
        const delta = resizing === 'br' ? (dx + dy) / 2 : -(dx + dy) / 2
        const newSize = clamp(resizeStart.current.s + delta, 200, 520)
        setSize(newSize)
      }
      if (draggingViewport) {
        const dx = (e.clientX - viewportDragStart.current.x) / scale
        const dy = (e.clientY - viewportDragStart.current.y) / scale
        setViewport({
          x: viewportDragStart.current.vx - dx * viewport.zoom,
          y: viewportDragStart.current.vy - dy * viewport.zoom
        })
      }
    }

    const handleMouseUp = () => {
      setDragging(false)
      setResizing(null)
      setDraggingViewport(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, resizing, draggingViewport, size, scale, setViewport, viewport.zoom])

  const handleViewportMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDraggingViewport(true)
    viewportDragStart.current = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y }
  }, [viewport.x, viewport.y])

  const panelArray = Object.values(panels)
  const panelCount = panelArray.length

  return (
    <div
      className={`minimap ${dragging ? 'dragging' : ''}`}
      ref={minimapRef}
      style={{ right: pos.x, bottom: pos.y, width: size, height: size }}
    >
      <div
        className="minimap-drag-handle"
        onMouseDown={handleDragStart}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mm-label">map</span>
        <span className="mm-stats">
          {panelCount}p · {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          className="mm-close"
          title="Hide minimap"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggleMinimap() }}
        >×</button>
      </div>
      <div
        className="minimap-view"
        ref={viewRef}
        style={{ width: viewSize, height: viewHeight }}
        onClick={handleClick}
      >
        <div
          className="minimap-content"
          style={{
            width: bounds.width * scale,
            height: bounds.height * scale,
            transform: `translate(${-bounds.x * scale}px, ${-bounds.y * scale}px)`
          }}
        >
          {panelArray.map(p => {
            const isSel = selectedPanelIds.includes(p.id)
            const isHover = hoverId === p.id
            const color = p.color || TYPE_COLORS[p.type] || '#555'
            return (
              <div
                key={p.id}
                className={`minimap-panel ${p.type === 'region' ? 'region' : ''} ${isSel ? 'selected' : ''} ${isHover ? 'hovered' : ''}`}
                style={{
                  left: p.x * scale,
                  top: p.y * scale,
                  width: Math.max(p.width * scale, MIN_PANEL_MARK),
                  height: Math.max(p.height * scale, MIN_PANEL_MARK),
                  background: p.type === 'region' ? 'transparent' : color,
                  borderColor: p.type === 'region' ? color : undefined,
                  opacity: p.minimized ? 0.4 : undefined
                }}
                title={`${p.title} (${p.type})`}
                onMouseEnter={() => setHoverId(p.id)}
                onMouseLeave={() => setHoverId(prev => prev === p.id ? null : prev)}
                onClick={(e) => { e.stopPropagation(); selectPanel(p.id) }}
                onDoubleClick={(e) => { e.stopPropagation(); jumpToPanel(p.id) }}
              />
            )
          })}
          {Object.entries(viewportBookmarks || {}).map(([numStr, bmViewport]) => {
            if (!bmViewport) return null
            const num = Number(numStr)
            const bmWorldX = (window.innerWidth / 2 - bmViewport.x) / bmViewport.zoom
            const bmWorldY = (window.innerHeight / 2 - bmViewport.y) / bmViewport.zoom
            return (
              <div
                key={`bm-${num}`}
                className="minimap-bookmark-dot"
                style={{
                  left: bmWorldX * scale,
                  top: bmWorldY * scale,
                }}
                title={`Bookmark ${num} (Alt+${num})`}
                onClick={(e) => {
                  e.stopPropagation()
                  useWorkspaceStore.getState().loadViewportBookmark(num)
                }}
              >
                {num}
              </div>
            )
          })}
        </div>
        <div
          className="minimap-viewport"
          onMouseDown={handleViewportMouseDown}
          style={{ left: vpX, top: vpY, width: vpW, height: vpH }}
        />
        {hoverId && panels[hoverId] && (
          <div className="minimap-tooltip">{panels[hoverId].title}</div>
        )}
      </div>
      <div
        className="minimap-resize-handle tl"
        onMouseDown={handleResizeStart('tl')}
        onClick={(e) => e.stopPropagation()}
        title="Resize"
      />
      <div
        className="minimap-resize-handle"
        onMouseDown={handleResizeStart('br')}
        onClick={(e) => e.stopPropagation()}
        title="Resize"
      />
    </div>
  )
}

export default Minimap
