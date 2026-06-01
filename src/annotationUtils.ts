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
