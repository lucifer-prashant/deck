import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkspaceStore, DEFAULT_KEYBINDINGS } from '@/store/workspaceStore'
import type { Panel, Annotation, WorkspaceTab } from '@/store/workspaceStore'

// Helper to create minimal Panel objects
const makePanel = (id: string, overrides: Partial<Panel> = {}): Panel => ({
  id,
  type: 'terminal',
  x: 0, y: 0,
  width: 600, height: 400,
  title: `Panel ${id}`,
  ...overrides
})

const makeAnnotation = (id: string, overrides: Partial<Annotation> = {}): Annotation => ({
  id,
  type: 'sticky',
  x: 0, y: 0,
  width: 200, height: 200,
  title: `Note ${id}`,
  color: '#fff',
  ...overrides
} as Annotation)

// Reset store before each test. We merge over the state fields without replacing
// the entire store — Zustand's action closures live alongside the state and
// must not be wiped.
beforeEach(() => {
  const tabId = 'test-tab-1'
  const tab = {
    id: tabId,
    title: 'Test Canvas',
    panels: {} as Record<string, Panel>,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedPanelIds: [] as string[],
    createdAt: 1000000
  }
  useWorkspaceStore.setState({
    panels: {},
    selectedPanelIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    tabs: [tab],
    activeTabId: tabId,
    past: [],
    future: [],
    annotateMode: false,
    annotationPast: [],
    annotationFuture: [],
    panelMruOrder: [],
    canvasPresets: {},
    presetGraveyards: {},
    viewportBookmarks: {},
    keybindings: DEFAULT_KEYBINDINGS,
    headerActivePanelId: null,
    bodyActivePanelId: null,
    lastFocusedPanelId: null,
    selectedAnnotationIds: [],
    jumpMode: { active: false, letters: {} },
    sidebarOpen: false,
    sidebarSection: 'explorer' as const,
    minimapVisible: true,
    helpOpen: false,
    chromeVisible: true,
    statusBarVisible: true,
    outlinerOpen: false,
  })
  localStorage.clear()
})

// ─── PANEL CRUD ──────────────────────────────────────────────────────────────

describe('Panel CRUD', () => {
  it('addPanel: panel appears in state', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    const s = useWorkspaceStore.getState()
    expect(s.panels['p1']).toBeDefined()
    expect(s.panels['p1'].title).toBe('Panel p1')
  })

  it('addPanel: pushes undo history', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    expect(useWorkspaceStore.getState().past.length).toBe(1)
    expect(useWorkspaceStore.getState().future.length).toBe(0)
  })

  it('addPanel: sets createdAt and updatedAt', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    const p = useWorkspaceStore.getState().panels['p1']
    expect(p.createdAt).toBeDefined()
    expect(p.updatedAt).toBeDefined()
  })

  it('addPanel: syncs to active tab', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab.panels['p1']).toBeDefined()
  })

  it('updatePanel: merges partial updates', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1', { title: 'Old' }))
    store.updatePanel('p1', { title: 'New' })
    expect(useWorkspaceStore.getState().panels['p1'].title).toBe('New')
  })

  it('updatePanel: pushes history by default', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    const histLen = useWorkspaceStore.getState().past.length
    store.updatePanel('p1', { title: 'Updated' })
    expect(useWorkspaceStore.getState().past.length).toBe(histLen + 1)
  })

  it('updatePanel: skipHistory prevents history push', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    const histLen = useWorkspaceStore.getState().past.length
    store.updatePanel('p1', { title: 'Quiet' }, { skipHistory: true })
    expect(useWorkspaceStore.getState().past.length).toBe(histLen)
  })

  it('updatePanel: no-op for nonexistent panel', () => {
    const store = useWorkspaceStore.getState()
    store.updatePanel('ghost', { title: 'X' })
    expect(useWorkspaceStore.getState().panels['ghost']).toBeUndefined()
  })

  it('deletePanel: removes panel from state', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    store.deletePanel('p1')
    expect(useWorkspaceStore.getState().panels['p1']).toBeUndefined()
  })

  it('deletePanel: removes from selectedPanelIds', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    store.selectPanel('p1')
    expect(useWorkspaceStore.getState().selectedPanelIds).toContain('p1')
    store.deletePanel('p1')
    expect(useWorkspaceStore.getState().selectedPanelIds).not.toContain('p1')
  })

  it('deletePanel: clears focus refs', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    store.setHeaderActivePanel('p1')
    store.setBodyActivePanel('p1')
    store.deletePanel('p1')
    const s = useWorkspaceStore.getState()
    expect(s.headerActivePanelId).toBeNull()
    expect(s.bodyActivePanelId).toBeNull()
  })

  it('deletePanel: region deletion clears children regionId', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('child1'))
    store.addPanel(makePanel('child2'))
    store.groupIntoRegion(['child1', 'child2'], 'TestRegion')
    const s = useWorkspaceStore.getState()
    const regionId = Object.keys(s.panels).find(id => s.panels[id].type === 'region')!
    store.deletePanel(regionId)
    const after = useWorkspaceStore.getState()
    expect(after.panels['child1'].regionId).toBeUndefined()
    expect(after.panels['child2'].regionId).toBeUndefined()
  })

  it('movePanel: updates x/y', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1', { x: 0, y: 0 }))
    store.movePanel('p1', 100, 200)
    const p = useWorkspaceStore.getState().panels['p1']
    expect(p.x).toBe(100)
    expect(p.y).toBe(200)
  })

  it('movePanel: no-op on locked panel', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1', { x: 0, y: 0, locked: true }))
    store.movePanel('p1', 100, 200)
    const p = useWorkspaceStore.getState().panels['p1']
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
  })

  it('movePanel: region moves its children', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('child1', { x: 50, y: 50 }))
    store.addPanel(makePanel('child2', { x: 100, y: 100 }))
    store.groupIntoRegion(['child1', 'child2'], 'Region')
    const regionId = Object.keys(useWorkspaceStore.getState().panels).find(
      id => useWorkspaceStore.getState().panels[id].type === 'region'
    )!
    const region = useWorkspaceStore.getState().panels[regionId]
    store.movePanel(regionId, region.x + 200, region.y + 200)
    const after = useWorkspaceStore.getState()
    expect(after.panels['child1'].x).toBe(250) // 50 + 200
    expect(after.panels['child1'].y).toBe(250)
    expect(after.panels['child2'].x).toBe(300) // 100 + 200
    expect(after.panels['child2'].y).toBe(300)
  })

  it('resizePanel: updates width/height', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1', { width: 600, height: 400 }))
    store.resizePanel('p1', 800, 600)
    const p = useWorkspaceStore.getState().panels['p1']
    expect(p.width).toBe(800)
    expect(p.height).toBe(600)
  })

  it('resizePanel: no-op on locked panel', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1', { width: 600, height: 400, locked: true }))
    store.resizePanel('p1', 800, 600)
    const p = useWorkspaceStore.getState().panels['p1']
    expect(p.width).toBe(600)
    expect(p.height).toBe(400)
  })
})

// ─── SELECTION ───────────────────────────────────────────────────────────────

describe('Selection', () => {
  beforeEach(() => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    store.addPanel(makePanel('p2'))
    store.addPanel(makePanel('p3'))
  })

  it('selectPanel(id) sets selectedPanelIds to [id]', () => {
    useWorkspaceStore.getState().selectPanel('p1')
    expect(useWorkspaceStore.getState().selectedPanelIds).toEqual(['p1'])
  })

  it('selectPanel(id, additive) appends to selection', () => {
    const store = useWorkspaceStore.getState()
    store.selectPanel('p1')
    store.selectPanel('p2', true)
    expect(useWorkspaceStore.getState().selectedPanelIds).toEqual(['p1', 'p2'])
  })

  it('selectPanel already-selected id, additive: removes (toggle)', () => {
    const store = useWorkspaceStore.getState()
    store.selectPanel('p1')
    store.selectPanel('p2', true)
    store.selectPanel('p1', true) // toggle off
    expect(useWorkspaceStore.getState().selectedPanelIds).toEqual(['p2'])
  })

  it('selectMultiple sets exact array', () => {
    useWorkspaceStore.getState().selectMultiple(['p2', 'p3'])
    expect(useWorkspaceStore.getState().selectedPanelIds).toEqual(['p2', 'p3'])
  })

  it('clearSelection empties selectedPanelIds', () => {
    const store = useWorkspaceStore.getState()
    store.selectPanel('p1')
    store.clearSelection()
    expect(useWorkspaceStore.getState().selectedPanelIds).toEqual([])
  })

  it('selectPanel updates MRU order', () => {
    const store = useWorkspaceStore.getState()
    store.selectPanel('p1')
    store.selectPanel('p2')
    const mru = useWorkspaceStore.getState().panelMruOrder
    expect(mru[0]).toBe('p2')
    expect(mru).toContain('p1')
  })
})

// ─── UNDO / REDO ─────────────────────────────────────────────────────────────

describe('Undo / Redo', () => {
  it('undo with no history: state unchanged', () => {
    const before = { ...useWorkspaceStore.getState().panels }
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().panels).toEqual(before)
  })

  it('addPanel + undo: panel gone, future has snapshot', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    expect(useWorkspaceStore.getState().panels['p1']).toBeDefined()
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().panels['p1']).toBeUndefined()
    expect(useWorkspaceStore.getState().future.length).toBeGreaterThan(0)
  })

  it('addPanel + undo + redo: panel restored', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    useWorkspaceStore.getState().undo()
    useWorkspaceStore.getState().redo()
    expect(useWorkspaceStore.getState().panels['p1']).toBeDefined()
  })

  it('redo with no future: state unchanged', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const panelsBefore = { ...useWorkspaceStore.getState().panels }
    useWorkspaceStore.getState().redo()
    expect(useWorkspaceStore.getState().panels).toEqual(panelsBefore)
  })

  it('new action clears future', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().future.length).toBeGreaterThan(0)
    useWorkspaceStore.getState().addPanel(makePanel('p2'))
    expect(useWorkspaceStore.getState().future.length).toBe(0)
  })

  it('multiple undos/redos work in sequence', () => {
    const store = useWorkspaceStore.getState()
    store.addPanel(makePanel('p1'))
    store.addPanel(makePanel('p2'))
    store.addPanel(makePanel('p3'))
    // 3 panels, 3 history entries
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().panels['p3']).toBeUndefined()
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().panels['p2']).toBeUndefined()
    useWorkspaceStore.getState().redo()
    expect(useWorkspaceStore.getState().panels['p2']).toBeDefined()
  })
})

// ─── TAB LIFECYCLE ───────────────────────────────────────────────────────────

describe('Tab Lifecycle', () => {
  it('createTab increases tabs length', () => {
    const before = useWorkspaceStore.getState().tabs.length
    useWorkspaceStore.getState().createTab()
    expect(useWorkspaceStore.getState().tabs.length).toBe(before + 1)
  })

  it('createTab: new tab becomes active', () => {
    const before = useWorkspaceStore.getState().activeTabId
    useWorkspaceStore.getState().createTab()
    expect(useWorkspaceStore.getState().activeTabId).not.toBe(before)
  })

  it('createTab: auto-names Canvas N', () => {
    useWorkspaceStore.getState().createTab()
    const tabs = useWorkspaceStore.getState().tabs
    const latest = tabs[tabs.length - 1]
    expect(latest.title).toMatch(/^Canvas \d+$/)
  })

  it('createTab with custom title', () => {
    useWorkspaceStore.getState().createTab('My Tab')
    const tabs = useWorkspaceStore.getState().tabs
    const latest = tabs[tabs.length - 1]
    expect(latest.title).toBe('My Tab')
  })

  it('switchTab changes activeTabId', () => {
    useWorkspaceStore.getState().createTab('Tab 2')
    const tabs = useWorkspaceStore.getState().tabs
    const firstTabId = tabs[0].id
    useWorkspaceStore.getState().switchTab(firstTabId)
    expect(useWorkspaceStore.getState().activeTabId).toBe(firstTabId)
  })

  it('switchTab restores that tab\'s panels', () => {
    // Add panel to first tab
    useWorkspaceStore.getState().addPanel(makePanel('tab1-panel'))
    const firstTabId = useWorkspaceStore.getState().activeTabId

    // Create second tab (which is now active, empty)
    useWorkspaceStore.getState().createTab('Tab 2')
    expect(useWorkspaceStore.getState().panels['tab1-panel']).toBeUndefined()

    // Switch back
    useWorkspaceStore.getState().switchTab(firstTabId)
    expect(useWorkspaceStore.getState().panels['tab1-panel']).toBeDefined()
  })

  it('switchTab to nonexistent tab: no-op', () => {
    const before = useWorkspaceStore.getState().activeTabId
    useWorkspaceStore.getState().switchTab('nonexistent')
    expect(useWorkspaceStore.getState().activeTabId).toBe(before)
  })

  it('renameTab updates title', () => {
    const tabId = useWorkspaceStore.getState().activeTabId
    useWorkspaceStore.getState().renameTab(tabId, 'Renamed')
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === tabId)!
    expect(tab.title).toBe('Renamed')
  })

  it('renameTab with empty string keeps old title', () => {
    const tabId = useWorkspaceStore.getState().activeTabId
    const oldTitle = useWorkspaceStore.getState().tabs.find(t => t.id === tabId)!.title
    useWorkspaceStore.getState().renameTab(tabId, '   ')
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === tabId)!
    expect(tab.title).toBe(oldTitle)
  })

  it('closeTab: last tab is protected', () => {
    expect(useWorkspaceStore.getState().tabs.length).toBe(1)
    useWorkspaceStore.getState().closeTab(useWorkspaceStore.getState().activeTabId)
    expect(useWorkspaceStore.getState().tabs.length).toBe(1)
  })

  it('closeTab: removes tab and switches to another', () => {
    useWorkspaceStore.getState().createTab('Tab 2')
    const tabs = useWorkspaceStore.getState().tabs
    expect(tabs.length).toBe(2)
    const secondTabId = tabs[1].id
    useWorkspaceStore.getState().closeTab(secondTabId)
    expect(useWorkspaceStore.getState().tabs.length).toBe(1)
    expect(useWorkspaceStore.getState().activeTabId).toBe(tabs[0].id)
  })

  it('reorderTab changes tab order', () => {
    useWorkspaceStore.getState().createTab('Tab 2')
    useWorkspaceStore.getState().createTab('Tab 3')
    const tabs = useWorkspaceStore.getState().tabs
    const [first, second, third] = tabs.map(t => t.id)
    useWorkspaceStore.getState().reorderTab(third, first) // move third before first
    const reordered = useWorkspaceStore.getState().tabs.map(t => t.id)
    expect(reordered.indexOf(third)).toBeLessThan(reordered.indexOf(first))
  })
})

// ─── REGION GROUPING ─────────────────────────────────────────────────────────

describe('Region Grouping', () => {
  it('groupIntoRegion creates a region panel', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1', { x: 100, y: 100 }))
    useWorkspaceStore.getState().addPanel(makePanel('c2', { x: 300, y: 300 }))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'TestRegion')
    const s = useWorkspaceStore.getState()
    expect(s.panels[regionId]).toBeDefined()
    expect(s.panels[regionId].type).toBe('region')
    expect(s.panels[regionId].title).toBe('TestRegion')
  })

  it('groupIntoRegion: children get regionId set', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1'))
    useWorkspaceStore.getState().addPanel(makePanel('c2'))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    const s = useWorkspaceStore.getState()
    expect(s.panels['c1'].regionId).toBe(regionId)
    expect(s.panels['c2'].regionId).toBe(regionId)
  })

  it('groupIntoRegion: region has children array', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1'))
    useWorkspaceStore.getState().addPanel(makePanel('c2'))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    const region = useWorkspaceStore.getState().panels[regionId]
    expect(region.children).toContain('c1')
    expect(region.children).toContain('c2')
  })

  it('groupIntoRegion: region encompasses children with padding', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1', { x: 100, y: 100, width: 200, height: 200 }))
    useWorkspaceStore.getState().addPanel(makePanel('c2', { x: 400, y: 400, width: 200, height: 200 }))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    const region = useWorkspaceStore.getState().panels[regionId]
    // Region should start 20px before children and extend 20px after
    expect(region.x).toBe(80)  // 100 - 20
    expect(region.y).toBe(80)
    // Bounding box: maxX=400+200=600, minX=100 → span=500, +40 padding = 540
    expect(region.width).toBe(540)
  })

  it('groupIntoRegion: returns empty string for no panels', () => {
    const result = useWorkspaceStore.getState().groupIntoRegion([], 'Empty')
    expect(result).toBe('')
  })

  it('ungroupRegion: removes region, clears children regionId', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1'))
    useWorkspaceStore.getState().addPanel(makePanel('c2'))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    useWorkspaceStore.getState().ungroupRegion(regionId)
    const s = useWorkspaceStore.getState()
    expect(s.panels[regionId]).toBeUndefined()
    expect(s.panels['c1'].regionId).toBeUndefined()
    expect(s.panels['c2'].regionId).toBeUndefined()
  })

  it('ungroupRegion: selects the children after ungroup', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1'))
    useWorkspaceStore.getState().addPanel(makePanel('c2'))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    useWorkspaceStore.getState().ungroupRegion(regionId)
    const sel = useWorkspaceStore.getState().selectedPanelIds
    expect(sel).toContain('c1')
    expect(sel).toContain('c2')
  })

  it('ungroupRegion: no-op for non-region panel', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const panelsBefore = { ...useWorkspaceStore.getState().panels }
    useWorkspaceStore.getState().ungroupRegion('p1')
    // p1 should still exist (not deleted because it's not a region)
    expect(useWorkspaceStore.getState().panels['p1']).toBeDefined()
  })
})

// ─── PANEL STACKING ──────────────────────────────────────────────────────────

describe('Panel Stacking', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().addPanel(makePanel('host', { x: 0, y: 0, width: 600, height: 400 }))
    useWorkspaceStore.getState().addPanel(makePanel('child', { x: 100, y: 100, width: 500, height: 300 }))
  })

  it('stackPanels: host gets stackChildren', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    const host = useWorkspaceStore.getState().panels['host']
    expect(host.stackChildren).toContain('child')
  })

  it('stackPanels: child gets stackParentId', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    const child = useWorkspaceStore.getState().panels['child']
    expect(child.stackParentId).toBe('host')
  })

  it('stackPanels: child preStackBbox saved', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    const child = useWorkspaceStore.getState().panels['child']
    expect(child.preStackBbox).toEqual({ x: 100, y: 100, width: 500, height: 300 })
  })

  it('stackPanels: host gets stackActive', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    const host = useWorkspaceStore.getState().panels['host']
    expect(host.stackActive).toBe('host')
  })

  it('stackPanels: region as host is rejected', () => {
    useWorkspaceStore.getState().addPanel(makePanel('region-host', { type: 'region' }))
    useWorkspaceStore.getState().stackPanels('region-host', ['child'])
    const child = useWorkspaceStore.getState().panels['child']
    expect(child.stackParentId).toBeUndefined()
  })

  it('setStackActive: updates host stackActive', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    useWorkspaceStore.getState().setStackActive('host', 'child')
    expect(useWorkspaceStore.getState().panels['host'].stackActive).toBe('child')
  })

  it('setStackActive: rejects invalid activeId', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    useWorkspaceStore.getState().setStackActive('host', 'nonexistent')
    expect(useWorkspaceStore.getState().panels['host'].stackActive).toBe('host')
  })

  it('unstackPanel: child removed from host, positioned next to it', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    useWorkspaceStore.getState().unstackPanel('child')
    const s = useWorkspaceStore.getState()
    const host = s.panels['host']
    const child = s.panels['child']
    expect(host.stackChildren).toBeUndefined()
    expect(child.stackParentId).toBeUndefined()
    // Child should be positioned next to host
    expect(child.x).toBe(host.x + host.width + 24)
  })

  it('unstackPanel: restores preStackBbox dimensions', () => {
    useWorkspaceStore.getState().stackPanels('host', ['child'])
    useWorkspaceStore.getState().unstackPanel('child')
    const child = useWorkspaceStore.getState().panels['child']
    expect(child.width).toBe(500)
    expect(child.height).toBe(300)
    expect(child.preStackBbox).toBeUndefined()
  })

  it('unstackPanel on host: promotes first child to new host', () => {
    useWorkspaceStore.getState().addPanel(makePanel('child2', { x: 200, y: 200, width: 400, height: 300 }))
    useWorkspaceStore.getState().stackPanels('host', ['child', 'child2'])
    useWorkspaceStore.getState().unstackPanel('host')
    const s = useWorkspaceStore.getState()
    // 'child' should now be the new host
    const newHost = s.panels['child']
    expect(newHost.stackParentId).toBeUndefined()
    expect(newHost.stackChildren).toContain('child2')
    // child2 should reference child as parent
    expect(s.panels['child2'].stackParentId).toBe('child')
  })
})

// ─── ANNOTATIONS ─────────────────────────────────────────────────────────────

describe('Annotations', () => {
  it('addAnnotation: appears in active tab', () => {
    useWorkspaceStore.getState().addAnnotation(makeAnnotation('a1'))
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab.annotations).toBeDefined()
    expect(tab.annotations!.some(a => a.id === 'a1')).toBe(true)
  })

  it('updateAnnotation: partial merge', () => {
    useWorkspaceStore.getState().addAnnotation(makeAnnotation('a1', { title: 'Old' }))
    useWorkspaceStore.getState().updateAnnotation('a1', { title: 'New' })
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    const anno = tab.annotations!.find(a => a.id === 'a1')!
    expect(anno.title).toBe('New')
  })

  it('deleteAnnotation: removed', () => {
    useWorkspaceStore.getState().addAnnotation(makeAnnotation('a1'))
    useWorkspaceStore.getState().deleteAnnotation('a1')
    const tab = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab.annotations!.some(a => a.id === 'a1')).toBe(false)
  })

  it('selectAnnotation: sets selectedAnnotationIds', () => {
    useWorkspaceStore.getState().addAnnotation(makeAnnotation('a1'))
    useWorkspaceStore.getState().selectAnnotation('a1')
    expect(useWorkspaceStore.getState().selectedAnnotationIds).toEqual(['a1'])
  })

  it('clearAnnotationSelection: empties array', () => {
    useWorkspaceStore.getState().selectAnnotation('a1')
    useWorkspaceStore.getState().clearAnnotationSelection()
    expect(useWorkspaceStore.getState().selectedAnnotationIds).toEqual([])
  })

  it('annotation undo/redo in annotateMode', () => {
    // Enter annotate mode
    useWorkspaceStore.getState().toggleAnnotateMode()
    expect(useWorkspaceStore.getState().annotateMode).toBe(true)

    // Add annotation
    useWorkspaceStore.getState().addAnnotation(makeAnnotation('a1'))
    const tab1 = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab1.annotations!.length).toBe(1)

    // Undo
    useWorkspaceStore.getState().undoAnnotation()
    const tab2 = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab2.annotations!.length).toBe(0)

    // Redo
    useWorkspaceStore.getState().redoAnnotation()
    const tab3 = useWorkspaceStore.getState().tabs.find(t => t.id === useWorkspaceStore.getState().activeTabId)!
    expect(tab3.annotations!.length).toBe(1)
  })

  it('undoAnnotation with no history: no-op', () => {
    useWorkspaceStore.getState().undoAnnotation()
    // Should not crash
    expect(useWorkspaceStore.getState().annotationPast).toEqual([])
  })

  it('redoAnnotation with no future: no-op', () => {
    useWorkspaceStore.getState().redoAnnotation()
    expect(useWorkspaceStore.getState().annotationFuture).toEqual([])
  })
})

// ─── CANVAS PRESETS ──────────────────────────────────────────────────────────

describe('Canvas Presets', () => {
  it('saveCanvasPreset: creates entry', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const id = useWorkspaceStore.getState().saveCanvasPreset('My Layout')
    expect(id).toBeTruthy()
    const presets = useWorkspaceStore.getState().canvasPresets
    expect(presets[id]).toBeDefined()
    expect(presets[id].name).toBe('My Layout')
  })

  it('saveCanvasPreset: captures current panels', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const id = useWorkspaceStore.getState().saveCanvasPreset('Test')
    const preset = useWorkspaceStore.getState().canvasPresets[id]
    expect(preset.panels['p1']).toBeDefined()
  })

  it('saveCanvasPreset: trims whitespace, defaults to Untitled', () => {
    const id = useWorkspaceStore.getState().saveCanvasPreset('   ')
    expect(useWorkspaceStore.getState().canvasPresets[id].name).toBe('Untitled')
  })

  it('deleteCanvasPreset: removes entry', () => {
    const id = useWorkspaceStore.getState().saveCanvasPreset('Test')
    useWorkspaceStore.getState().deleteCanvasPreset(id)
    expect(useWorkspaceStore.getState().canvasPresets[id]).toBeUndefined()
  })

  it('renameCanvasPreset: updates name', () => {
    const id = useWorkspaceStore.getState().saveCanvasPreset('Old Name')
    useWorkspaceStore.getState().renameCanvasPreset(id, 'New Name')
    expect(useWorkspaceStore.getState().canvasPresets[id].name).toBe('New Name')
  })

  it('renameCanvasPreset: no-op for nonexistent preset', () => {
    useWorkspaceStore.getState().renameCanvasPreset('ghost', 'Whatever')
    // Should not crash or create entry
    expect(useWorkspaceStore.getState().canvasPresets['ghost']).toBeUndefined()
  })

  it('overwriteCanvasPreset: updates savedAt and panels', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const id = useWorkspaceStore.getState().saveCanvasPreset('Test')
    const oldSavedAt = useWorkspaceStore.getState().canvasPresets[id].savedAt

    // Add another panel, then overwrite
    useWorkspaceStore.getState().addPanel(makePanel('p2'))
    vi.spyOn(Date, 'now').mockReturnValue(9999999)
    useWorkspaceStore.getState().overwriteCanvasPreset(id)

    const updated = useWorkspaceStore.getState().canvasPresets[id]
    expect(updated.savedAt).toBe(9999999)
    expect(updated.panels['p2']).toBeDefined()
  })
})

// ─── VIEWPORT BOOKMARKS ─────────────────────────────────────────────────────

describe('Viewport Bookmarks', () => {
  it('saveViewportBookmark: stores current viewport', () => {
    useWorkspaceStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    useWorkspaceStore.getState().saveViewportBookmark(1)
    const bookmarks = useWorkspaceStore.getState().viewportBookmarks
    expect(bookmarks[1]).toEqual({ x: 100, y: 200, zoom: 1.5 })
  })

  it('loadViewportBookmark: restores viewport', () => {
    useWorkspaceStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
    useWorkspaceStore.getState().saveViewportBookmark(1)
    useWorkspaceStore.getState().setViewport({ x: 0, y: 0, zoom: 1 })
    useWorkspaceStore.getState().loadViewportBookmark(1)
    const vp = useWorkspaceStore.getState().viewport
    expect(vp.x).toBe(100)
    expect(vp.y).toBe(200)
    expect(vp.zoom).toBe(1.5)
  })

  it('loadViewportBookmark: nonexistent key is no-op', () => {
    const before = { ...useWorkspaceStore.getState().viewport }
    useWorkspaceStore.getState().loadViewportBookmark(99)
    expect(useWorkspaceStore.getState().viewport).toEqual(before)
  })
})

// ─── PANEL MRU ───────────────────────────────────────────────────────────────

describe('Panel MRU', () => {
  it('pushPanelMru: id moves to front', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    useWorkspaceStore.getState().addPanel(makePanel('p2'))
    useWorkspaceStore.getState().pushPanelMru('p1')
    useWorkspaceStore.getState().pushPanelMru('p2')
    expect(useWorkspaceStore.getState().panelMruOrder[0]).toBe('p2')
  })

  it('pushPanelMru: no duplicates', () => {
    useWorkspaceStore.getState().pushPanelMru('p1')
    useWorkspaceStore.getState().pushPanelMru('p1')
    const mru = useWorkspaceStore.getState().panelMruOrder
    const p1Count = mru.filter(id => id === 'p1').length
    expect(p1Count).toBe(1)
  })

  it('panelMruOrder capped at 20', () => {
    for (let i = 0; i < 25; i++) {
      useWorkspaceStore.getState().pushPanelMru(`panel-${i}`)
    }
    expect(useWorkspaceStore.getState().panelMruOrder.length).toBeLessThanOrEqual(20)
  })
})

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────

describe('Export / Import', () => {
  it('exportWorkspace: returns valid JSON containing tabs', () => {
    useWorkspaceStore.getState().addPanel(makePanel('p1'))
    const json = useWorkspaceStore.getState().exportWorkspace()
    const data = JSON.parse(json)
    expect(data.version).toBe(1)
    expect(data.tabs).toBeDefined()
    expect(Array.isArray(data.tabs)).toBe(true)
    expect(data.tabs.length).toBeGreaterThan(0)
    // Panel should be inside the tab
    const tab = data.tabs.find((t: WorkspaceTab) => t.id === data.activeTabId)
    expect(tab.panels['p1']).toBeDefined()
  })

  it('importWorkspace: restores panels and tabs', () => {
    // Create some state
    useWorkspaceStore.getState().addPanel(makePanel('original'))
    const json = useWorkspaceStore.getState().exportWorkspace()

    // Modify state
    useWorkspaceStore.getState().addPanel(makePanel('extra'))

    // Import original
    const result = useWorkspaceStore.getState().importWorkspace(json)
    expect(result).toBe(true)
    expect(useWorkspaceStore.getState().panels['original']).toBeDefined()
    // 'extra' should be gone (replaced by import)
    expect(useWorkspaceStore.getState().panels['extra']).toBeUndefined()
  })

  it('importWorkspace: invalid JSON returns false', () => {
    const result = useWorkspaceStore.getState().importWorkspace('not json!!!')
    expect(result).toBe(false)
  })

  it('importWorkspace: missing tabs returns false', () => {
    const result = useWorkspaceStore.getState().importWorkspace('{"version":1}')
    expect(result).toBe(false)
  })

  it('importWorkspace: empty tabs array returns false', () => {
    const result = useWorkspaceStore.getState().importWorkspace('{"tabs":[]}')
    expect(result).toBe(false)
  })

  it('importWorkspace: invalid tab shape is filtered', () => {
    const json = JSON.stringify({
      tabs: [
        { id: 'good', title: 'T', panels: {}, viewport: { x: 0, y: 0, zoom: 1 }, selectedPanelIds: [], createdAt: 0 },
        { broken: true } // missing required fields
      ],
      activeTabId: 'good'
    })
    const result = useWorkspaceStore.getState().importWorkspace(json)
    expect(result).toBe(true)
    expect(useWorkspaceStore.getState().tabs.length).toBe(1)
  })

  it('round-trip: export then import preserves state', () => {
    useWorkspaceStore.getState().addPanel(makePanel('rt1', { x: 42, y: 99, title: 'RoundTrip' }))
    const json = useWorkspaceStore.getState().exportWorkspace()

    // Add a different panel to prove import replaces state
    useWorkspaceStore.getState().addPanel(makePanel('noise'))

    // Import the earlier export (uses importWorkspace, NOT setState replace)
    const ok = useWorkspaceStore.getState().importWorkspace(json)
    expect(ok).toBe(true)
    const p = useWorkspaceStore.getState().panels['rt1']
    expect(p).toBeDefined()
    expect(p.x).toBe(42)
    expect(p.title).toBe('RoundTrip')
    // 'noise' panel should be gone (replaced by import)
    expect(useWorkspaceStore.getState().panels['noise']).toBeUndefined()
  })
})

// ─── QUERY HELPERS ───────────────────────────────────────────────────────────

describe('Query Helpers', () => {
  it('getPanelsByType: returns only matching type', () => {
    useWorkspaceStore.getState().addPanel(makePanel('t1', { type: 'terminal' }))
    useWorkspaceStore.getState().addPanel(makePanel('t2', { type: 'terminal' }))
    useWorkspaceStore.getState().addPanel(makePanel('b1', { type: 'browser' }))
    const terminals = useWorkspaceStore.getState().getPanelsByType('terminal')
    expect(terminals.length).toBe(2)
    terminals.forEach(p => expect(p.type).toBe('terminal'))
  })

  it('getPanelsByType: returns empty for no matches', () => {
    useWorkspaceStore.getState().addPanel(makePanel('t1', { type: 'terminal' }))
    expect(useWorkspaceStore.getState().getPanelsByType('editor').length).toBe(0)
  })

  it('getPanelsInRegion: returns children of region', () => {
    useWorkspaceStore.getState().addPanel(makePanel('c1'))
    useWorkspaceStore.getState().addPanel(makePanel('c2'))
    useWorkspaceStore.getState().addPanel(makePanel('outside'))
    const regionId = useWorkspaceStore.getState().groupIntoRegion(['c1', 'c2'], 'R')
    const inRegion = useWorkspaceStore.getState().getPanelsInRegion(regionId)
    expect(inRegion.length).toBe(2)
    expect(inRegion.map(p => p.id).sort()).toEqual(['c1', 'c2'])
  })
})

// ─── UI TOGGLES ──────────────────────────────────────────────────────────────

describe('UI Toggles', () => {
  it('toggleMinimap', () => {
    const before = useWorkspaceStore.getState().minimapVisible
    useWorkspaceStore.getState().toggleMinimap()
    expect(useWorkspaceStore.getState().minimapVisible).toBe(!before)
  })

  it('toggleHelp', () => {
    expect(useWorkspaceStore.getState().helpOpen).toBe(false)
    useWorkspaceStore.getState().toggleHelp()
    expect(useWorkspaceStore.getState().helpOpen).toBe(true)
  })

  it('toggleChrome', () => {
    expect(useWorkspaceStore.getState().chromeVisible).toBe(true)
    useWorkspaceStore.getState().toggleChrome()
    expect(useWorkspaceStore.getState().chromeVisible).toBe(false)
  })

  it('toggleBars: if either showing, hide both', () => {
    useWorkspaceStore.setState({ chromeVisible: true, statusBarVisible: false })
    useWorkspaceStore.getState().toggleBars()
    const s = useWorkspaceStore.getState()
    expect(s.chromeVisible).toBe(false)
    expect(s.statusBarVisible).toBe(false)
  })

  it('toggleBars: if both hidden, show both', () => {
    useWorkspaceStore.setState({ chromeVisible: false, statusBarVisible: false })
    useWorkspaceStore.getState().toggleBars()
    const s = useWorkspaceStore.getState()
    expect(s.chromeVisible).toBe(true)
    expect(s.statusBarVisible).toBe(true)
  })

  it('enterFocusMode: hides chrome, statusBar, minimap', () => {
    useWorkspaceStore.getState().enterFocusMode()
    const s = useWorkspaceStore.getState()
    expect(s.chromeVisible).toBe(false)
    expect(s.statusBarVisible).toBe(false)
    expect(s.minimapVisible).toBe(false)
  })

  it('toggleSidebar', () => {
    expect(useWorkspaceStore.getState().sidebarOpen).toBe(false)
    useWorkspaceStore.getState().toggleSidebar()
    expect(useWorkspaceStore.getState().sidebarOpen).toBe(true)
  })

  it('setSidebarSection: sets section and opens sidebar', () => {
    useWorkspaceStore.getState().setSidebarSection('git')
    const s = useWorkspaceStore.getState()
    expect(s.sidebarSection).toBe('git')
    expect(s.sidebarOpen).toBe(true)
  })

  it('toggleAnnotateMode: toggles mode', () => {
    expect(useWorkspaceStore.getState().annotateMode).toBe(false)
    useWorkspaceStore.getState().toggleAnnotateMode()
    expect(useWorkspaceStore.getState().annotateMode).toBe(true)
    useWorkspaceStore.getState().toggleAnnotateMode()
    expect(useWorkspaceStore.getState().annotateMode).toBe(false)
  })

  it('toggleAnnotateMode: entering sets tool to select', () => {
    useWorkspaceStore.getState().toggleAnnotateMode()
    expect(useWorkspaceStore.getState().annotateTool).toBe('select')
  })

  it('updatePrefs: merges partial', () => {
    useWorkspaceStore.getState().updatePrefs({ fontSize: 20 })
    expect(useWorkspaceStore.getState().prefs.fontSize).toBe(20)
  })

  it('updatePrefs: preserves unmodified prefs', () => {
    const oldDensity = useWorkspaceStore.getState().prefs.density
    useWorkspaceStore.getState().updatePrefs({ fontSize: 20 })
    expect(useWorkspaceStore.getState().prefs.density).toBe(oldDensity)
  })
})

// ─── VIEWPORT ────────────────────────────────────────────────────────────────

describe('Viewport', () => {
  it('setViewport: partial update', () => {
    useWorkspaceStore.getState().setViewport({ zoom: 2 })
    expect(useWorkspaceStore.getState().viewport.zoom).toBe(2)
  })

  it('setViewport: preserves unmentioned fields', () => {
    useWorkspaceStore.getState().setViewport({ x: 100 })
    const vp = useWorkspaceStore.getState().viewport
    expect(vp.x).toBe(100)
    expect(vp.y).toBe(0) // unchanged
    expect(vp.zoom).toBe(1) // unchanged
  })
})

// ─── DEFAULT_KEYBINDINGS ────────────────────────────────────────────────────

describe('DEFAULT_KEYBINDINGS', () => {
  it('is an object with string values', () => {
    expect(typeof DEFAULT_KEYBINDINGS).toBe('object')
    Object.entries(DEFAULT_KEYBINDINGS).forEach(([key, value]) => {
      expect(typeof key).toBe('string')
      expect(typeof value).toBe('string')
    })
  })

  it('has essential keybindings', () => {
    expect(DEFAULT_KEYBINDINGS['undo']).toBe('ctrl+z')
    expect(DEFAULT_KEYBINDINGS['redo']).toBe('ctrl+y')
    expect(DEFAULT_KEYBINDINGS['toggle-command-palette']).toBe('ctrl+p')
    expect(DEFAULT_KEYBINDINGS['toggle-help']).toBe('?')
  })
})
