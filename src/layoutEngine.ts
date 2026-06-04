// layoutEngine.ts — pure layout strategies for arranging panels on the canvas.
// Each function takes a list of panels and a target viewport region,
// returns a map of panelId → { x, y, width, height }.

import type { Panel } from './store/workspaceStore'

export type LayoutStrategy = 'grid' | 'masonry' | 'golden' | 'cluster'

export interface LayoutResult {
  x: number
  y: number
  width: number
  height: number
}

// Default panel size used when panels don't have meaningful dimensions.
const DEFAULT_W = 520
const DEFAULT_H = 360
const GAP = 16

/**
 * Grid layout — even N×M grid filling the target area.
 * Calculates optimal columns for ~16:9 aspect ratio per cell.
 */
export function grid(panels: Panel[], targetX: number, targetY: number, targetW: number, targetH: number): Map<string, LayoutResult> {
  const n = panels.length
  if (n === 0) return new Map()
  if (n === 1) {
    const p = panels[0]
    return new Map([[p.id, { x: targetX, y: targetY, width: targetW, height: targetH }]])
  }

  // Calculate optimal grid: try to make cells ~16:9
  const targetAspect = targetW / targetH
  const cellAspect = DEFAULT_W / DEFAULT_H
  const cols = Math.max(1, Math.round(Math.sqrt(n * targetAspect / cellAspect)))
  const rows = Math.ceil(n / cols)

  const cellW = (targetW - GAP * (cols - 1)) / cols
  const cellH = (targetH - GAP * (rows - 1)) / rows

  const result = new Map<string, LayoutResult>()
  panels.forEach((p, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    result.set(p.id, {
      x: targetX + col * (cellW + GAP),
      y: targetY + row * (cellH + GAP),
      width: cellW,
      height: cellH,
    })
  })
  return result
}

/**
 * Masonry layout — staggered columns, Pinterest-style.
 * Panels keep their aspect ratio but get equal width.
 * Fills columns left-to-right, each column packs top-to-bottom.
 */
export function masonry(panels: Panel[], targetX: number, targetY: number, targetW: number, targetH: number): Map<string, LayoutResult> {
  const n = panels.length
  if (n === 0) return new Map()
  if (n === 1) {
    const p = panels[0]
    return new Map([[p.id, { x: targetX, y: targetY, width: targetW, height: targetH }]])
  }

  const numCols = Math.min(n, Math.max(2, Math.round(Math.sqrt(n * 1.5))))
  const colWidth = (targetW - GAP * (numCols - 1)) / numCols
  const colHeights = new Array(numCols).fill(0)

  const result = new Map<string, LayoutResult>()
  panels.forEach((p) => {
    // Pick the shortest column.
    let bestCol = 0
    for (let c = 1; c < numCols; c++) {
      if (colHeights[c] < colHeights[bestCol]) bestCol = c
    }

    const aspect = (p.height && p.width) ? p.height / p.width : DEFAULT_H / DEFAULT_W
    const height = Math.max(120, colWidth * aspect)
    const y = targetY + colHeights[bestCol]

    result.set(p.id, {
      x: targetX + bestCol * (colWidth + GAP),
      y,
      width: colWidth,
      height,
    })
    colHeights[bestCol] += height + GAP
  })

  // Center vertically if there's spare room.
  const maxColHeight = Math.max(...colHeights)
  if (maxColHeight < targetH) {
    const offset = (targetH - maxColHeight) / 2
    result.forEach(r => { r.y += offset })
  }

  return result
}

/**
 * Golden ratio layout — Fibonacci-inspired.
 * Largest panel takes ~61.8% of width on the left.
 * Remaining panels split the right side recursively.
 */
export function golden(panels: Panel[], targetX: number, targetY: number, targetW: number, targetH: number): Map<string, LayoutResult> {
  const n = panels.length
  if (n === 0) return new Map()
  if (n === 1) {
    const p = panels[0]
    return new Map([[p.id, { x: targetX, y: targetY, width: targetW, height: targetH }]])
  }

  const PHI = 1.618033988749
  const ratio = 1 / PHI // ~0.618

  const result = new Map<string, LayoutResult>()

  // Sort panels by area (largest first) for the golden split.
  const sorted = [...panels].sort((a, b) => (b.width * b.height) - (a.width * a.height))

  // Place largest panel on the left, taking ~61.8% width.
  const mainW = targetW * ratio - GAP / 2
  result.set(sorted[0].id, {
    x: targetX,
    y: targetY,
    width: mainW,
    height: targetH,
  })

  // Remaining panels stack vertically on the right.
  const rightX = targetX + mainW + GAP
  const rightW = targetW - mainW - GAP
  const remaining = sorted.slice(1)
  const cellH = (targetH - GAP * (remaining.length - 1)) / remaining.length

  remaining.forEach((p, i) => {
    result.set(p.id, {
      x: rightX,
      y: targetY + i * (cellH + GAP),
      width: rightW,
      height: cellH,
    })
  })

  return result
}

/**
 * Cluster by type — groups panels of the same type together.
 * Each type gets a rectangular region. Types sorted by count (largest cluster first).
 * Clusters fill the target area in a grid-of-clusters.
 */
export function clusterByType(panels: Panel[], targetX: number, targetY: number, targetW: number, targetH: number): Map<string, LayoutResult> {
  const n = panels.length
  if (n === 0) return new Map()
  if (n === 1) {
    const p = panels[0]
    return new Map([[p.id, { x: targetX, y: targetY, width: targetW, height: targetH }]])
  }

  // Group by type.
  const byType = new Map<string, Panel[]>()
  panels.forEach(p => {
    const group = byType.get(p.type) || []
    group.push(p)
    byType.set(p.type, group)
  })

  // Sort groups by size (descending).
  const groups = Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length)

  // Arrange groups in a grid. Calculate rows/cols for the number of groups.
  const numGroups = groups.length
  const groupCols = Math.max(1, Math.ceil(Math.sqrt(numGroups * (targetW / targetH))))
  const groupRows = Math.ceil(numGroups / groupCols)
  const groupW = (targetW - GAP * (groupCols - 1)) / groupCols
  const groupH = (targetH - GAP * (groupRows - 1)) / groupRows

  const result = new Map<string, LayoutResult>()
  groups.forEach((group, gi) => {
    const [, members] = group
    const col = gi % groupCols
    const row = Math.floor(gi / groupCols)
    const gx = targetX + col * (groupW + GAP)
    const gy = targetY + row * (groupH + GAP)

    // Sub-grid within the cluster.
    const subCols = members.length === 1 ? 1 : members.length <= 3 ? 1 : 2
    const subRows = Math.ceil(members.length / subCols)
    const subW = (groupW - GAP * (subCols - 1)) / subCols
    const subH = (groupH - GAP * (subRows - 1)) / subRows

    members.forEach((p, mi) => {
      const sc = mi % subCols
      const sr = Math.floor(mi / subCols)
      result.set(p.id, {
        x: gx + sc * (subW + GAP),
        y: gy + sr * (subH + GAP),
        width: subW,
        height: subH,
      })
    })
  })

  return result
}

/**
 * Fit to viewport — arranges panels to fill the viewport with proportional scaling.
 * Maintains relative positions but scales to fit within target area.
 */
export function fitViewport(panels: Panel[], targetX: number, targetY: number, targetW: number, targetH: number): Map<string, LayoutResult> {
  if (panels.length === 0) return new Map()

  // Find bounding box of all panels.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  panels.forEach(p => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.width)
    maxY = Math.max(maxY, p.y + p.height)
  })

  const bbW = maxX - minX || 1
  const bbH = maxY - minY || 1
  const scale = Math.min(targetW / bbW, targetH / bbH)
  const offsetX = targetX + (targetW - bbW * scale) / 2
  const offsetY = targetY + (targetH - bbH * scale) / 2

  const result = new Map<string, LayoutResult>()
  panels.forEach(p => {
    result.set(p.id, {
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (p.y - minY) * scale,
      width: p.width * scale,
      height: p.height * scale,
    })
  })
  return result
}
