import React, { useRef, useEffect, useCallback, useMemo } from 'react'
import { useWorkspaceStore, Point } from '../store/workspaceStore'
import { getAnchorPoint, generateWigglyPath, generateArrowhead } from '../annotationUtils'
import type { Annotation, Panel } from '../store/workspaceStore'

const MIN_POINTS_FOR_STROKE = 2
const MARGIN = 400
const SNAP_RADIUS = 25

function generateId() {
  return `anno-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const DrawingCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewport = useWorkspaceStore(s => s.viewport)
  const annotateMode = useWorkspaceStore(s => s.annotateMode)
  const annotateTool = useWorkspaceStore(s => s.annotateTool)
  const annotationsVisible = useWorkspaceStore(s => s.annotationsVisible)
  const annotationsBehindPanels = useWorkspaceStore(s => s.annotationsBehindPanels)
  const drawColor = useWorkspaceStore(s => s.drawColor)
  const drawStrokeWidth = useWorkspaceStore(s => s.drawStrokeWidth)
  const panels = useWorkspaceStore(s => s.panels)
  const annotations = useWorkspaceStore(s =>
    s.tabs.find(t => t.id === s.activeTabId)?.annotations || []
  )
  const addAnnotation = useWorkspaceStore(s => s.addAnnotation)
  const deleteAnnotation = useWorkspaceStore(s => s.deleteAnnotation)

  const drawingAnnotations = annotations.filter(a =>
    a.type === 'freehand' || a.type === 'arrow' || a.type === 'rectangle' || a.type === 'highlight'
  )

  const drawingStateRef = useRef<{
    active: boolean
    points: Point[]
    startPoint: Point | null
    captured: boolean
    erasedIds: Set<string>
    startSnap?: { panelId: string; anchor: string; edgePos?: number; point: Point }
    endSnap?: { panelId: string; anchor: string; edgePos?: number; point: Point }
  }>({ active: false, points: [], startPoint: null, captured: false, erasedIds: new Set() })

  const eraserHoverRef = useRef<string | null>(null)

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const container = canvasRef.current?.parentElement?.parentElement
    const rect = container?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const v = viewport
    return {
      x: (clientX - rect.left - v.x) / v.zoom,
      y: (clientY - rect.top - v.y) / v.zoom
    }
  }, [viewport])

  const { canvasW, canvasH, canvasX, canvasY } = useMemo(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const v = viewport
    const ww = vw / v.zoom
    const wh = vh / v.zoom
    return {
      canvasX: Math.floor(-v.x / v.zoom - MARGIN),
      canvasY: Math.floor(-v.y / v.zoom - MARGIN),
      canvasW: Math.ceil(ww + MARGIN * 2),
      canvasH: Math.ceil(wh + MARGIN * 2)
    }
  }, [viewport])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!annotationsVisible) return
    const ox = canvasX
    const oy = canvasY
    drawingAnnotations.forEach(a => {
      ctx.save()
      ctx.translate(-ox, -oy)
      if (a.type === 'freehand') drawFreehand(ctx, a)
      else if (a.type === 'arrow') drawArrow(ctx, a, panels)
      else if (a.type === 'rectangle') drawRectangle(ctx, a)
      else if (a.type === 'highlight') drawHighlight(ctx, a)
      ctx.restore()
    })
  }, [drawingAnnotations, annotationsVisible, canvasX, canvasY, panels])

  useEffect(() => { draw() }, [draw, viewport.x, viewport.y, viewport.zoom])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        panelId: string; anchor: string; edgePos: number; screenX: number; screenY: number
      }
      const pt = screenToWorld(detail.screenX, detail.screenY)
      const current = drawingStateRef.current
      if (current.active && current.startSnap) {
        const s = current.startSnap
        const sp = current.startPoint!
        const annotation: Annotation = {
          id: generateId(),
          type: 'arrow',
          x: Math.min(sp.x, pt.x), y: Math.min(sp.y, pt.y),
          width: Math.abs(pt.x - sp.x), height: Math.abs(pt.y - sp.y),
          text: '', color: drawColor,
          startX: sp.x, startY: sp.y,
          endX: pt.x, endY: pt.y,
          startPanelId: s.panelId,
          startAnchor: s.anchor as Annotation['startAnchor'],
          startEdgePos: s.edgePos,
          endPanelId: detail.panelId,
          endAnchor: detail.anchor as Annotation['endAnchor'],
          endEdgePos: detail.edgePos,
          strokeWidth: drawStrokeWidth
        }
        addAnnotation(annotation)
        drawingStateRef.current = { active: false, points: [], startPoint: null, captured: false, erasedIds: new Set() }
        draw()
        return
      }
      drawingStateRef.current = {
        active: true, points: [], captured: false, erasedIds: new Set(),
        startPoint: pt,
        startSnap: { panelId: detail.panelId, anchor: detail.anchor, edgePos: detail.edgePos, point: pt }
      }
    }
    window.addEventListener('deck:arrow-port-click', handler)
    return () => window.removeEventListener('deck:arrow-port-click', handler)
  }, [screenToWorld, drawColor, drawStrokeWidth, draw, addAnnotation])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!annotateMode) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    drawingStateRef.current.captured = true

    const w = screenToWorld(e.clientX, e.clientY)

    if (annotateTool === 'arrow') {
      if (drawingStateRef.current.active && drawingStateRef.current.startSnap) {
        const s = drawingStateRef.current.startSnap
        const sp = drawingStateRef.current.startPoint!
        const endSnap = snapToPanelEdge(w)
        const endPt = endSnap ? endSnap.point : w
        const annotation: Annotation = {
          id: generateId(),
          type: 'arrow',
          x: Math.min(sp.x, endPt.x), y: Math.min(sp.y, endPt.y),
          width: Math.abs(endPt.x - sp.x), height: Math.abs(endPt.y - sp.y),
          text: '', color: drawColor,
          startX: sp.x, startY: sp.y,
          endX: endPt.x, endY: endPt.y,
          startPanelId: s.panelId,
          startAnchor: s.anchor as Annotation['startAnchor'],
          startEdgePos: s.edgePos,
          endPanelId: endSnap?.panelId,
          endAnchor: endSnap?.anchor as Annotation['endAnchor'],
          endEdgePos: endSnap?.edgePos,
          strokeWidth: drawStrokeWidth
        }
        addAnnotation(annotation)
        drawingStateRef.current = { active: false, points: [], startPoint: null, captured: false, erasedIds: new Set() }
        return
      }
      const snap = snapToPanelEdge(w)
      drawingStateRef.current = {
        active: true, points: [], captured: true, erasedIds: new Set(),
        startPoint: snap ? snap.point : w,
        startSnap: snap || undefined
      }
      return
    }

    if (annotateTool === 'eraser') {
      drawingStateRef.current = { active: true, points: [], startPoint: null, captured: true, erasedIds: new Set() }
      const hit = hitTest(w, drawingAnnotations)
      if (hit) {
        drawingStateRef.current.erasedIds.add(hit.id)
        deleteAnnotation(hit.id)
      }
      return
    }

    if (annotateTool === 'freehand') {
      drawingStateRef.current = { active: true, points: [w], startPoint: null, captured: true, erasedIds: new Set() }
      return
    }
    if (annotateTool === 'rectangle' || annotateTool === 'highlight') {
      drawingStateRef.current = { active: true, points: [], startPoint: w, captured: true, erasedIds: new Set() }
      return
    }
  }, [annotateMode, annotateTool, screenToWorld, drawingAnnotations, deleteAnnotation, addAnnotation, drawColor, drawStrokeWidth])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!annotateMode) return
    const w = screenToWorld(e.clientX, e.clientY)

    if (annotateTool === 'eraser' && !drawingStateRef.current.active) {
      const hit = hitTest(w, drawingAnnotations)
      if (hit?.id !== eraserHoverRef.current) {
        eraserHoverRef.current = hit?.id || null
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        draw()
        if (hit) {
          ctx.save()
          ctx.translate(-canvasX, -canvasY)
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)'
          ctx.lineWidth = 1.5
          ctx.setLineDash([3, 3])
          if (hit.type === 'freehand' && hit.pathData) {
            for (const stroke of hit.pathData) {
              const bb = strokeBbox(stroke)
              if (bb) ctx.strokeRect(bb.x - 3, bb.y - 3, bb.width + 6, bb.height + 6)
            }
          } else if (hit.type === 'arrow') {
            const panelsState = useWorkspaceStore.getState().panels
            const pts = resolveArrowRoute(hit, panelsState)
            if (pts.length >= 2) {
              const minX = Math.min(...pts.map(p => p.x)) - 4
              const minY = Math.min(...pts.map(p => p.y)) - 4
              const maxX = Math.max(...pts.map(p => p.x)) + 4
              const maxY = Math.max(...pts.map(p => p.y)) + 4
              ctx.strokeRect(minX, minY, maxX - minX, maxY - minY)
            }
          } else if (hit.type === 'rectangle' || hit.type === 'highlight') {
            ctx.strokeRect(hit.x - 3, hit.y - 3, hit.width + 6, hit.height + 6)
          }
          ctx.restore()
        }
      }
      return
    }

    if (annotateTool === 'eraser' && drawingStateRef.current.active) {
      const hit = hitTest(w, drawingAnnotations)
      if (hit && !drawingStateRef.current.erasedIds.has(hit.id)) {
        drawingStateRef.current.erasedIds.add(hit.id)
        deleteAnnotation(hit.id)
      }
      return
    }

    if (!drawingStateRef.current.active) return

    if (annotateTool === 'freehand') {
      drawingStateRef.current.points.push(w)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      draw()
      const pts = drawingStateRef.current.points
      if (pts.length < 2) return
      ctx.save()
      ctx.translate(-canvasX, -canvasY)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
      ctx.restore()
      return
    }

    const { startPoint } = drawingStateRef.current
    if (!startPoint) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    draw()

    ctx.save()
    ctx.translate(-canvasX, -canvasY)
    ctx.globalAlpha = 0.5
    if (annotateTool === 'arrow') {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      const pathStr = generateWigglyPath(startPoint.x, startPoint.y, w.x, w.y, 0.2)
      ctx.stroke(new Path2D(pathStr))
    } else if (annotateTool === 'rectangle') {
      const x = Math.min(startPoint.x, w.x)
      const y = Math.min(startPoint.y, w.y)
      const wd = Math.abs(w.x - startPoint.x)
      const ht = Math.abs(w.y - startPoint.y)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, wd, ht)
    } else if (annotateTool === 'highlight') {
      const x = Math.min(startPoint.x, w.x)
      const y = Math.min(startPoint.y, w.y)
      const wd = Math.abs(w.x - startPoint.x)
      const ht = Math.abs(w.y - startPoint.y)
      ctx.fillStyle = 'rgba(255, 221, 0, 0.35)'
      ctx.fillRect(x, y, wd, ht)
    }
    ctx.restore()
  }, [annotateMode, annotateTool, screenToWorld, draw, canvasX, canvasY, drawingAnnotations, deleteAnnotation])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const state = drawingStateRef.current
    drawingStateRef.current = { active: false, points: [], startPoint: null, captured: false, erasedIds: new Set() }
    if (!annotateMode) return

    const w = screenToWorld(e.clientX, e.clientY)

    if (annotateTool === 'freehand') {
      const pts = state.points
      if (pts.length < MIN_POINTS_FOR_STROKE) return
      const smoothed = smoothStroke(pts)
      const annotation: Annotation = {
        id: generateId(),
        type: 'freehand',
        x: 0, y: 0, width: 0, height: 0,
        text: '', color: drawColor,
        pathData: [smoothed],
        strokeWidth: drawStrokeWidth
      }
      addAnnotation(annotation)
      return
    }

    if (annotateTool === 'arrow' && state.startPoint) {
      const endSnap = snapToPanelEdge(w)
      const endPt = endSnap ? endSnap.point : w
      const annotation: Annotation = {
        id: generateId(),
        type: 'arrow',
        x: Math.min(state.startPoint.x, endPt.x),
        y: Math.min(state.startPoint.y, endPt.y),
        width: Math.abs(endPt.x - state.startPoint.x),
        height: Math.abs(endPt.y - state.startPoint.y),
        text: '', color: drawColor,
        startX: state.startPoint.x, startY: state.startPoint.y,
        endX: endPt.x, endY: endPt.y,
        startPanelId: state.startSnap?.panelId,
        startAnchor: state.startSnap?.anchor as Annotation['startAnchor'],
        startEdgePos: state.startSnap?.edgePos,
        endPanelId: endSnap?.panelId,
        endAnchor: endSnap?.anchor as Annotation['endAnchor'],
        endEdgePos: endSnap?.edgePos,
        strokeWidth: drawStrokeWidth
      }
      addAnnotation(annotation)
      return
    }

    if ((annotateTool === 'rectangle' || annotateTool === 'highlight') && state.startPoint) {
      const x = Math.min(state.startPoint.x, w.x)
      const y = Math.min(state.startPoint.y, w.y)
      const wd = Math.abs(w.x - state.startPoint.x)
      const ht = Math.abs(w.y - state.startPoint.y)
      if (wd < 4 || ht < 4) return

      const annotation: Annotation = {
        id: generateId(),
        type: annotateTool,
        x, y, width: wd, height: ht,
        text: '', color: '',
        strokeColor: annotateTool === 'rectangle' ? drawColor : undefined,
        fillOpacity: annotateTool === 'highlight' ? 0.35 : undefined
      }
      if (annotateTool === 'highlight') annotation.color = drawColor
      addAnnotation(annotation)
      return
    }

    draw()
  }, [annotateMode, annotateTool, screenToWorld, addAnnotation, draw, drawColor, drawStrokeWidth])

  const isDrawingTool = annotateMode &&
    (annotateTool === 'freehand' || annotateTool === 'arrow' ||
     annotateTool === 'rectangle' || annotateTool === 'highlight' || annotateTool === 'eraser')

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      style={{
        position: 'absolute',
        top: canvasY,
        left: canvasX,
        pointerEvents: isDrawingTool ? 'auto' : 'none',
        zIndex: annotationsBehindPanels ? 0 : 3
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

function hitTest(point: Point, annotations: Annotation[]): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (a.type === 'freehand') {
      if (a.pathData) {
        for (const stroke of a.pathData) {
          const bb = strokeBbox(stroke)
          if (bb && pointInRect(point, bb)) return a
        }
      }
      continue
    }
    if (a.type === 'arrow') {
      const panelsState = useWorkspaceStore.getState().panels
      const pts = resolveArrowRoute(a, panelsState)
      if (pts.length < 2) return false
      const minX = Math.min(...pts.map(p => p.x)) - 6
      const minY = Math.min(...pts.map(p => p.y)) - 6
      const maxX = Math.max(...pts.map(p => p.x)) + 6
      const maxY = Math.max(...pts.map(p => p.y)) + 6
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        // Broad phase box check passed; check segments
        for (let i = 0; i < pts.length - 1; i++) {
          const pA = pts[i]
          const pB = pts[i + 1]
          const dist = distToSegment(point, pA, pB)
          if (dist < 8) return true
        }
      }
      return false
    }
    if (a.type === 'rectangle' || a.type === 'highlight') {
      if (pointInRect(point, { x: a.x, y: a.y, width: a.width, height: a.height })) return a
    }
  }
  return null
}

interface Bbox { x: number; y: number; width: number; height: number }

function strokeBbox(points: Point[]): Bbox | null {
  if (points.length === 0) return null
  let minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function pointInRect(p: Point, r: Bbox): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function drawFreehand(ctx: CanvasRenderingContext2D, a: Annotation) {
  if (!a.strokeWidth) return
  ctx.strokeStyle = a.color || '#ffffff'
  ctx.lineWidth = a.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const strokes = a.pathData || []
  strokes.forEach(stroke => {
    if (stroke.length < 2) return
    ctx.beginPath()
    ctx.moveTo(stroke[0].x, stroke[0].y)
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y)
    ctx.stroke()
  })
}

function resolveArrowRoute(a: Annotation, panels: Record<string, Panel>): Point[] {
  let startX = a.startX, startY = a.startY
  let endX = a.endX, endY = a.endY
  if (a.startPanelId) {
    const p = panels[a.startPanelId]
    if (p) {
      const anchor = getAnchorPoint(p, a.startAnchor || 'center', a.startEdgePos ?? 0.5)
      startX = anchor.x; startY = anchor.y
    }
  }
  if (a.endPanelId) {
    const p = panels[a.endPanelId]
    if (p) {
      const anchor = getAnchorPoint(p, a.endAnchor || 'center', a.endEdgePos ?? 0.5)
      endX = anchor.x; endY = anchor.y
    }
  }
  if (startX == null || startY == null || endX == null || endY == null) return []
  
  const start = { x: startX, y: startY }
  const end = { x: endX, y: endY }

  const obstacles = Object.values(panels)
    .filter(p => p.type !== 'region' && p.id !== a.startPanelId && p.id !== a.endPanelId)
    .map(p => {
      const pad = 16
      const h = p.minimized ? 34 : p.height
      return {
        id: p.id,
        x1: p.x - pad,
        y1: p.y - pad,
        x2: p.x + p.width + pad,
        y2: p.y + h + pad
      }
    })

  let clear = true
  for (const obs of obstacles) {
    if (lineIntersectsAABB(start, end, obs)) {
      clear = false
      break
    }
  }
  if (clear) return [start, end]

  const V: Point[] = [start, end]
  obstacles.forEach(obs => {
    V.push({ x: obs.x1, y: obs.y1 })
    V.push({ x: obs.x2, y: obs.y1 })
    V.push({ x: obs.x2, y: obs.y2 })
    V.push({ x: obs.x1, y: obs.y2 })
  })

  const padSize = 16
  if (a.startPanelId && panels[a.startPanelId]) {
    const p = panels[a.startPanelId]
    if (p.type !== 'region') {
      const h = p.minimized ? 34 : p.height
      V.push({ x: p.x - padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y + h + padSize })
      V.push({ x: p.x - padSize, y: p.y + h + padSize })
    }
  }
  if (a.endPanelId && panels[a.endPanelId]) {
    const p = panels[a.endPanelId]
    if (p.type !== 'region') {
      const h = p.minimized ? 34 : p.height
      V.push({ x: p.x - padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y + h + padSize })
      V.push({ x: p.x - padSize, y: p.y + h + padSize })
    }
  }

  const n = V.length
  const dist = new Array(n).fill(Infinity)
  const prev = new Array(n).fill(-1)
  const visited = new Array(n).fill(false)
  dist[0] = 0

  for (let step = 0; step < n; step++) {
    let u = -1
    let minDist = Infinity
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i] < minDist) {
        minDist = dist[i]
        u = i
      }
    }
    if (u === -1) break
    if (u === 1) break

    visited[u] = true
    for (let v = 0; v < n; v++) {
      if (visited[v]) continue
      const d = Math.hypot(V[v].x - V[u].x, V[v].y - V[u].y)
      if (isVisible(V[u], V[v], obstacles)) {
        const newDist = dist[u] + d
        if (newDist < dist[v]) {
          dist[v] = newDist
          prev[v] = u
        }
      }
    }
  }

  if (dist[1] === Infinity) return [start, end]

  const path: Point[] = []
  let curr = 1
  while (curr !== -1) {
    path.push(V[curr])
    curr = prev[curr]
  }
  path.reverse()
  return path
}

function isVisible(p1: Point, p2: Point, obstacles: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>): boolean {
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1.0) return true
  for (const obs of obstacles) {
    let checkP1 = p1
    let checkP2 = p2
    const isCorner1 = (p1.x === obs.x1 || p1.x === obs.x2) && (p1.y === obs.y1 || p1.y === obs.y2)
    const isCorner2 = (p2.x === obs.x1 || p2.x === obs.x2) && (p2.y === obs.y1 || p2.y === obs.y2)
    if (isCorner1 || isCorner2) {
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      if (isCorner1) checkP1 = { x: p1.x + dx * 0.05, y: p1.y + dy * 0.05 }
      if (isCorner2) checkP2 = { x: p2.x - dx * 0.05, y: p2.y - dy * 0.05 }
    }
    if (lineIntersectsAABB(checkP1, checkP2, obs)) return false
  }
  return true
}

function lineIntersectsAABB(p1: Point, p2: Point, box: { x1: number; y1: number; x2: number; y2: number }): boolean {
  let t0 = 0.0
  let t1 = 1.0
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const edges = [
    [-dx, p1.x - box.x1],
    [dx, box.x2 - p1.x],
    [-dy, p1.y - box.y1],
    [dy, box.y2 - p1.y]
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t0 <= t1
}

function generateRoundedPath(path: Point[], radius: number = 12): string {
  if (path.length === 0) return ''
  if (path.length === 1) return `M ${path[0].x} ${path[0].y}`
  if (path.length === 2) return `M ${path[0].x} ${path[0].y} L ${path[1].x} ${path[1].y}`
  let d = `M ${path[0].x} ${path[0].y}`
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    const next = path[i + 1]
    const dx1 = prev.x - curr.x
    const dy1 = prev.y - curr.y
    const d1 = Math.hypot(dx1, dy1) || 1
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    const d2 = Math.hypot(dx2, dy2) || 1
    const r = Math.min(radius, d1 / 2, d2 / 2)
    const startX = curr.x + (dx1 / d1) * r
    const startY = curr.y + (dy1 / d1) * r
    const endX = curr.x + (dx2 / d2) * r
    const endY = curr.y + (dy2 / d2) * r
    d += ` L ${startX} ${startY} Q ${curr.x} ${curr.y}, ${endX} ${endY}`
  }
  const last = path[path.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const l2 = Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Annotation, panels: Record<string, Panel>) {
  const path = resolveArrowRoute(a, panels)
  if (path.length < 2) return
  const endPt = path[path.length - 1]
  const secondToLast = path[path.length - 2]
  const color = a.color || '#ffffff'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = a.strokeWidth || 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (a.dashed) ctx.setLineDash([6, 4])
  else ctx.setLineDash([])

  const pathStr = generateRoundedPath(path, 16)
  ctx.stroke(new Path2D(pathStr))

  const headPath = new Path2D(generateArrowhead(secondToLast.x, secondToLast.y, endPt.x, endPt.y))
  ctx.fill(headPath)

  if (a.arrowLabel) {
    const midIdx = Math.floor(path.length / 2)
    const pA = path[midIdx - 1]
    const pB = path[midIdx]
    const mx = (pA.x + pB.x) / 2
    const my = (pA.y + pB.y) / 2
    ctx.font = '12px sans-serif'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(a.arrowLabel, mx, my - 8)
  }
}

function drawRectangle(ctx: CanvasRenderingContext2D, a: Annotation) {
  ctx.strokeStyle = a.strokeColor || a.color || '#ffffff'
  ctx.lineWidth = 2
  ctx.setLineDash([])
  ctx.strokeRect(a.x, a.y, a.width, a.height)
}

function drawHighlight(ctx: CanvasRenderingContext2D, a: Annotation) {
  ctx.fillStyle = a.color || 'rgba(255, 221, 0, 0.3)'
  ctx.globalAlpha = a.fillOpacity || 0.35
  ctx.fillRect(a.x, a.y, a.width, a.height)
}

function smoothStroke(points: Point[]): Point[] {
  if (points.length < 3) return points
  const result: Point[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    result.push({ x: points[i].x, y: points[i].y })
    result.push({ x: mx, y: my })
  }
  result.push(points[points.length - 1])
  return result
}

function snapToPanelEdge(world: Point): { panelId: string; anchor: string; edgePos?: number; point: Point } | null {
  const panels = useWorkspaceStore.getState().panels
  let best: { panelId: string; anchor: string; edgePos?: number; point: Point; dist: number } | null = null

  for (const [id, p] of Object.entries(panels)) {
    if (p.type === 'region') continue
    const relX = world.x - p.x
    const relY = world.y - p.y
    const leftPos = clamp(relY / p.height, 0, 1)
    const rightPos = clamp(relY / p.height, 0, 1)
    const topPos = clamp(relX / p.width, 0, 1)
    const bottomPos = clamp(relX / p.width, 0, 1)

    const edges: Array<{ anchor: string; point: Point; edgePos: number }> = [
      { anchor: 'top',    point: { x: p.x + topPos * p.width, y: p.y },           edgePos: topPos },
      { anchor: 'bottom', point: { x: p.x + bottomPos * p.width, y: p.y + p.height }, edgePos: bottomPos },
      { anchor: 'left',   point: { x: p.x, y: p.y + leftPos * p.height },          edgePos: leftPos },
      { anchor: 'right',  point: { x: p.x + p.width, y: p.y + rightPos * p.height }, edgePos: rightPos },
    ]
    for (const e of edges) {
      const dx = world.x - e.point.x
      const dy = world.y - e.point.y
      const dist = Math.hypot(dx, dy)
      if (dist < SNAP_RADIUS && (!best || dist < best.dist)) {
        best = { panelId: id, anchor: e.anchor, edgePos: e.edgePos, point: e.point, dist }
      }
    }
  }
  return best ? { panelId: best.panelId, anchor: best.anchor, edgePos: best.edgePos, point: best.point } : null
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

export default DrawingCanvas
