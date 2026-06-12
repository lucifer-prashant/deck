import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirmPanelDeletion, confirmPanelsDeletion } from '@/panelDeletion'
import type { Panel } from '@/store/workspaceStore'

const makePanel = (overrides: Partial<Panel> = {}): Panel => ({
  id: 'test-panel',
  type: 'terminal',
  x: 0, y: 0,
  width: 600, height: 400,
  title: 'Test',
  ...overrides
})

describe('confirmPanelDeletion', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('returns true when confirm returns true', () => {
    expect(confirmPanelDeletion(1)).toBe(true)
  })

  it('returns false when confirm returns false', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    expect(confirmPanelDeletion(1)).toBe(false)
  })

  it('uses singular label for count=1', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    confirmPanelDeletion(1)
    expect(spy).toHaveBeenCalledWith('Delete this panel?')
  })

  it('uses plural label for count>1', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    confirmPanelDeletion(3)
    expect(spy).toHaveBeenCalledWith('Delete 3 selected panels?')
  })
})

describe('confirmPanelsDeletion', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('returns false for empty targets', () => {
    expect(confirmPanelsDeletion([])).toBe(false)
  })

  it('confirms single region with children', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const region = makePanel({
      type: 'region',
      title: 'MyRegion',
      children: ['child-1', 'child-2', 'child-3']
    })
    confirmPanelsDeletion([region])
    expect(spy).toHaveBeenCalledWith('Delete region "MyRegion"? (3 panels stay on canvas)')
  })

  it('confirms single region with 1 child (singular)', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const region = makePanel({
      type: 'region',
      title: 'Solo',
      children: ['child-1']
    })
    confirmPanelsDeletion([region])
    expect(spy).toHaveBeenCalledWith('Delete region "Solo"? (1 panel stays on canvas)')
  })

  it('confirms single region with no children', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const region = makePanel({ type: 'region', title: 'Empty' })
    confirmPanelsDeletion([region])
    expect(spy).toHaveBeenCalledWith('Delete region "Empty"?')
  })

  it('confirms single non-region panel', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const panel = makePanel({ type: 'terminal', title: 'MyTerm' })
    confirmPanelsDeletion([panel])
    expect(spy).toHaveBeenCalledWith('Delete terminal "MyTerm"?')
  })

  it('confirms single browser panel', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const panel = makePanel({ type: 'browser', title: 'Chrome' })
    confirmPanelsDeletion([panel])
    expect(spy).toHaveBeenCalledWith('Delete browser "Chrome"?')
  })

  it('confirms single PDF browser panel', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const panel = makePanel({ type: 'browser', title: 'document.pdf' })
    confirmPanelsDeletion([panel])
    expect(spy).toHaveBeenCalledWith('Delete pdf view "document.pdf"?')
  })

  it('confirms multiple panels with state count', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('confirm', spy)
    const panels = [
      makePanel({ id: 'p1', type: 'terminal', title: 'Term1' }),
      makePanel({ id: 'p2', type: 'browser', title: 'Browser1' }),
      makePanel({ id: 'p3', type: 'editor', title: 'Editor1' })
    ]
    confirmPanelsDeletion(panels)
    expect(spy).toHaveBeenCalledWith('Delete 3 panels? 3 contain state.')
  })

  it('returns false for multiple panels when confirm returns false', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const panels = [
      makePanel({ id: 'p1', type: 'terminal' }),
      makePanel({ id: 'p2', type: 'browser' })
    ]
    expect(confirmPanelsDeletion(panels)).toBe(false)
  })
})
