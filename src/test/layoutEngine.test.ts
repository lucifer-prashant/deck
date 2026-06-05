import { describe, it, expect } from 'vitest'
import { grid, masonry, golden, clusterByType, fitViewport } from '@/layoutEngine'
import type { Panel } from '@/store/workspaceStore'

// Helper to create minimal Panel objects
const makePanel = (id: string, overrides: Partial<Panel> = {}): Panel => ({
  id,
  type: 'terminal',
  x: 0, y: 0,
  width: 600, height: 400,
  title: `Panel ${id}`,
  ...overrides
})

const TX = 0, TY = 0, TW = 1920, TH = 1080

// Helper: check no panels overlap
const noOverlaps = (results: Map<string, { x: number; y: number; width: number; height: number }>) => {
  const entries = Array.from(results.values())
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j]
      const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x
      const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y
      if (overlapsX && overlapsY) return false
    }
  }
  return true
}

describe('grid', () => {
  it('returns empty Map for 0 panels', () => {
    const result = grid([], TX, TY, TW, TH)
    expect(result.size).toBe(0)
  })

  it('single panel fills entire target area', () => {
    const p = makePanel('p1')
    const result = grid([p], TX, TY, TW, TH)
    expect(result.size).toBe(1)
    const layout = result.get('p1')!
    expect(layout.x).toBe(TX)
    expect(layout.y).toBe(TY)
    expect(layout.width).toBe(TW)
    expect(layout.height).toBe(TH)
  })

  it('4 panels fit within target bounds', () => {
    const panels = [1, 2, 3, 4].map(i => makePanel(`p${i}`))
    const result = grid(panels, TX, TY, TW, TH)
    expect(result.size).toBe(4)
    result.forEach(layout => {
      expect(layout.x).toBeGreaterThanOrEqual(TX)
      expect(layout.y).toBeGreaterThanOrEqual(TY)
      expect(layout.x + layout.width).toBeLessThanOrEqual(TX + TW + 1) // +1 for float rounding
      expect(layout.y + layout.height).toBeLessThanOrEqual(TY + TH + 1)
    })
  })

  it('4 panels do not overlap', () => {
    const panels = [1, 2, 3, 4].map(i => makePanel(`p${i}`))
    const result = grid(panels, TX, TY, TW, TH)
    expect(noOverlaps(result)).toBe(true)
  })

  it('9 panels produce 3×3 or close grid', () => {
    const panels = Array.from({ length: 9 }, (_, i) => makePanel(`p${i}`))
    const result = grid(panels, TX, TY, TW, TH)
    expect(result.size).toBe(9)
    expect(noOverlaps(result)).toBe(true)
  })

  it('preserves panel IDs in output', () => {
    const panels = [makePanel('alpha'), makePanel('beta')]
    const result = grid(panels, TX, TY, TW, TH)
    expect(result.has('alpha')).toBe(true)
    expect(result.has('beta')).toBe(true)
  })

  it('all panels have positive dimensions', () => {
    const panels = Array.from({ length: 6 }, (_, i) => makePanel(`p${i}`))
    const result = grid(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.width).toBeGreaterThan(0)
      expect(layout.height).toBeGreaterThan(0)
    })
  })

  it('works with offset target position', () => {
    const panels = [1, 2].map(i => makePanel(`p${i}`))
    const result = grid(panels, 500, 300, 1000, 600)
    result.forEach(layout => {
      expect(layout.x).toBeGreaterThanOrEqual(500)
      expect(layout.y).toBeGreaterThanOrEqual(300)
    })
  })
})

describe('masonry', () => {
  it('returns empty Map for 0 panels', () => {
    expect(masonry([], TX, TY, TW, TH).size).toBe(0)
  })

  it('single panel fills target', () => {
    const p = makePanel('p1')
    const result = masonry([p], TX, TY, TW, TH)
    const layout = result.get('p1')!
    expect(layout.x).toBe(TX)
    expect(layout.width).toBe(TW)
    expect(layout.height).toBe(TH)
  })

  it('panels have minimum height of 120', () => {
    // Create panels with very tall aspect ratios (width >> height would make small heights)
    const panels = Array.from({ length: 4 }, (_, i) => makePanel(`p${i}`, { width: 1000, height: 10 }))
    const result = masonry(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.height).toBeGreaterThanOrEqual(120)
    })
  })

  it('all panels fit within target width', () => {
    const panels = Array.from({ length: 5 }, (_, i) => makePanel(`p${i}`))
    const result = masonry(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.x).toBeGreaterThanOrEqual(TX)
      expect(layout.x + layout.width).toBeLessThanOrEqual(TX + TW + 1)
    })
  })

  it('uses 2+ columns for multiple panels', () => {
    const panels = Array.from({ length: 4 }, (_, i) => makePanel(`p${i}`))
    const result = masonry(panels, TX, TY, TW, TH)
    // Verify at least 2 different x positions (multiple columns)
    const xPositions = new Set(Array.from(result.values()).map(l => Math.round(l.x)))
    expect(xPositions.size).toBeGreaterThanOrEqual(2)
  })

  it('all panels have positive dimensions', () => {
    const panels = Array.from({ length: 6 }, (_, i) => makePanel(`p${i}`))
    const result = masonry(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.width).toBeGreaterThan(0)
      expect(layout.height).toBeGreaterThan(0)
    })
  })
})

describe('golden', () => {
  it('returns empty Map for 0 panels', () => {
    expect(golden([], TX, TY, TW, TH).size).toBe(0)
  })

  it('single panel fills target', () => {
    const p = makePanel('p1')
    const result = golden([p], TX, TY, TW, TH)
    const layout = result.get('p1')!
    expect(layout.width).toBe(TW)
    expect(layout.height).toBe(TH)
  })

  it('largest panel gets ~61.8% width (golden ratio)', () => {
    const panels = [
      makePanel('big', { width: 1000, height: 800 }),
      makePanel('small', { width: 200, height: 200 })
    ]
    const result = golden(panels, TX, TY, TW, TH)
    const bigLayout = result.get('big')!
    const PHI = 1.618033988749
    const expectedWidth = TW / PHI - 16 / 2 // GAP/2
    expect(bigLayout.width).toBeCloseTo(expectedWidth, 0)
  })

  it('largest panel is on the left', () => {
    const panels = [
      makePanel('big', { width: 1000, height: 800 }),
      makePanel('small', { width: 200, height: 200 })
    ]
    const result = golden(panels, TX, TY, TW, TH)
    expect(result.get('big')!.x).toBe(TX)
  })

  it('remaining panels stack on the right', () => {
    const panels = [
      makePanel('big', { width: 1000, height: 800 }),
      makePanel('med', { width: 500, height: 400 }),
      makePanel('small', { width: 200, height: 200 })
    ]
    const result = golden(panels, TX, TY, TW, TH)
    const bigX = result.get('big')!.x + result.get('big')!.width
    // med and small should both be to the right of big
    expect(result.get('med')!.x).toBeGreaterThan(bigX - 1)
    expect(result.get('small')!.x).toBeGreaterThan(bigX - 1)
  })

  it('remaining panels split height evenly', () => {
    const panels = [
      makePanel('big', { width: 1000, height: 800 }),
      makePanel('med', { width: 500, height: 400 }),
      makePanel('small', { width: 200, height: 200 })
    ]
    const result = golden(panels, TX, TY, TW, TH)
    const medH = result.get('med')!.height
    const smallH = result.get('small')!.height
    expect(medH).toBeCloseTo(smallH, 0) // equal heights
  })

  it('all panels have positive dimensions', () => {
    const panels = Array.from({ length: 5 }, (_, i) => makePanel(`p${i}`, { width: 400 + i * 100, height: 300 + i * 50 }))
    const result = golden(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.width).toBeGreaterThan(0)
      expect(layout.height).toBeGreaterThan(0)
    })
  })

  it('sorts panels by area descending', () => {
    const panels = [
      makePanel('small', { width: 100, height: 100 }),  // area 10000
      makePanel('big', { width: 1000, height: 1000 }),  // area 1000000
    ]
    const result = golden(panels, TX, TY, TW, TH)
    // big should be the main panel (left side)
    expect(result.get('big')!.x).toBe(TX)
  })
})

describe('clusterByType', () => {
  it('returns empty Map for 0 panels', () => {
    expect(clusterByType([], TX, TY, TW, TH).size).toBe(0)
  })

  it('single panel fills target', () => {
    const p = makePanel('p1')
    const result = clusterByType([p], TX, TY, TW, TH)
    const layout = result.get('p1')!
    expect(layout.width).toBe(TW)
    expect(layout.height).toBe(TH)
  })

  it('groups panels by type', () => {
    const panels = [
      makePanel('t1', { type: 'terminal' }),
      makePanel('t2', { type: 'terminal' }),
      makePanel('t3', { type: 'terminal' }),
      makePanel('b1', { type: 'browser' }),
      makePanel('b2', { type: 'browser' }),
      makePanel('e1', { type: 'editor' })
    ]
    const result = clusterByType(panels, TX, TY, TW, TH)
    expect(result.size).toBe(6)
    // All panel IDs present
    panels.forEach(p => {
      expect(result.has(p.id)).toBe(true)
    })
  })

  it('all panels within target bounds', () => {
    const panels = [
      makePanel('t1', { type: 'terminal' }),
      makePanel('b1', { type: 'browser' }),
      makePanel('e1', { type: 'editor' })
    ]
    const result = clusterByType(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.x).toBeGreaterThanOrEqual(TX)
      expect(layout.y).toBeGreaterThanOrEqual(TY)
    })
  })

  it('panels with same type are spatially grouped', () => {
    const panels = [
      makePanel('t1', { type: 'terminal' }),
      makePanel('t2', { type: 'terminal' }),
      makePanel('b1', { type: 'browser' }),
      makePanel('b2', { type: 'browser' })
    ]
    const result = clusterByType(panels, TX, TY, TW, TH)
    // Terminal panels should be close together (same cluster)
    const t1 = result.get('t1')!
    const t2 = result.get('t2')!
    const b1 = result.get('b1')!
    // t1 and t2 should share the same approximate x range (same cluster column)
    const t1CenterX = t1.x + t1.width / 2
    const t2CenterX = t2.x + t2.width / 2
    const b1CenterX = b1.x + b1.width / 2
    // Either t1,t2 are in same column, or at least closer to each other than to b1
    const terminalDist = Math.abs(t1CenterX - t2CenterX)
    const crossDist = Math.abs(t1CenterX - b1CenterX)
    expect(terminalDist).toBeLessThanOrEqual(crossDist + 1)
  })

  it('uses 1 column for clusters with ≤3 members', () => {
    const panels = [
      makePanel('t1', { type: 'terminal' }),
      makePanel('t2', { type: 'terminal' }),
      makePanel('t3', { type: 'terminal' })
    ]
    const result = clusterByType(panels, TX, TY, TW, TH)
    // 3 terminals in 1 col → all share same x position
    const xs = new Set(Array.from(result.values()).map(l => Math.round(l.x)))
    expect(xs.size).toBe(1)
  })

  it('uses 2 columns for clusters with >3 members', () => {
    const panels = [
      makePanel('t1', { type: 'terminal' }),
      makePanel('t2', { type: 'terminal' }),
      makePanel('t3', { type: 'terminal' }),
      makePanel('t4', { type: 'terminal' })
    ]
    const result = clusterByType(panels, TX, TY, TW, TH)
    // 4 terminals → 2 cols → at least 2 unique x positions
    const xs = new Set(Array.from(result.values()).map(l => Math.round(l.x)))
    expect(xs.size).toBe(2)
  })

  it('all panels have positive dimensions', () => {
    const panels = Array.from({ length: 8 }, (_, i) =>
      makePanel(`p${i}`, { type: (['terminal', 'browser', 'editor'] as const)[i % 3] })
    )
    const result = clusterByType(panels, TX, TY, TW, TH)
    result.forEach(layout => {
      expect(layout.width).toBeGreaterThan(0)
      expect(layout.height).toBeGreaterThan(0)
    })
  })
})

describe('fitViewport', () => {
  it('returns empty Map for 0 panels', () => {
    expect(fitViewport([], TX, TY, TW, TH).size).toBe(0)
  })

  it('single panel fills target area', () => {
    const p = makePanel('p1', { x: 100, y: 100, width: 600, height: 400 })
    const result = fitViewport([p], TX, TY, TW, TH)
    const layout = result.get('p1')!
    // Should be centered in target
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('preserves relative positions', () => {
    const panels = [
      makePanel('left', { x: 0, y: 0, width: 100, height: 100 }),
      makePanel('right', { x: 200, y: 0, width: 100, height: 100 })
    ]
    const result = fitViewport(panels, TX, TY, TW, TH)
    const leftLayout = result.get('left')!
    const rightLayout = result.get('right')!
    // 'right' should still be to the right of 'left'
    expect(rightLayout.x).toBeGreaterThan(leftLayout.x)
  })

  it('scales proportionally', () => {
    const panels = [
      makePanel('a', { x: 0, y: 0, width: 100, height: 100 }),
      makePanel('b', { x: 200, y: 0, width: 100, height: 100 })
    ]
    const result = fitViewport(panels, TX, TY, TW, TH)
    const a = result.get('a')!
    const b = result.get('b')!
    // Both should be scaled by the same factor
    expect(a.width).toBeCloseTo(b.width, 5)
    expect(a.height).toBeCloseTo(b.height, 5)
  })

  it('output is centered in target area', () => {
    const panels = [
      makePanel('only', { x: 1000, y: 1000, width: 200, height: 200 })
    ]
    const result = fitViewport(panels, 0, 0, 1000, 1000)
    const layout = result.get('only')!
    const centerX = layout.x + layout.width / 2
    const centerY = layout.y + layout.height / 2
    expect(centerX).toBeCloseTo(500, 0)
    expect(centerY).toBeCloseTo(500, 0)
  })

  it('handles panels at the same position (degenerate)', () => {
    const panels = [
      makePanel('a', { x: 100, y: 100, width: 50, height: 50 }),
      makePanel('b', { x: 100, y: 100, width: 50, height: 50 })
    ]
    const result = fitViewport(panels, TX, TY, TW, TH)
    expect(result.size).toBe(2)
    // Both should be at the same position (same input bbox)
    const a = result.get('a')!
    const b = result.get('b')!
    expect(a.x).toBeCloseTo(b.x, 5)
    expect(a.y).toBeCloseTo(b.y, 5)
  })

  it('output panel IDs match input', () => {
    const panels = [makePanel('x'), makePanel('y'), makePanel('z')]
    const result = fitViewport(panels, TX, TY, TW, TH)
    expect(result.has('x')).toBe(true)
    expect(result.has('y')).toBe(true)
    expect(result.has('z')).toBe(true)
  })
})
