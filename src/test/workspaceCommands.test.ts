import { describe, it, expect } from 'vitest'
import { getPanelBounds, panelDefaults } from '@/workspaceCommands'
import type { Panel } from '@/store/workspaceStore'

const makePanel = (id: string, overrides: Partial<Panel> = {}): Panel => ({
  id,
  type: 'terminal',
  x: 0, y: 0,
  width: 600, height: 400,
  title: `Panel ${id}`,
  ...overrides
})

describe('getPanelBounds', () => {
  it('returns null for empty array', () => {
    expect(getPanelBounds([])).toBeNull()
  })

  it('returns exact bounds for single panel', () => {
    const panel = makePanel('p1', { x: 100, y: 200, width: 300, height: 400 })
    const bounds = getPanelBounds([panel])!
    expect(bounds.x).toBe(100)
    expect(bounds.y).toBe(200)
    expect(bounds.width).toBe(300)
    expect(bounds.height).toBe(400)
  })

  it('returns union bounds for two non-overlapping panels', () => {
    const a = makePanel('a', { x: 0, y: 0, width: 100, height: 100 })
    const b = makePanel('b', { x: 200, y: 200, width: 100, height: 100 })
    const bounds = getPanelBounds([a, b])!
    expect(bounds.x).toBe(0)
    expect(bounds.y).toBe(0)
    expect(bounds.width).toBe(300)  // 0 to 300
    expect(bounds.height).toBe(300)
  })

  it('returns correct bounds for overlapping panels', () => {
    const a = makePanel('a', { x: 0, y: 0, width: 200, height: 200 })
    const b = makePanel('b', { x: 100, y: 100, width: 200, height: 200 })
    const bounds = getPanelBounds([a, b])!
    expect(bounds.x).toBe(0)
    expect(bounds.y).toBe(0)
    expect(bounds.width).toBe(300)  // 0 to 300
    expect(bounds.height).toBe(300)
  })

  it('returns correct bounds for three spread panels', () => {
    const panels = [
      makePanel('a', { x: -100, y: -50, width: 100, height: 100 }),
      makePanel('b', { x: 500, y: 300, width: 200, height: 150 }),
      makePanel('c', { x: 200, y: 100, width: 50, height: 50 })
    ]
    const bounds = getPanelBounds(panels)!
    expect(bounds.x).toBe(-100)
    expect(bounds.y).toBe(-50)
    expect(bounds.width).toBe(800)   // -100 to 700
    expect(bounds.height).toBe(500)  // -50 to 450
  })

  it('handles panels at negative coordinates', () => {
    const panel = makePanel('neg', { x: -200, y: -300, width: 100, height: 100 })
    const bounds = getPanelBounds([panel])!
    expect(bounds.x).toBe(-200)
    expect(bounds.y).toBe(-300)
    expect(bounds.width).toBe(100)
    expect(bounds.height).toBe(100)
  })

  it('handles zero-size panel', () => {
    const panel = makePanel('zero', { x: 50, y: 50, width: 0, height: 0 })
    const bounds = getPanelBounds([panel])!
    expect(bounds.x).toBe(50)
    expect(bounds.y).toBe(50)
    expect(bounds.width).toBe(0)
    expect(bounds.height).toBe(0)
  })
})

describe('panelDefaults', () => {
  it('has defaults for terminal', () => {
    expect(panelDefaults.terminal).toBeDefined()
    expect(panelDefaults.terminal.width).toBe(600)
    expect(panelDefaults.terminal.height).toBe(400)
    expect(panelDefaults.terminal.title).toBe('Terminal')
  })

  it('has defaults for editor', () => {
    expect(panelDefaults.editor).toBeDefined()
    expect(panelDefaults.editor.width).toBe(1100)
    expect(panelDefaults.editor.height).toBe(760)
    expect(panelDefaults.editor.title).toBe('Editor')
  })

  it('has defaults for browser', () => {
    expect(panelDefaults.browser).toBeDefined()
    expect(panelDefaults.browser.width).toBe(720)
    expect(panelDefaults.browser.height).toBe(560)
    expect(panelDefaults.browser.title).toBe('Browser')
  })

  it('has defaults for region', () => {
    expect(panelDefaults.region).toBeDefined()
    expect(panelDefaults.region.width).toBe(800)
    expect(panelDefaults.region.height).toBe(600)
    expect(panelDefaults.region.title).toBe('Region')
  })
})
