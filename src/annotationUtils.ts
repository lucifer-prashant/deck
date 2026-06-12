export interface Point { x: number; y: number }

const HEAD_SIZE = 10
const ARROW_ANGLE = Math.PI / 6

export function getAnchorPoint(
  p: { x: number; y: number; width: number; height: number },
  anchor: string,
  edgePos: number = 0.5
): Point {
  switch (anchor) {
    case 'top':    return { x: p.x + p.width * edgePos, y: p.y }
    case 'bottom': return { x: p.x + p.width * edgePos, y: p.y + p.height }
    case 'left':   return { x: p.x, y: p.y + p.height * edgePos }
    case 'right':  return { x: p.x + p.width, y: p.y + p.height * edgePos }
    default:       return { x: p.x + p.width / 2, y: p.y + p.height / 2 }
  }
}

export function generateWigglyPath(
  sx: number, sy: number,
  ex: number, ey: number,
  wiggle: number = 0.2
): string {
  const dx = ex - sx
  const dy = ey - sy
  const dist = Math.hypot(dx, dy) || 1
  const nx = -dy / dist
  const ny = dx / dist
  const offset = Math.min(dist * wiggle, 80)
  const cp1x = sx + dx * 0.3 + nx * offset
  const cp1y = sy + dy * 0.3 + ny * offset
  const cp2x = ex - dx * 0.3 - nx * offset
  const cp2y = ey - dy * 0.3 - ny * offset
  return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`
}

export function generateArrowhead(
  sx: number, sy: number,
  ex: number, ey: number,
  size: number = HEAD_SIZE
): string {
  const angle = Math.atan2(ey - sy, ex - sx)
  const x1 = ex - size * Math.cos(angle - ARROW_ANGLE)
  const y1 = ey - size * Math.sin(angle - ARROW_ANGLE)
  const x2 = ex - size * Math.cos(angle + ARROW_ANGLE)
  const y2 = ey - size * Math.sin(angle + ARROW_ANGLE)
  return `M ${ex} ${ey} L ${x1} ${y1} L ${x2} ${y2} Z`
}

export function lineIntersectsAABB(p1: Point, p2: Point, box: { x1: number; y1: number; x2: number; y2: number }): boolean {
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

export function isVisible(
  p1: Point,
  p2: Point,
  obstacles: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>
): boolean {
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

export function generateRoundedPath(path: Point[], radius: number = 12): string {
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

export function generateStraightPath(path: Point[]): string {
  if (path.length === 0) return ''
  return `M ${path[0].x} ${path[0].y} ` + path.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
}

export function generateSmoothPath(path: Point[], _k: number = 0.22): string {
  void _k;
  if (path.length === 0) return ''
  if (path.length === 1) return `M ${path[0].x} ${path[0].y}`
  if (path.length === 2) {
    // Direct connection: use the wiggly cubic Bezier path for hand-drawn flow
    return generateWigglyPath(path[0].x, path[0].y, path[1].x, path[1].y, 0.15)
  }

  const n = path.length
  const S: Point[] = new Array(n)
  const E: Point[] = new Array(n)

  // Use a beautiful, larger corner radius to make the curves flowy and smooth
  const radius = 35
  // Gentle wiggle factor for the straight segments
  const wiggle = 0.05

  for (let i = 1; i < n - 1; i++) {
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

    S[i] = {
      x: curr.x + (dx1 / d1) * r,
      y: curr.y + (dy1 / d1) * r
    }

    E[i] = {
      x: curr.x + (dx2 / d2) * r,
      y: curr.y + (dy2 / d2) * r
    }
  }

  // Helper to draw a wiggly segment between two points
  function getSegmentPath(A: Point, B: Point, isStart: boolean = false): string {
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len = Math.hypot(dx, dy)

    if (len < 15) {
      return (isStart ? `M ${A.x} ${A.y} ` : '') + `L ${B.x} ${B.y}`
    }

    const nx = -dy / len
    const ny = dx / len
    
    // We alternate the wiggle direction or just use a small offset
    // This creates a gentle wave in the line
    const offset = Math.min(len * wiggle, 8)
    
    const cp1x = A.x + dx * 0.3 + nx * offset
    const cp1y = A.y + dy * 0.3 + ny * offset
    const cp2x = B.x - dx * 0.3 - nx * offset
    const cp2y = B.y - dy * 0.3 - ny * offset

    return (isStart ? `M ${A.x} ${A.y} ` : '') + `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${B.x} ${B.y}`
  }

  let d = ''
  // Draw first segment from P0 to S_1
  d += getSegmentPath(path[0], S[1], true)

  // Draw intermediate corners and segments
  for (let i = 1; i < n - 1; i++) {
    // Corner i: from S_i to E_i around path[i]
    d += ` Q ${path[i].x} ${path[i].y}, ${E[i].x} ${E[i].y}`

    // Segment from E_i to next start S_{i+1} (or to Pn if it's the last one)
    const nextPt = (i === n - 2) ? path[n - 1] : S[i + 1]
    d += ' ' + getSegmentPath(E[i], nextPt, false)
  }

  return d
}

export function resolveConnectionRoute(
  a: {
    startX?: number; startY?: number; endX?: number; endY?: number;
    startPanelId?: string; endPanelId?: string;
    startAnchor?: string; endAnchor?: string;
    startEdgePos?: number; endEdgePos?: number;
    sourcePanelId?: string; targetPanelId?: string;
    sourceAnchor?: string; targetAnchor?: string;
    sourceEdgePos?: number; targetEdgePos?: number;
  },
  panels: Record<string, { id: string; x: number; y: number; width: number; height: number; type: string; minimized?: boolean }>,
  skipRouting?: boolean
): Point[] {
  const startPanelId = a.startPanelId || a.sourcePanelId
  const endPanelId = a.endPanelId || a.targetPanelId
  const startAnchor = a.startAnchor || a.sourceAnchor || 'center'
  const endAnchor = a.endAnchor || a.targetAnchor || 'center'
  const startEdgePos = a.startEdgePos ?? a.sourceEdgePos ?? 0.5
  const endEdgePos = a.endEdgePos ?? a.targetEdgePos ?? 0.5

  let startX = a.startX
  let startY = a.startY
  let endX = a.endX
  let endY = a.endY

  if (startPanelId) {
    const p = panels[startPanelId]
    if (p) {
      const anchor = getAnchorPoint(p, startAnchor, startEdgePos)
      startX = anchor.x; startY = anchor.y
    }
  }
  if (endPanelId) {
    const p = panels[endPanelId]
    if (p) {
      const anchor = getAnchorPoint(p, endAnchor, endEdgePos)
      endX = anchor.x; endY = anchor.y
    }
  }
  if (startX == null || startY == null || endX == null || endY == null) return []

  const start = { x: startX, y: startY }
  const end = { x: endX, y: endY }

  if (skipRouting) return [start, end]

  const obstacles = Object.values(panels)
    .filter(p => p.type !== 'region' && p.id !== startPanelId && p.id !== endPanelId)
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
  if (startPanelId && panels[startPanelId]) {
    const p = panels[startPanelId]
    if (p.type !== 'region') {
      const h = p.minimized ? 34 : p.height
      V.push({ x: p.x - padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y - padSize })
      V.push({ x: p.x + p.width + padSize, y: p.y + h + padSize })
      V.push({ x: p.x - padSize, y: p.y + h + padSize })
    }
  }
  if (endPanelId && panels[endPanelId]) {
    const p = panels[endPanelId]
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
