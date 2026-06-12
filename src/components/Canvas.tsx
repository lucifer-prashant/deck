import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import Panel from './Panel'
import Minimap from './Minimap'
import CanvasContextMenu from './CanvasContextMenu'
import { confirmPanelsDeletion } from '../panelDeletion'
import AnnotationLayer from './AnnotationLayer'
import DrawingCanvas from './DrawingCanvas'
import AnnotateToolbar from './AnnotateToolbar'
import { executeWorkspaceCommand, getPanelDefaults, focusPanelById, shouldAutoFocusPanel } from '../workspaceCommands'
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

  const panels = useWorkspaceStore(s => s.panels)
  const selectedPanelIds = useWorkspaceStore(s => s.selectedPanelIds)
  const viewport = useWorkspaceStore(s => s.viewport)
  const minimapVisible = useWorkspaceStore(s => s.minimapVisible)
  const dragGuides = useWorkspaceStore(s => s.dragGuides)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const selectMultiple = useWorkspaceStore(s => s.selectMultiple)
  const clearSelection = useWorkspaceStore(s => s.clearSelection)
  const setViewport = useWorkspaceStore(s => s.setViewport)
  const setCursorWorldPos = useWorkspaceStore(s => s.setCursorWorldPos)
  const movePanel = useWorkspaceStore(s => s.movePanel)
  const resizePanel = useWorkspaceStore(s => s.resizePanel)
  const deletePanel = useWorkspaceStore(s => s.deletePanel)
  const annotateMode = useWorkspaceStore(s => s.annotateMode)
  const annotateTool = useWorkspaceStore(s => s.annotateTool)
  const prefs = useWorkspaceStore(s => s.prefs)
  const addPanel = useWorkspaceStore(s => s.addPanel)

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
    // Annotate mode: do not start panning or selection — drawing canvas handles it.
    if (useWorkspaceStore.getState().annotateMode) return
    // Middle-click panning works anywhere (even over panels).
    if (e.button === 1) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y })
      return
    }
    if (e.target === containerRef.current || e.target === contentRef.current || (e.target as HTMLElement).closest('.canvas-content') === contentRef.current) {
      if (e.button !== 0) return // Only left-click starts normal pan/select
      // Don't pan when clicking on annotation elements — they handle their own drag.
      if ((e.target as HTMLElement).closest('.anno-image, .anno-sticky, .anno-label')) return
      // Clear annotation selection on any empty-canvas click.
      useWorkspaceStore.getState().clearAnnotationSelection()
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

  const handleMouseMove = useCallback((e: React.MouseEvent | MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      lastMouseRef.current = { x: screenX, y: screenY }
      // Track world coordinates for panel spawning.
      const v = viewportRef.current
      setCursorWorldPos(
        (screenX - v.x) / v.zoom,
        (screenY - v.y) / v.zoom
      )
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
  }, [isPanning, panStart, selectionBox, setViewport, setCursorWorldPos])

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

      const state = useWorkspaceStore.getState()
      const tab = state.tabs.find(t => t.id === state.activeTabId)
      if (tab?.annotations) {
        const annotationIds = tab.annotations
          .filter(a => {
            if (a.type === 'freehand' || a.type === 'arrow' || a.type === 'rectangle' || a.type === 'highlight' || a.type === 'relationship') return false
            const aLeft = a.x * viewport.zoom + viewport.x
            const aTop = a.y * viewport.zoom + viewport.y
            const aRight = aLeft + (a.width || 40) * viewport.zoom
            const aBottom = aTop + (a.height || 18) * viewport.zoom
            return aRight >= selectionBox.x &&
              aLeft <= selectionBox.x + selectionBox.width &&
              aBottom >= selectionBox.y &&
              aTop <= selectionBox.y + selectionBox.height
          })
          .map(a => a.id)
        state.selectMultipleAnnotations(annotationIds)
      }

      setSelectionBox(null)
    }
    setIsPanning(false)
  }, [panels, selectMultiple, selectionBox, viewport])

  const handleMouseMoveRef = useRef(handleMouseMove)
  const handleMouseUpRef = useRef(handleMouseUp)
  useEffect(() => {
    handleMouseMoveRef.current = handleMouseMove
    handleMouseUpRef.current = handleMouseUp
  })

  const hasSelectionBox = !!selectionBox
  useEffect(() => {
    if (!hasSelectionBox && !isPanning) return

    const onMouseMove = (e: MouseEvent) => {
      handleMouseMoveRef.current(e)
    }

    const onMouseUp = () => {
      handleMouseUpRef.current()
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [hasSelectionBox, isPanning])

  // These are thin stable references — panel event handlers pass them as props.
  // Using the store actions directly since they are stable references from Zustand.
  const handlePanelSelect = selectPanel
  const handlePanelMove = movePanel
  const handlePanelResize = resizePanel

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

      const stateForOverlay = useWorkspaceStore.getState()
      const isOverlayOpen =
        stateForOverlay.settingsOpen ||
        stateForOverlay.commandPaletteOpen ||
        stateForOverlay.panelFinderOpen ||
        stateForOverlay.helpOpen ||
        stateForOverlay.globalSearchOpen ||
        stateForOverlay.winTabOpen ||
        stateForOverlay.panelSwitcherOpen
      if (isOverlayOpen) return

      // Hard block: while typing or while an embedded panel app is focused, no canvas shortcut fires.
      if (isTextInput || isInsidePanelBody) return

      if (e.key === 'Escape') {
        const s2 = useWorkspaceStore.getState()
        if (s2.selectedAnnotationIds.length > 0) {
          s2.clearAnnotationSelection()
          return
        }
        clearSelection()
        return
      }

      // F key — focus selected annotation (fly viewport to it).
      if (!isTextInput && (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const s = useWorkspaceStore.getState()
        if (s.selectedAnnotationIds.length > 0) {
          e.preventDefault()
          const tab = s.tabs.find(t => t.id === s.activeTabId)
          const a = tab?.annotations?.find(aa => aa.id === s.selectedAnnotationIds[0])
          if (a) {
            const ax = a.x + (a.width || 100) / 2
            const ay = a.y + (a.height || 24) / 2
            window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
            s.setViewport({
              zoom: 1,
              x: window.innerWidth / 2 - ax,
              y: window.innerHeight / 2 - ay
            })
          }
          return
        }
      }

      if (!isTextInput && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        const s = useWorkspaceStore.getState()
        if (s.selectedAnnotationIds.length > 0) {
          s.selectedAnnotationIds.forEach(id => s.deleteAnnotation(id))
          s.clearAnnotationSelection()
          return
        }
        deleteSelectedPanelsWithConfirmation()
        return
      }

      // Ctrl+Arrow → move selected annotation(s).
      if (!isTextInput && (e.ctrlKey || e.metaKey) && !e.altKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const s = useWorkspaceStore.getState()
        if (s.selectedAnnotationIds.length > 0) {
          e.preventDefault()
          const step = e.shiftKey ? 80 : 20
          const tab = s.tabs.find(t => t.id === s.activeTabId)
          if (!tab?.annotations) return
          s.selectedAnnotationIds.forEach(id => {
            const a = tab.annotations!.find(aa => aa.id === id)
            if (!a) return
            let dx = 0, dy = 0
            if (e.key === 'ArrowRight') dx = step
            else if (e.key === 'ArrowLeft') dx = -step
            else if (e.key === 'ArrowDown') dy = step
            else if (e.key === 'ArrowUp') dy = -step
            s.updateAnnotation(id, { x: a.x + dx, y: a.y + dy })
          })
          return
        }
        // Fall through to panel move handler below.
      }

      // Alt+Arrow → resize selected annotation(s).
      if (!isTextInput && e.altKey && !e.ctrlKey && !e.metaKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const s = useWorkspaceStore.getState()
        if (s.selectedAnnotationIds.length > 0) {
          e.preventDefault()
          const step = 20
          const sign = e.shiftKey ? -1 : 1
          const tab = s.tabs.find(t => t.id === s.activeTabId)
          if (!tab?.annotations) return
          s.selectedAnnotationIds.forEach(id => {
            const a = tab.annotations!.find(aa => aa.id === id)
            if (!a) return
            let { x, y, width, height } = a
            const w = Math.max(20, width || 0)
            const h = Math.max(20, height || 0)
            if (e.key === 'ArrowRight') width = w + step * sign
            else if (e.key === 'ArrowLeft') { width = w + step * sign; x -= step * sign }
            else if (e.key === 'ArrowDown') height = h + step * sign
            else if (e.key === 'ArrowUp') { height = h + step * sign; y -= step * sign }
            s.updateAnnotation(id, { x, y, width: Math.max(20, width), height: Math.max(20, height) })
          })
          return
        }
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
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      lastMouseRef.current = { x: screenX, y: screenY }
      // Track world coordinates for panel spawning.
      const v = viewportRef.current
      setCursorWorldPos(
        (screenX - v.x) / v.zoom,
        (screenY - v.y) / v.zoom
      )
    }
    window.addEventListener('mousemove', handler, { passive: true })
    return () => window.removeEventListener('mousemove', handler)
  }, [setCursorWorldPos])

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
    const cleanup = (window as any).electronAPI?.onTouchpadPinch?.(handler)
    return () => {
      if (cleanup) cleanup()
    }
  }, [zoomAtViewportPoint])

  // Paste onto canvas — image or text, at cursor position.
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.isContentEditable === true

      if (isTextInput) return

      const items = e.clipboardData?.items
      if (!items || items.length === 0) return

      // Compute world coordinates from last known mouse position.
      const last = lastMouseRef.current
      const rect = containerRef.current?.getBoundingClientRect()
      let worldX = 100, worldY = 100
      if (rect && last) {
        const v = useWorkspaceStore.getState().viewport
        worldX = (last.x - v.x) / v.zoom
        worldY = (last.y - v.y) / v.zoom
      }

      // Check for text first — simpler, synchronous, avoids multiple labels.
      const textData = e.clipboardData?.getData?.('text/plain')
      if (textData?.trim()) {
        e.preventDefault()
        const txt = textData.trim()
        const lines = txt.split('\n').length
        const estimatedW = Math.min(600, Math.max(300, Math.max(...txt.split('\n').map(l => l.length)) * 8))
        const id = `anno-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        useWorkspaceStore.getState().addAnnotation({
          id, type: 'label',
          x: worldX, y: worldY,
          width: estimatedW, height: lines > 1 ? lines * 20 : 0,
          text: txt, color: '',
          title: txt.slice(0, 40).replace(/\n/g, ' ')
        })
        return
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = async () => {
            const dataUrl = reader.result as string
            const base64 = dataUrl.split(',')[1]
            // Get actual image dimensions.
            const dims = await new Promise<{ w: number; h: number }>(resolve => {
              const img = new Image()
              img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
              img.onerror = () => resolve({ w: 400, h: 300 })
              img.src = dataUrl
            })
            const maxDim = 600
            const scale = Math.min(1, maxDim / Math.max(dims.w, dims.h, 1))
            const iw = Math.round(dims.w * scale)
            const ih = Math.round(dims.h * scale)
            const id = `anno-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const assetApi = (window as any).electronAPI?.fs // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!assetApi?.writeAsset) {
              useWorkspaceStore.getState().addAnnotation({
                id, type: 'image',
                x: worldX - iw / 2, y: worldY - ih / 2,
                width: iw, height: ih,
                text: '', color: '', filename: dataUrl,
                title: 'Image ' + id.slice(-6)
              })
              return
            }
            const res = await assetApi.writeAsset(base64, blob.name || 'paste.png')
            if (res?.ok) {
              useWorkspaceStore.getState().addAnnotation({
                id, type: 'image',
                x: worldX - iw / 2, y: worldY - ih / 2,
                width: iw, height: ih,
                text: '', color: '', filename: res.filename,
                title: 'Image ' + id.slice(-6)
              })
            }
          }
          reader.readAsDataURL(blob)
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // Drag & drop files or images onto canvas.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types || []
    if (types.includes('Files') || types.includes('application/x-wts-path')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    const customData = e.dataTransfer?.getData('application/x-wts-path')
    if (customData) {
      e.preventDefault()
      try {
        const parsed = JSON.parse(customData)
        const items = parsed.items ? (parsed.items as Array<{ path: string; isDir: boolean }>) : [parsed]
        if (items && items.length > 0) {
          const rect = containerRef.current?.getBoundingClientRect()
          const dropX = rect ? (e.clientX - rect.left - viewport.x) / viewport.zoom : 100
          const dropY = rect ? (e.clientY - rect.top - viewport.y) / viewport.zoom : 100
          const cols = Math.ceil(Math.sqrt(items.length))
          const GAP = 24

          items.forEach((item, idx) => {
            const row = Math.floor(idx / cols)
            const col = idx % cols
            const path = item.path
            const isDir = item.isDir
            const name = path.split('/').filter(Boolean).pop() || ''
            const ext = name.split('.').pop()?.toLowerCase() || ''
            const isImage = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext) && !isDir
            const isPdf = ext === 'pdf' && !isDir

            if (isImage) {
              const iw = 320, ih = 240
              const x = dropX + col * (iw + GAP) - (items.length === 1 ? iw / 2 : 0)
              const y = dropY + row * (ih + GAP) - (items.length === 1 ? ih / 2 : 0)
              const id = `anno-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`
              useWorkspaceStore.getState().addAnnotation({
                id, type: 'image',
                x, y, width: iw, height: ih,
                text: '', color: '', filename: `local-file://${path}`,
                title: name
              })
              useWorkspaceStore.getState().selectAnnotation(id)
            } else {
              let panelType: 'editor' | 'terminal' | 'browser' = 'editor'
              let w = 800, h = 500
              let settings: Record<string, unknown> = {}

              if (isDir) {
                panelType = 'terminal'
                w = 600
                h = 400
                settings = { cwd: path }
              } else if (isPdf) {
                panelType = 'browser'
                w = 720
                h = 560
                settings = {
                  browserTabs: [{ id: `bt-${Date.now()}-${idx}`, url: `local-file://${path}`, title: name, zoom: 0 }],
                  browserActiveTabId: `bt-${Date.now()}-${idx}`,
                  kiosk: true
                }
              } else {
                panelType = 'editor'
                w = 800
                h = 500
                settings = { filePath: path, folderPath: path.replace(/\/[^/]*$/, '') }
              }

              const x = dropX + col * (w + GAP) - (items.length === 1 ? w / 2 : 0)
              const y = dropY + row * (h + GAP) - (items.length === 1 ? h / 2 : 0)

              const id = `panel-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`
              useWorkspaceStore.getState().addPanel({
                id, type: panelType,
                x, y, width: w, height: h,
                title: panelType === 'editor' ? 'Editor' : name,
                settings,
                createdAt: Date.now()
              })
              useWorkspaceStore.getState().selectPanel(id)
            }
          })
          return
        }
      } catch (err) {
        console.error('Failed to parse dropped file custom data', err)
      }
    }

    const files = e.dataTransfer?.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) continue
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1]
        const rect = containerRef.current?.getBoundingClientRect()
        const dropX = rect ? (e.clientX - rect.left - viewport.x) / viewport.zoom : 100
        const dropY = rect ? (e.clientY - rect.top - viewport.y) / viewport.zoom : 100
        const assetApi = (window as any).electronAPI?.fs // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!assetApi?.writeAsset) {
          const id = `anno-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          useWorkspaceStore.getState().addAnnotation({
            id, type: 'image',
            x: dropX, y: dropY, width: 300, height: 200,
            text: '', color: '', filename: dataUrl,
            title: 'Image ' + id.slice(-6)
          })
          return
        }
        const res = await assetApi.writeAsset(base64, file.name)
        if (res?.ok) {
          const id = `anno-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          useWorkspaceStore.getState().addAnnotation({
            id, type: 'image',
            x: dropX, y: dropY, width: 300, height: 200,
            text: '', color: '', filename: res.filename,
            title: 'Image ' + id.slice(-6)
          })
        }
      }
      reader.readAsDataURL(file)
    }
  }, [viewport.x, viewport.y, viewport.zoom])

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
      className={`canvas-container bg-${prefs.canvasGridStyle ?? 'none'} ${isPanning ? 'grabbing' : ''} ${selectionBox ? 'selection-active' : ''} ${annotateMode ? `annotating annotate-${annotateTool}` : ''}`}
      style={{
        backgroundImage: prefs.canvasBgImage ? `url(${prefs.canvasBgImage})` : undefined,
        backgroundSize: prefs.canvasBgImage ? 'cover' : undefined,
        backgroundPosition: prefs.canvasBgImage ? 'center' : undefined,
        ['--canvas-bg-color' as string]: prefs.canvasBgColor || undefined,
        ['--canvas-grid-size' as string]: `${prefs.canvasGridSize ?? 20}px`,
        ['--canvas-grid-major' as string]: `${(prefs.canvasGridSize ?? 20) * 5}px`,
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement
        if (
          target.closest('.panel') ||
          target.closest('.minimap') ||
          target.closest('.annotate-toolbar') ||
          target.closest('.status-bar') ||
          target.closest('.workspace-chrome')
        ) return

        const option = prefs.doubleClickToCreate || 'none'
        if (option === 'none') return

        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const worldX = (e.clientX - rect.left - viewport.x) / viewport.zoom
        const worldY = (e.clientY - rect.top - viewport.y) / viewport.zoom

        const defaults = getPanelDefaults(option)
        if (!defaults) return
        const id = `${option}-${Date.now()}`
        const newPanel = {
          id,
          type: option,
          x: worldX - defaults.width / 2,
          y: worldY - defaults.height / 2,
          ...defaults
        }
        addPanel(newPanel)
        selectPanel(id)

        if (shouldAutoFocusPanel(option)) {
          setTimeout(() => {
            focusPanelById(id)
          }, 50)
        }
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
            annotateMode={annotateMode}
            onSelect={handlePanelSelect}
            onMove={handlePanelMove}
            onResize={handlePanelResize}
          />
        ))}
        <DrawingCanvas />
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
      <AnnotateToolbar />
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
