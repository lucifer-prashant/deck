import { Panel, useWorkspaceStore } from './store/workspaceStore'
import { grid, masonry, golden, clusterByType, type LayoutStrategy } from './layoutEngine'

export type WorkspaceCommand =
  | 'new-terminal'
  | 'new-editor'
  | 'new-browser'
  | 'new-region'
  | 'new-tab'
  | 'clear-selection'
  | 'clear-canvas'
  | 'toggle-minimap'
  | 'select-all'
  | 'duplicate-selected'
  | 'fit-all'
  | 'reset-viewport'
  | 'zoom-in'
  | 'zoom-out'
  | 'align-left'
  | 'align-top'
  | 'align-right'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical'
  | 'group-region'
  | 'ungroup-region'
  | 'rename-selected'
  | 'toggle-lock'
  | 'toggle-minimize'
  | 'bring-front'
  | 'send-back'
  | 'toggle-pin-front'
  | 'focus-selected'
  | 'stack-selected'
  | 'unstack-selected'
  | 'toggle-help'
  | 'arrange-selected'

// Last used layout strategy (persisted per session).
let lastArrangeStrategy: LayoutStrategy = 'grid'

const panelDefaults: Record<Panel['type'], Pick<Panel, 'width' | 'height' | 'title'> & { content?: string }> = {
  terminal: { width: 600, height: 400, title: 'Terminal' },
  editor: { width: 1100, height: 760, title: 'Editor' },
  browser: { width: 720, height: 560, title: 'Browser' },
  region: { width: 800, height: 600, title: 'Region' }
}

const getSpawnPosition = (width: number, height: number) => {
  const { cursorWorldPos } = useWorkspaceStore.getState()
  // Spawn centered on cursor in world space.
  return {
    x: cursorWorldPos.x - width / 2,
    y: cursorWorldPos.y - height / 2
  }
}

export const createPanelAtViewportCenter = (type: Panel['type']) => {
  const defaults = panelDefaults[type]
  const position = getSpawnPosition(defaults.width, defaults.height)
  const id = `${type}-${Date.now()}`

  const panel = {
    id,
    type,
    x: position.x,
    y: position.y,
    ...defaults
  }
  const store = useWorkspaceStore.getState()
  store.addPanel(panel)
  store.selectPanel(id)
}

export const getPanelBounds = (panels: Panel[]) => {
  if (panels.length === 0) return null
  const minX = Math.min(...panels.map(p => p.x))
  const minY = Math.min(...panels.map(p => p.y))
  const maxX = Math.max(...panels.map(p => p.x + p.width))
  const maxY = Math.max(...panels.map(p => p.y + p.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export const flagSmoothViewport = () => {
  window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
}

export const fitPanelsToViewport = (panels: Panel[]) => {
  flagSmoothViewport()
  const bounds = getPanelBounds(panels)
  const store = useWorkspaceStore.getState()
  if (!bounds) {
    store.setViewport({ x: 0, y: 0, zoom: 1 })
    return
  }

  const padding = 96
  const zoom = Math.max(0.02, Math.min(2, Math.min(
    (window.innerWidth - padding * 2) / Math.max(bounds.width, 1),
    (window.innerHeight - padding * 2) / Math.max(bounds.height, 1)
  )))

  store.setViewport({
    zoom,
    x: window.innerWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: window.innerHeight / 2 - (bounds.y + bounds.height / 2) * zoom
  })
}

export const fitItemsToViewport = (items: Array<{ x: number; y: number; width: number; height: number }>) => {
  flagSmoothViewport()
  if (items.length === 0) return
  const minX = Math.min(...items.map(i => i.x))
  const minY = Math.min(...items.map(i => i.y))
  const maxX = Math.max(...items.map(i => i.x + i.width))
  const maxY = Math.max(...items.map(i => i.y + i.height))
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  const padding = 96
  const store = useWorkspaceStore.getState()
  const zoom = Math.max(0.02, Math.min(2, Math.min(
    (window.innerWidth - padding * 2) / Math.max(bounds.width, 1),
    (window.innerHeight - padding * 2) / Math.max(bounds.height, 1)
  )))

  store.setViewport({
    zoom,
    x: window.innerWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: window.innerHeight / 2 - (bounds.y + bounds.height / 2) * zoom
  })
}

const getSelectedPanels = () => {
  const store = useWorkspaceStore.getState()
  return store.selectedPanelIds.map(id => store.panels[id]).filter(Boolean)
}

const updateSelected = (updates: Partial<Panel>) => {
  const store = useWorkspaceStore.getState()
  store.selectedPanelIds.forEach(id => store.updatePanel(id, updates))
}

const duplicateSelected = () => {
  const store = useWorkspaceStore.getState()
  const newPanelIds: string[] = []
  const selected = getSelectedPanels()
  const offsetBase = 32
  selected.forEach((panel, i) => {
    const id = `${panel.type}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`
    newPanelIds.push(id)
    const all = Object.values(store.panels)
    let step = 1
    while (all.some(p => Math.abs(p.x - (panel.x + step * offsetBase)) < 4 && Math.abs(p.y - (panel.y + step * offsetBase)) < 4)) {
      step++
    }
    store.addPanel({
      ...panel,
      id,
      title: `${panel.title} Copy`,
      x: panel.x + step * offsetBase,
      y: panel.y + step * offsetBase,
      children: panel.children ? [...panel.children] : undefined,
      regionId: undefined,
      pinFront: false,
      pinBack: false
    })
  })
  if (newPanelIds.length > 0) store.selectMultiple(newPanelIds)

  const newAnnoIds: string[] = []
  const tab = store.tabs.find(t => t.id === store.activeTabId)
  if (tab?.annotations && store.selectedAnnotationIds.length > 0) {
    const selectedAnnos = tab.annotations.filter(a => store.selectedAnnotationIds.includes(a.id))
    selectedAnnos.forEach((a, i) => {
      const id = `anno-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
      newAnnoIds.push(id)
      store.addAnnotation({
        ...a,
        id,
        x: a.x + offsetBase,
        y: a.y + offsetBase,
        title: (a.title || 'Annotation') + ' Copy'
      })
    })
  }
  if (newAnnoIds.length > 0) store.selectMultipleAnnotations(newAnnoIds)
}

const alignSelected = (edge: 'left' | 'top' | 'right' | 'bottom') => {
  const panels = getSelectedPanels()
  if (panels.length < 2) return
  const bounds = getPanelBounds(panels)
  if (!bounds) return
  const store = useWorkspaceStore.getState()
  panels.forEach(panel => {
    if (edge === 'left') store.movePanel(panel.id, bounds.x, panel.y)
    if (edge === 'top') store.movePanel(panel.id, panel.x, bounds.y)
    if (edge === 'right') store.movePanel(panel.id, bounds.x + bounds.width - panel.width, panel.y)
    if (edge === 'bottom') store.movePanel(panel.id, panel.x, bounds.y + bounds.height - panel.height)
  })
}

const distributeSelected = (axis: 'horizontal' | 'vertical') => {
  const panels = getSelectedPanels()
    .filter(p => p.type !== 'region')
    .sort((a, b) =>
      axis === 'horizontal'
        ? (a.x + a.width / 2) - (b.x + b.width / 2)
        : (a.y + a.height / 2) - (b.y + b.height / 2)
    )
  if (panels.length < 2) return
  const store = useWorkspaceStore.getState()
  const sizes = panels.map(p => axis === 'horizontal' ? p.width : p.height)
  const totalSize = sizes.reduce((s, n) => s + n, 0)
  const n = panels.length
  const MIN_GAP = 20

  // Original span: from first.start to last.end.
  const startEdge = axis === 'horizontal' ? panels[0].x : panels[0].y
  const lastP = panels[n - 1]
  const endEdge = axis === 'horizontal' ? lastP.x + lastP.width : lastP.y + lastP.height
  const originalSpan = Math.max(endEdge - startEdge, 0)

  // Required span = sum of sizes + min gaps between them.
  const requiredSpan = totalSize + Math.max(0, n - 1) * MIN_GAP
  // Final span: never less than required (so no overlap), keep current if larger.
  const finalSpan = Math.max(originalSpan, requiredSpan)
  // Gap between adjacent panels.
  const gap = n > 1 ? (finalSpan - totalSize) / (n - 1) : 0
  // Anchor the layout around the midpoint of the original span so it expands symmetrically.
  const midpoint = (startEdge + endEdge) / 2
  let cursor = midpoint - finalSpan / 2

  panels.forEach((panel, i) => {
    const size = sizes[i]
    if (axis === 'horizontal') store.movePanel(panel.id, cursor, panel.y)
    else store.movePanel(panel.id, panel.x, cursor)
    cursor += size + gap
  })
}

const promptRenameSelected = () => {
  const panels = getSelectedPanels()
  if (panels.length !== 1) return
  const title = window.prompt('Panel title', panels[0].title)
  if (title !== null) useWorkspaceStore.getState().updatePanel(panels[0].id, { title: title.trim() || panels[0].title })
}

export const executeWorkspaceCommand = (command: WorkspaceCommand) => {
  const store = useWorkspaceStore.getState()

  switch (command) {
    case 'new-terminal':
      createPanelAtViewportCenter('terminal')
      break
    case 'new-editor':
      createPanelAtViewportCenter('editor')
      break
    case 'new-browser':
      createPanelAtViewportCenter('browser')
      break
    case 'new-region':
      createPanelAtViewportCenter('region')
      break
    case 'new-tab':
      store.createTab()
      break
    case 'clear-selection':
      store.clearSelection()
      break
    case 'clear-canvas': {
      const count = Object.keys(store.panels).length
      if (count === 0) break
      // Offer save before clearing.
      const activeTab = store.tabs.find(t => t.id === store.activeTabId)
      const linkedPreset = activeTab?.linkedPresetId ? store.canvasPresets[activeTab.linkedPresetId] : null
      const wantSave = window.confirm(
        linkedPreset
          ? `Save changes to preset "${linkedPreset.name}" before clearing?`
          : `Save canvas as a preset before clearing?`
      )
      if (wantSave) {
        if (linkedPreset) {
          store.overwriteCanvasPreset(linkedPreset.id)
          store.markTabSaved()
        } else {
          const name = window.prompt('Preset name:', activeTab?.title || 'Canvas')
          if (name?.trim()) {
            store.saveCanvasPreset(name.trim())
            store.markTabSaved()
          }
        }
      }
      const ok = window.confirm(
        `Clear canvas?\n\n${count} panel${count === 1 ? '' : 's'} will be deleted from this tab. This cannot be undone after the tab switches.`
      )
      if (!ok) break
      Object.keys(store.panels).forEach(id => store.deletePanel(id))
      break
    }
    case 'toggle-minimap':
      store.toggleMinimap()
      break
    case 'select-all':
      store.selectMultiple(Object.keys(store.panels))
      {
        const tab = store.tabs.find(t => t.id === store.activeTabId)
        if (tab?.annotations) {
          const domTypes = new Set(['sticky', 'label', 'image'])
          const annoIds = tab.annotations.filter(a => domTypes.has(a.type)).map(a => a.id)
          if (annoIds.length > 0) store.selectMultipleAnnotations(annoIds)
        }
      }
      break
    case 'duplicate-selected':
      duplicateSelected()
      break
    case 'fit-all':
      fitPanelsToViewport(Object.values(store.panels))
      break
    case 'reset-viewport':
      flagSmoothViewport()
      store.setViewport({ x: 0, y: 0, zoom: 1 })
      break
    case 'zoom-in':
      flagSmoothViewport()
      store.setViewport({ zoom: Math.min(10, store.viewport.zoom * 1.2) })
      break
    case 'zoom-out':
      flagSmoothViewport()
      store.setViewport({ zoom: Math.max(0.1, store.viewport.zoom / 1.2) })
      break
    case 'align-left':
      alignSelected('left')
      break
    case 'align-top':
      alignSelected('top')
      break
    case 'align-right':
      alignSelected('right')
      break
    case 'align-bottom':
      alignSelected('bottom')
      break
    case 'distribute-horizontal':
      distributeSelected('horizontal')
      break
    case 'distribute-vertical':
      distributeSelected('vertical')
      break
    case 'group-region':
      if (store.selectedPanelIds.length > 0) store.groupIntoRegion(store.selectedPanelIds, 'Region')
      break
    case 'ungroup-region':
      store.selectedPanelIds.forEach(id => store.ungroupRegion(id))
      break
    case 'stack-selected': {
      // Merge selected panels into the topmost (first selected) as the host.
      const ids = store.selectedPanelIds.filter(id => {
        const p = store.panels[id]
        return p && p.type !== 'region'
      })
      if (ids.length >= 2) store.stackPanels(ids[0], ids.slice(1))
      break
    }
    case 'unstack-selected':
      store.selectedPanelIds.forEach(id => store.unstackPanel(id))
      break
    case 'rename-selected':
      promptRenameSelected()
      break
    case 'toggle-lock':
      updateSelected({ locked: !getSelectedPanels().every(panel => panel.locked) })
      break
    case 'toggle-minimize':
      updateSelected({ minimized: !getSelectedPanels().every(panel => panel.minimized) })
      break
    case 'bring-front': {
      const top = Math.max(1, ...Object.values(store.panels).map(panel => panel.zIndex || 1))
      store.selectedPanelIds.forEach((id, index) => store.updatePanel(id, { zIndex: top + index + 1 }))
      break
    }
    case 'send-back':
      store.selectedPanelIds.forEach(id => store.updatePanel(id, { zIndex: 1 }))
      break
    case 'focus-selected': {
      const selected = getSelectedPanels()
      if (selected.length === 0) return
      const bounds = getPanelBounds(selected)
      if (!bounds) return
      flagSmoothViewport()
      const s = useWorkspaceStore.getState()
      // Sidebar is a fixed overlay — when open, usable width shrinks.
      const sidebarW = s.sidebarOpen ? 320 : 0
      const padX = 40
      // Dynamic vertical padding — accounts for chrome/status bar visibility.
      // In focus mode both are hidden, so we get the full viewport.
      const chromePad = s.chromeVisible ? 44 : 8
      const statusPad = s.statusBarVisible ? 32 : 8
      const availW = window.innerWidth - sidebarW - padX * 2
      const availH = window.innerHeight - chromePad - statusPad
      // Fit-zoom: panel fills the tighter dimension.
      const zoomX = availW / Math.max(bounds.width, 1)
      const zoomY = availH / Math.max(bounds.height, 1)
      const zoom = Math.max(0.1, Math.min(3.0, Math.min(zoomX, zoomY)))
      // Center in the usable area.
      const cx = bounds.x + bounds.width / 2
      const cy = bounds.y + bounds.height / 2
      s.setViewport({
        zoom,
        x: sidebarW + padX + availW / 2 - cx * zoom,
        y: chromePad + availH / 2 - cy * zoom,
      })
      break
    }
    case 'toggle-pin-front': {
      const selected = getSelectedPanels()
      if (selected.length === 0) break
      const allPinned = selected.every(p => p.pinFront)
      const nextPinned = !allPinned
      // Toggling pin-front always clears pin-back to keep mutex consistent.
      selected.forEach(p => store.updatePanel(p.id, { pinFront: nextPinned, pinBack: false }))
      break
    }
    case 'toggle-help':
      store.toggleHelp()
      break
    case 'arrange-selected': {
      const selected = getSelectedPanels().filter(p => p.type !== 'region')
      if (selected.length === 0) break
      const bounds = getPanelBounds(selected)
      if (!bounds) break
      // Add some padding around the bounding box for the layout area.
      const PAD = 40
      const tx = bounds.x - PAD
      const ty = bounds.y - PAD
      const tw = bounds.width + PAD * 2
      const th = bounds.height + PAD * 2

      const layoutFn = {
        grid: grid,
        masonry: masonry,
        golden: golden,
        cluster: clusterByType,
      }[lastArrangeStrategy] ?? grid

      const result = layoutFn(selected, tx, ty, tw, th)
      result.forEach((layout, id) => {
        store.resizePanel(id, layout.width, layout.height)
        store.movePanel(id, layout.x, layout.y)
      })
      // Cycle to next strategy for next invocation.
      const strategies: LayoutStrategy[] = ['grid', 'masonry', 'golden', 'cluster']
      lastArrangeStrategy = strategies[(strategies.indexOf(lastArrangeStrategy) + 1) % strategies.length]
      break
    }
  }
}
