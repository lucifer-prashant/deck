import React, { useRef, useEffect, useCallback, useMemo } from 'react'
import { useWorkspaceStore, Point } from '../store/workspaceStore'
import { getAnchorPoint, generateWigglyPath, generateArrowhead, resolveConnectionRoute, generateRoundedPath, generateSmoothPath } from '../annotationUtils'
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

  const activePanelsRef = useRef<Record<string, Panel>>(panels)
  const addAnnotation = useWorkspaceStore(s => s.addAnnotation)
  const deleteAnnotation = useWorkspaceStore(s => s.deleteAnnotation)

  const drawingAnnotations = annotations.filter(a =>
    a.type === 'freehand' || a.type === 'arrow' || a.type === 'rectangle' || a.type === 'highlight' || a.type === 'relationship'
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
      else if (a.type === 'arrow') drawArrow(ctx, a, activePanelsRef.current)
      else if (a.type === 'rectangle') drawRectangle(ctx, a)
      else if (a.type === 'highlight') drawHighlight(ctx, a)
      ctx.restore()
    })
  }, [drawingAnnotations, annotationsVisible, canvasX, canvasY])

  useEffect(() => {
    activePanelsRef.current = panels
    draw()
  }, [panels, draw, annotateMode, annotateTool, annotationsVisible, annotations])

  useEffect(() => {
    const handler = (e: Event) => {
      // If there are no arrow annotations, dragging panels doesn't affect the canvas
      if (!drawingAnnotations.some(a => a.type === 'arrow')) return
      const detail = (e as CustomEvent).detail as Record<string, Panel>
      activePanelsRef.current = detail
      draw()
    }
    window.addEventListener('deck:panels-drag', handler)
    return () => window.removeEventListener('deck:panels-drag', handler)
  }, [draw, drawingAnnotations])

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
          } else if (hit.type === 'arrow' || hit.type === 'relationship') {
            const pts = resolveConnectionRoute(hit, activePanelsRef.current as any)
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
      const startSnap = drawingStateRef.current.startSnap
      const endSnap = snapToPanelEdge(w)
      const endPt = endSnap ? endSnap.point : w
      const tempAnnotation = {
        startX: startPoint.x, startY: startPoint.y,
        endX: endPt.x, endY: endPt.y,
        startPanelId: startSnap?.panelId,
        endPanelId: endSnap?.panelId,
        startAnchor: startSnap?.anchor,
        endAnchor: endSnap?.anchor,
        startEdgePos: startSnap?.edgePos,
        endEdgePos: endSnap?.edgePos,
      }
      const path = resolveConnectionRoute(tempAnnotation, activePanelsRef.current as any)
      const pathStr = generateSmoothPath(path, 0.22)
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
    if (a.type === 'arrow' || a.type === 'relationship') {
      const panelsState = useWorkspaceStore.getState().panels
      const pts = resolveConnectionRoute(a, panelsState as any)
      if (pts.length < 2) continue
      const minX = Math.min(...pts.map(p => p.x)) - 6
      const minY = Math.min(...pts.map(p => p.y)) - 6
      const maxX = Math.max(...pts.map(p => p.x)) + 6
      const maxY = Math.max(...pts.map(p => p.y)) + 6
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        // Broad phase box check passed; check segments
        for (let j = 0; j < pts.length - 1; j++) {
          const pA = pts[j]
          const pB = pts[j + 1]
          const dist = distToSegment(point, pA, pB)
          if (dist < 8) return a
        }
      }
      continue
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

function distToSegment(p: Point, a: Point, b: Point): number {
  const l2 = Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Annotation, panels: Record<string, Panel>) {
  const path = resolveConnectionRoute(a, panels as any)
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

  const pathStr = generateSmoothPath(path, 0.22)
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

export default React.memo(DrawingCanvas)
