import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import Panel from './Panel'
import Minimap from './Minimap'
import CanvasContextMenu from './CanvasContextMenu'
import { confirmPanelsDeletion } from '../panelDeletion'
import AnnotationLayer from './AnnotationLayer'
import { executeWorkspaceCommand } from '../workspaceCommands'
import './Canvas.css'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 10
const KEYBOARD_ZOOM_STEP = 1.12
const WHEEL_ZOOM_SENSITIVITY = 0.0018
const WHEEL_ZOOM_MAX_FACTOR = 1.18

const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

const Canvas: React.FC = () => {
  // Ref to track pinch gesture state
  const pinchRef = React.useRef<{ dist: number; midX: number; midY: number } | null>(null);
  // Ref to store the zoom level at the start of a native gesture (trackpad pinch on some browsers)
  const gestureZoomStart = React.useRef<number>(1);

  // Container reference for DOM measurements
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Track mouse position so keyboard zoom focuses on cursor
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [selectionBox, setSelectionBox] = useState<null | { startX: number; startY: number; x: number; y: number; width: number; height: number }>(null)
  const [canvasCtxMenu, setCanvasCtxMenu] = useState<null | { x: number; y: number; worldX: number; worldY: number }>(null)

  const {
    panels,
    selectedPanelIds,
    viewport,
    minimapVisible,
    dragGuides,
    selectPanel,
    selectMultiple,
    clearSelection,
    setViewport,
    movePanel,
    resizePanel,
    deletePanel
  } = useWorkspaceStore()

  // Keep a mutable ref of the current viewport for IPC handler
  const viewportRef = useRef(viewport)
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  const zoomAtViewportPoint = useCallback((pointX: number, pointY: number, nextZoom: number) => {
    const currentViewport = viewportRef.current
    const zoom = clampZoom(nextZoom)
    const worldX = (pointX - currentViewport.x) / currentViewport.zoom
    const worldY = (pointY - currentViewport.y) / currentViewport.zoom

    setViewport({
      x: pointX - worldX * zoom,
      y: pointY - worldY * zoom,
      zoom
    })
  }, [setViewport])

  const zoomAtCanvasCenter = useCallback((nextZoom: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    zoomAtViewportPoint(rect.width / 2, rect.height / 2, nextZoom)
  }, [zoomAtViewportPoint])

  const zoomByKeyboardCommand = useCallback((direction: 'in' | 'out' | 'reset') => {
    const currentZoom = viewportRef.current.zoom
    const nextZoom = direction === 'in'
      ? currentZoom * KEYBOARD_ZOOM_STEP
      : direction === 'out'
        ? currentZoom / KEYBOARD_ZOOM_STEP
        : 1

    // Prefer cursor as zoom focal point, fall back to canvas center.
    const rect = containerRef.current?.getBoundingClientRect()
    const m = lastMouseRef.current
    if (rect && m && m.x >= 0 && m.x <= rect.width && m.y >= 0 && m.y <= rect.height) {
      zoomAtViewportPoint(m.x, m.y, nextZoom)
    } else {
      zoomAtCanvasCenter(nextZoom)
    }
  }, [zoomAtCanvasCenter, zoomAtViewportPoint])

  // Electron native pinch gesture state
  const lastPinchScale = useRef<number>(1)
  const pinchActive = useRef<boolean>(false)
  const pinchTimer = useRef<NodeJS.Timeout | null>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const PAN_SPEED = 0.4

    // Read viewport from ref so rapid wheel events accumulate correctly. Using closure
    // viewport meant multiple wheel events within one React render all saw the same
    // stale zoom and effectively dropped intermediate steps.
    const live = viewportRef.current
    const isPinch = e.ctrlKey || e.metaKey;
    if (isPinch) {
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const factor = Math.max(
        1 / WHEEL_ZOOM_MAX_FACTOR,
        Math.min(WHEEL_ZOOM_MAX_FACTOR, 1 - e.deltaY * WHEEL_ZOOM_SENSITIVITY)
      )
      zoomAtViewportPoint(mouseX, mouseY, live.zoom * factor)
    } else {
      setViewport({
        x: live.x - e.deltaX * PAN_SPEED,
        y: live.y - e.deltaY * PAN_SPEED
      })
    }
  }, [setViewport, zoomAtViewportPoint])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle-click panning works anywhere (even over panels).
    if (e.button === 1) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y })
      return
    }
    if (e.target === containerRef.current || e.target === contentRef.current || (e.target as HTMLElement).closest('.canvas-content') === contentRef.current) {
      if (e.shiftKey) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        setSelectionBox({ startX: x, startY: y, x, y, width: 0, height: 0 })
        return
      }
      if (e.ctrlKey || e.metaKey) return
      setIsPanning(true)
      setPanStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y })
      clearSelection()
    }
  }, [viewport.x, viewport.y, clearSelection])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      lastMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    if (selectionBox) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const pointerX = e.clientX - rect.left
      const pointerY = e.clientY - rect.top
      setSelectionBox({
        ...selectionBox,
        x: Math.min(selectionBox.startX, pointerX),
        y: Math.min(selectionBox.startY, pointerY),
        width: Math.abs(pointerX - selectionBox.startX),
        height: Math.abs(pointerY - selectionBox.startY)
      })
      return
    }

    if (isPanning) {
      setViewport({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      })
    }
  }, [isPanning, panStart, selectionBox, setViewport])

  const handleMouseUp = useCallback(() => {
    if (selectionBox) {
      const selectedIds = Object.values(panels)
        .filter(panel => {
          const panelLeft = panel.x * viewport.zoom + viewport.x
          const panelTop = panel.y * viewport.zoom + viewport.y
          const panelRight = panelLeft + panel.width * viewport.zoom
          const panelBottom = panelTop + panel.height * viewport.zoom
          return panelRight >= selectionBox.x &&
            panelLeft <= selectionBox.x + selectionBox.width &&
            panelBottom >= selectionBox.y &&
            panelTop <= selectionBox.y + selectionBox.height
        })
        .map(panel => panel.id)
      selectMultiple(selectedIds)
      setSelectionBox(null)
    }
    setIsPanning(false)
  }, [panels, selectMultiple, selectionBox, viewport])

  const handlePanelSelect = useCallback((panelId: string, additive = false) => {
    selectPanel(panelId, additive)
  }, [selectPanel])

  const handlePanelMove = useCallback((panelId: string, x: number, y: number) => {
    movePanel(panelId, x, y)
  }, [movePanel])

  const handlePanelResize = useCallback((panelId: string, width: number, height: number) => {
    resizePanel(panelId, width, height)
  }, [resizePanel])

  const deleteSelectedPanelsWithConfirmation = useCallback(() => {
    if (selectedPanelIds.length === 0) return
    const targets = selectedPanelIds.map(id => panels[id]).filter(Boolean)
    if (!confirmPanelsDeletion(targets)) return
    selectedPanelIds.forEach(id => deletePanel(id))
  }, [selectedPanelIds, panels, deletePanel])

  // --- Touch pinch‑zoom handling -------------------------------------------------
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const midX = ((t1.clientX + t2.clientX) / 2) - rect.left
      const midY = ((t1.clientY + t2.clientY) / 2) - rect.top
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      const dist = Math.hypot(dx, dy)
      pinchRef.current = { dist, midX, midY }
      e.preventDefault()
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (pinchRef.current && e.touches.length === 2) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const midX = ((t1.clientX + t2.clientX) / 2) - rect.left
      const midY = ((t1.clientY + t2.clientY) / 2) - rect.top
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      const newDist = Math.hypot(dx, dy)

      const prev = pinchRef.current
      const factor = newDist / prev.dist

      zoomAtViewportPoint(midX, midY, viewport.zoom * factor)

      pinchRef.current = { dist: newDist, midX, midY }
      e.preventDefault()
    }
  }, [viewport.zoom, zoomAtViewportPoint])

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.isContentEditable === true
      // panel-body block check — but regions are NOT embedded apps; their body is
      // just empty/decorative, so canvas shortcuts (Del/F/etc) must still work
      // when a region is "focused" by body click.
      const targetPanelBody = target?.closest?.('.panel-body') as HTMLElement | null
      const activePanelBody = active?.closest?.('.panel-body') as HTMLElement | null
      const inRegionBody = (el: HTMLElement | null) =>
        !!el?.closest?.('.panel.panel-type-region')
      const isInsidePanelBody =
        ((!!targetPanelBody && !inRegionBody(targetPanelBody)) ||
         (!!activePanelBody && !inRegionBody(activePanelBody)) ||
         target?.tagName === 'WEBVIEW' ||
         active?.tagName === 'WEBVIEW')

      // Hard block: while typing or while an embedded panel app is focused, no canvas shortcut fires.
      if (isTextInput || isInsidePanelBody) return

      if (e.key === 'Escape') {
        clearSelection()
        return
      }

      if (!isTextInput && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        deleteSelectedPanelsWithConfirmation()
        return
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey) {
        return
      }

      const key = e.key.toLowerCase()
      // Zoom + reset always work, even inside text inputs.
      if (key === '=' || key === '+') {
        e.preventDefault()
        zoomByKeyboardCommand('in')
        return
      }
      if (key === '-' || key === '_') {
        e.preventDefault()
        zoomByKeyboardCommand('out')
        return
      }
      if (key === '0') {
        e.preventDefault()
        zoomByKeyboardCommand('reset')
        return
      }
      // Commands that conflict with text editing — only outside inputs.
      if (isTextInput) return
      if (key === 'a') {
        e.preventDefault()
        executeWorkspaceCommand('select-all')
      } else if (key === 'd' && e.shiftKey) {
        e.preventDefault()
        executeWorkspaceCommand('stack-selected')
      } else if (key === 'd') {
        e.preventDefault()
        executeWorkspaceCommand('duplicate-selected')
      } else if (key === 'g') {
        e.preventDefault()
        executeWorkspaceCommand(e.shiftKey ? 'ungroup-region' : 'group-region')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection, deleteSelectedPanelsWithConfirmation, zoomByKeyboardCommand])

  useEffect(() => {
    const removeListener = window.electronAPI?.onCanvasZoomCommand?.(zoomByKeyboardCommand)
    return () => removeListener?.()
  }, [zoomByKeyboardCommand])

  // Smooth transitions for programmatic viewport changes (fit, focus, reset).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onSmooth = () => {
      const el = contentRef.current
      if (!el) return
      el.classList.add('smooth')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => el.classList.remove('smooth'), 280)
    }
    window.addEventListener('wts-smooth-viewport', onSmooth)
    return () => {
      window.removeEventListener('wts-smooth-viewport', onSmooth)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Global mouse tracker so cursor-focused zoom works even when hovering panels.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      lastMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    window.addEventListener('mousemove', handler, { passive: true })
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  // Native gesture (trackpad pinch) fallback for browsers that emit gesture events
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleGestureStart = () => {
      gestureZoomStart.current = viewport.zoom
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleGestureChange = (e: any) => {
      const rect = container.getBoundingClientRect()
      const centerX = e.clientX - rect.left
      const centerY = e.clientY - rect.top
      zoomAtViewportPoint(centerX, centerY, gestureZoomStart.current * e.scale)
      e.preventDefault?.()
    }

    container.addEventListener('gesturestart', handleGestureStart)
    container.addEventListener('gesturechange', handleGestureChange)
    return () => {
      container.removeEventListener('gesturestart', handleGestureStart)
      container.removeEventListener('gesturechange', handleGestureChange)
    }
  }, [viewport.zoom, zoomAtViewportPoint])

  // Electron touchpad‑pinch handling
  useEffect(() => {
    const handler = (data: { scale: number; velocity: number; centerX: number; centerY: number }) => {
      // Reset active flag and scale after inactivity
      if (pinchTimer.current) clearTimeout(pinchTimer.current)
      pinchTimer.current = setTimeout(() => {
        pinchActive.current = false
        lastPinchScale.current = 1
      }, 100)

      if (!pinchActive.current) {
        pinchActive.current = true
        lastPinchScale.current = 1
      }

      const factor = data.scale / lastPinchScale.current
      const safeFactor = Math.max(0.3, Math.min(3, factor))
      const newZoom = clampZoom(viewportRef.current.zoom * safeFactor)

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const clientX = data.centerX - rect.left
      const clientY = data.centerY - rect.top

      zoomAtViewportPoint(clientX, clientY, newZoom)

      lastPinchScale.current = data.scale
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).electronAPI?.onTouchpadPinch?.(handler)
  }, [zoomAtViewportPoint])

  // Sort panels so regions render behind other panels. We still render detached
  // panels (they get visibility:hidden via the .detached class) so their state
  // — especially terminal xterm + pty stream — stays alive while popped out.
  // Hide panels that are stacked into another panel — the host renders their
  // body inline via the tab strip. Children kept mounted via host content slot.
  const sortedPanels = useMemo(() => Object.values(panels).filter(p => !p.stackParentId).sort((a, b) => {
    if (a.type === 'region' && b.type !== 'region') return -1
    if (a.type !== 'region' && b.type === 'region') return 1
    return 0
  }), [panels])

  // Viewport culling: panels whose screen-space rect sits completely outside the
  // window (with a generous margin) get marked offscreen. Panel applies CSS that
  // skips paint via visibility:hidden + content-visibility:hidden. State persists
  // because the React tree stays mounted — no terminal/webview unmount.
  const offscreenIds = useMemo(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 800  // px in screen space — keep nearby panels warm for fast scroll-in
    const ids = new Set<string>()
    sortedPanels.forEach(p => {
      const sx = p.x * viewport.zoom + viewport.x
      const sy = p.y * viewport.zoom + viewport.y
      const sw = p.width * viewport.zoom
      const sh = p.height * viewport.zoom
      if (sx + sw < -margin || sx > vw + margin || sy + sh < -margin || sy > vh + margin) {
        ids.add(p.id)
      }
    })
    return ids
  }, [sortedPanels, viewport.x, viewport.y, viewport.zoom])

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${isPanning ? 'grabbing' : ''}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement
        // Only show canvas context menu when right-clicking empty canvas, not a panel.
        if (target.closest('.panel')) return
        e.preventDefault()
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const worldX = (e.clientX - rect.left - viewport.x) / viewport.zoom
        const worldY = (e.clientY - rect.top - viewport.y) / viewport.zoom
        setCanvasCtxMenu({ x: e.clientX, y: e.clientY, worldX, worldY })
      }}
    >
      <div
        ref={contentRef}
        className={`canvas-content ${isPanning ? 'dragging' : ''}`}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        }}
      >
        {sortedPanels.map((panel) => (
          <Panel
            key={panel.id}
            panel={panel}
            isSelected={selectedPanelIds.includes(panel.id)}
            offscreen={offscreenIds.has(panel.id)}
            onSelect={handlePanelSelect}
            onMove={handlePanelMove}
            onResize={handlePanelResize}
          />
        ))}
        <AnnotationLayer />
        {dragGuides.map((g, i) => (
          <div
            key={i}
            className={`align-guide ${g.axis === 'x' ? 'v' : 'h'}`}
            style={g.axis === 'x'
              ? { left: g.world, top: -10000, height: 20000 }
              : { top: g.world, left: -10000, width: 20000 }
            }
          />
        ))}
      </div>
      {minimapVisible && <Minimap />}
      {canvasCtxMenu && (
        <CanvasContextMenu
          x={canvasCtxMenu.x}
          y={canvasCtxMenu.y}
          worldX={canvasCtxMenu.worldX}
          worldY={canvasCtxMenu.worldY}
          onClose={() => setCanvasCtxMenu(null)}
        />
      )}
      {selectionBox && (
        <div
          className="canvas-selection-box"
          style={{
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.width,
            height: selectionBox.height
          }}
        />
      )}
    </div>
  )
}

export default Canvas
