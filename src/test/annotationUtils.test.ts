import { describe, it, expect } from 'vitest'
import { getAnchorPoint, generateWigglyPath, generateArrowhead } from '@/annotationUtils'

describe('getAnchorPoint', () => {
  const rect = { x: 100, y: 200, width: 400, height: 300 }

  it('returns top-center by default', () => {
    const pt = getAnchorPoint(rect, 'top')
    expect(pt).toEqual({ x: 300, y: 200 }) // x + width * 0.5
  })

  it('returns bottom-center by default', () => {
    const pt = getAnchorPoint(rect, 'bottom')
    expect(pt).toEqual({ x: 300, y: 500 }) // y + height
  })

  it('returns left-center by default', () => {
    const pt = getAnchorPoint(rect, 'left')
    expect(pt).toEqual({ x: 100, y: 350 }) // y + height * 0.5
  })

  it('returns right-center by default', () => {
    const pt = getAnchorPoint(rect, 'right')
    expect(pt).toEqual({ x: 500, y: 350 }) // x + width
  })

  it('returns center of rect for unknown anchor', () => {
    const pt = getAnchorPoint(rect, 'diagonal')
    expect(pt).toEqual({ x: 300, y: 350 })
  })

  it('respects edgePos on top anchor', () => {
    const pt = getAnchorPoint(rect, 'top', 0.25)
    expect(pt).toEqual({ x: 200, y: 200 }) // x + width * 0.25
  })

  it('respects edgePos on bottom anchor', () => {
    const pt = getAnchorPoint(rect, 'bottom', 0.75)
    expect(pt).toEqual({ x: 400, y: 500 })
  })

  it('respects edgePos on left anchor', () => {
    const pt = getAnchorPoint(rect, 'left', 0)
    expect(pt).toEqual({ x: 100, y: 200 })
  })

  it('respects edgePos on right anchor', () => {
    const pt = getAnchorPoint(rect, 'right', 1)
    expect(pt).toEqual({ x: 500, y: 500 })
  })

  it('handles zero-size rect', () => {
    const pt = getAnchorPoint({ x: 10, y: 20, width: 0, height: 0 }, 'top')
    expect(pt).toEqual({ x: 10, y: 20 })
  })
})

describe('generateWigglyPath', () => {
  it('returns an SVG cubic bezier path string', () => {
    const path = generateWigglyPath(0, 0, 100, 0)
    expect(path).toMatch(/^M /)
    expect(path).toContain('C ')
    // Starts at origin, ends at (100, 0)
    expect(path).toMatch(/^M 0 0 C /)
    expect(path).toMatch(/, 100 0$/)
  })

  it('handles vertical line', () => {
    const path = generateWigglyPath(0, 0, 0, 200)
    expect(path).toMatch(/^M 0 0 C /)
    expect(path).toMatch(/, 0 200$/)
  })

  it('handles diagonal line', () => {
    const path = generateWigglyPath(10, 20, 110, 120)
    expect(path).toMatch(/^M 10 20 C /)
    expect(path).toMatch(/, 110 120$/)
  })

  it('handles same start and end point (degenerate)', () => {
    const path = generateWigglyPath(50, 50, 50, 50)
    expect(path).toMatch(/^M 50 50 C /)
    // Should not produce NaN
    expect(path).not.toContain('NaN')
  })

  it('respects wiggle=0 (straight control points)', () => {
    const path = generateWigglyPath(0, 0, 100, 0, 0)
    // With zero wiggle, the normal offset is 0 → control points lie on the line
    expect(path).toMatch(/^M 0 0 C /)
    // cp1 = (30, 0), cp2 = (70, 0) — both on the x-axis
    expect(path).toBe('M 0 0 C 30 0, 70 0, 100 0')
  })

  it('caps offset at 80px for long distances', () => {
    // Distance = 10000, wiggle = 0.2 → dist*wiggle = 2000 → capped at 80
    const path = generateWigglyPath(0, 0, 10000, 0, 0.2)
    expect(path).not.toContain('NaN')
    // Verify the path is valid SVG
    expect(path).toMatch(/^M .+ C .+, .+, .+$/)
  })
})

describe('generateArrowhead', () => {
  it('returns a closed SVG path (M...L...L...Z)', () => {
    const path = generateArrowhead(0, 0, 100, 0)
    expect(path).toMatch(/^M /)
    expect(path).toMatch(/Z$/)
    // Should have exactly 2 L commands (triangle = 3 points)
    const lCount = (path.match(/ L /g) || []).length
    expect(lCount).toBe(2)
  })

  it('arrowhead tip is at endpoint', () => {
    const path = generateArrowhead(0, 0, 200, 0)
    expect(path).toMatch(/^M 200 0 /)
  })

  it('handles vertical arrow', () => {
    const path = generateArrowhead(0, 0, 0, 100)
    expect(path).toMatch(/^M 0 100 /)
    expect(path).not.toContain('NaN')
  })

  it('handles negative direction', () => {
    const path = generateArrowhead(100, 100, 0, 0)
    expect(path).toMatch(/^M 0 0 /)
    expect(path).not.toContain('NaN')
  })

  it('respects custom size parameter', () => {
    const small = generateArrowhead(0, 0, 100, 0, 5)
    const large = generateArrowhead(0, 0, 100, 0, 20)
    // Both start at tip (100,0)
    expect(small).toMatch(/^M 100 0 /)
    expect(large).toMatch(/^M 100 0 /)
    // But the L coordinates should differ
    expect(small).not.toEqual(large)
  })

  it('handles same start and end point', () => {
    const path = generateArrowhead(50, 50, 50, 50)
    expect(path).not.toContain('NaN')
    expect(path).toMatch(/Z$/)
  })
})
