import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Dual storage: writes to BOTH a flat JSON file (via Electron IPC) AND localStorage.
// On read, prefers the file — localStorage is stored inside Chromium's LevelDB which
// gets wiped whenever Chromium resets its quota database (common on Linux dev builds).
// The file lives in ~/.config/deck/ alongside the app's own userData, unaffected by
// Chromium storage quota resets.
let _appDataHome: string | null = null
const getAppDataHome = (): Promise<string | null> => {
  if (_appDataHome !== null) return Promise.resolve(_appDataHome)
  return (window.electronAPI?.fs?.home?.() ?? Promise.resolve(null))
    .then(h => { _appDataHome = h ?? null; return _appDataHome })
    .catch(() => { _appDataHome = null; return null })
}

// Pre-warm the home dir cache as soon as the module loads so the first setItem
// file write doesn't block on an IPC round-trip.
getAppDataHome().catch(() => null)

// Returns true if the serialized zustand state has at least one panel somewhere.
// Used to prevent writing/loading empty state to the backup file — if Chromium
// quota-resets and wipes localStorage, the last known good file state is preserved.
const hasAnyContent = (value: string): boolean => {
  try {
    const parsed = JSON.parse(value)
    const state = parsed?.state
    const tabs: Array<{ panels?: Record<string, unknown> }> = state?.tabs ?? []
    const hasPanels = tabs.some(t => Object.keys(t.panels ?? {}).length > 0)
    const hasPresets = Object.keys(state?.canvasPresets ?? {}).length > 0
    return hasPanels || hasPresets
  } catch { return false }
}

const dualStorage = {
  getItem: (name: string): string | null | Promise<string | null> => {
    // Fast path: localStorage is synchronous — use it if it has real data.
    // This keeps startup instant in the normal case.
    const lsData = localStorage.getItem(name)
    if (lsData && hasAnyContent(lsData)) return lsData

    // Slow path: localStorage is empty/wiped (Chromium quota reset) — recover from file.
    const eapiFile = window.electronAPI?.file
    if (!eapiFile?.read) return lsData
    return getAppDataHome().then(home => {
      if (!home) return lsData
      return eapiFile.read(`${home}/.config/deck/${name}.json`)
        .then(r => (r?.ok && r.content && hasAnyContent(r.content)) ? r.content : lsData)
        .catch(() => lsData)
    })
  },
  setItem: (name: string, value: string): void => {
    localStorage.setItem(name, value)
    // Only write to file when there's real content — prevents an empty-state write
    // from wiping a previously good backup (e.g. after a Chromium quota reset).
    if (!hasAnyContent(value)) return
    const eapiW = window.electronAPI
    getAppDataHome().then(home => {
      if (home && eapiW?.file?.write) {
        let prettyValue = value
        try {
          prettyValue = JSON.stringify(JSON.parse(value), null, 2)
        } catch {
          // Ignore parse errors, write raw value
        }
        eapiW.file.write(`${home}/.config/deck/${name}.json`, prettyValue).catch(() => null)
      }
    }).catch(() => null)
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name)
    const eapiD = window.electronAPI
    getAppDataHome().then(home => {
      if (home && eapiD?.fs?.delete) {
        eapiD.fs.delete(`${home}/.config/deck/${name}.json`).catch(() => null)
      }
    }).catch(() => null)
  }
}



export interface Panel {
  id: string
  type: 'terminal' | 'editor' | 'browser' | 'region'
  x: number
  y: number
  width: number
  height: number
  title: string
  content?: string
  children?: string[]
  regionId?: string
  detached?: boolean  // currently shown in a separate BrowserWindow
  // Docking / tab stacks. When `stackChildren` is set on a panel, that panel
  // is the host: it provides the bbox + tab strip and visually contains the
  // listed child panels. Each child gets `stackParentId` set so canvas hides
  // them from standalone rendering. `stackActive` is the id of the panel
  // whose body is currently visible — defaults to the host itself.
  stackParentId?: string
  stackChildren?: string[]
  stackActive?: string
  // Bbox the panel had before being stacked — restored on unstack/pop-out so
  // small panels don't end up host-sized after coming out of a stack.
  preStackBbox?: { x: number; y: number; width: number; height: number }
  projectId?: string
  worktreeId?: string
  zIndex?: number
  color?: string
  locked?: boolean
  minimized?: boolean
  pinFront?: boolean
  pinBack?: boolean
  starred?: boolean
  description?: string
  settings?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
  // Context — used by the sidebar to know which folder/repo/project this panel is in.
  // Inferred by panel-type-specific logic (editor uses folderPath, terminal uses cwd, etc.)
  // Sidebar reads context from the most-recently-active panel.
  projectPath?: string
  cwd?: string
  filePath?: string
  repoRoot?: string
  folderPath?: string
  notePath?: string
  healthState?: 'alive' | 'loading' | 'sleeping' | 'loaded' | 'dead' | 'crashed'
}

export type SidebarSection = 'explorer' | 'git' | 'outline'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export type AnnotationType = 'sticky' | 'label' | 'freehand' | 'arrow' | 'rectangle' | 'highlight' | 'relationship' | 'image'

export interface Point { x: number; y: number }

export interface Annotation {
  id: string
  type: AnnotationType
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  title?: string  // display name for search / finder — auto-generated if not set
  // Freehand — array of strokes, each stroke is a polyline of points.
  pathData?: Point[][]
  strokeWidth?: number
  // Arrow (drawing tool) — anchored or free.
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  startPanelId?: string
  endPanelId?: string
  startAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  endAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  startEdgePos?: number  // 0–1 position along the edge
  endEdgePos?: number
  dashed?: boolean
  arrowLabel?: string
  // Rectangle
  strokeColor?: string
  // Highlight
  fillOpacity?: number
  // Relationship (semantic link between two panels)
  sourcePanelId?: string
  targetPanelId?: string
  sourceAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  targetAnchor?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  sourceEdgePos?: number
  targetEdgePos?: number
  relationshipLabel?: string
  broken?: boolean
  curved?: boolean  // false = straight line, default = curved bezier
  fontSize?: number // text label font size in px
  // Image
  filename?: string
}

export interface WorkspaceTab {
  id: string
  title: string
  panels: Record<string, Panel>
  viewport: Viewport
  selectedPanelIds: string[]
  annotations?: Annotation[]
  createdAt: number
  color?: string
  lastSavedAt?: number
  lastEditedAt?: number
  // Marks this tab as belonging to a preset. Survives renames. Used so closing/deleting
  // panels in a preset can be tracked in `presetGraveyards` and re-restored next time
  // the user loads the preset.
  kind?: 'preset:life' | 'preset:no-life' | 'scratchpad'
  // Id of a user-saved CanvasPreset. Set when the tab was created via loadCanvasPreset
  // or when the user saves the current canvas via saveCanvasPreset. Used to overwrite
  // the preset on Ctrl+S / "Save" without prompting for a name again.
  linkedPresetId?: string
}

// Last-known state of preset panels the user has deleted. When the user re-runs
// loadPreset(name), any preset spec panel that's missing from the current tab is
// restored from this graveyard at its last position/size — or from preset defaults
// if it was never touched.
export type PresetGraveyards = Record<string, Record<string, Partial<Panel>>>

// User-saved canvas snapshot. Loaded into a new tab; browser panels start sleeping.
export interface CanvasPreset {
  id: string
  name: string
  savedAt: number
  panels: Record<string, Panel>
  annotations?: Annotation[]
  viewport: Viewport
}

export interface JumpMode {
  active: boolean
  letters: Record<string, string> // letter -> panel id
}

interface HistorySnapshot {
  panels: Record<string, Panel>
  selectedPanelIds: string[]
}

const HISTORY_LIMIT = 80

export interface WorkspaceState {
  panels: Record<string, Panel>
  selectedPanelIds: string[]
  viewport: Viewport
  tabs: WorkspaceTab[]
  activeTabId: string
  projectId: string | null
  commandPaletteOpen: boolean
  panelFinderOpen: boolean
  globalSearchOpen: boolean
  settingsOpen: boolean
  selectedAnnotationIds: string[]
  renameRequestId: string | null  // bumped when Canvas/App wants a panel to enter inline rename
  stackDropTargetId: string | null  // panel id whose header is currently a drop target during a stack-drag
  prefs: {
    fontSize: number  // px, base UI font
    density: 'compact' | 'cozy' | 'comfortable'
    animations: boolean
    snapStep: number  // px in world coords
    showCursorReadout: boolean
    editorFontSize: number
    editorWordWrap: 'on' | 'off'
    editorFontFamily: string
    terminalFontSize: number
    terminalFontFamily: string
    browserHomeUrl: string
    browserLazyLoad: boolean
    doubleClickToCreate: 'none' | 'terminal' | 'editor' | 'browser'
    defaultTerminalShell: string
    terminalScrollback: number
    panelHeaderDoubleClick: 'none' | 'minimize' | 'focus' | 'rename'
    defaultPanelWidthTerminal: number
    defaultPanelHeightTerminal: number
    defaultPanelWidthEditor: number
    defaultPanelHeightEditor: number
    defaultPanelWidthBrowser: number
    defaultPanelHeightBrowser: number
    canvasGridStyle: 'grid' | 'dot' | 'blueprint' | 'neon' | 'none'
    canvasGridSize: number
    canvasBgImage: string
    canvasBgColor: string
    customBgColors: Record<string, string>
    panelGlassOpacity: number
    panelGlassBlur: number
  }
  minimapVisible: boolean
  outlinerOpen: boolean
  helpOpen: boolean
  statusBarVisible: boolean
  chromeVisible: boolean

  past: HistorySnapshot[]
  future: HistorySnapshot[]
  jumpMode: JumpMode
  reducedMotion: boolean
  dragGuides: Array<{ axis: 'x' | 'y'; world: number }>
  headerActivePanelId: string | null
  bodyActivePanelId: string | null
  // Last panel the user touched (selection OR body click). Sticky — survives selection clear.
  // Sidebar follows this when nothing is selected, so context doesn't snap to nothing.
  lastFocusedPanelId: string | null
  sidebarOpen: boolean
  sidebarSection: SidebarSection
  presetGraveyards: PresetGraveyards
  canvasPresets: Record<string, CanvasPreset>
  viewportBookmarks: Record<number, Viewport>
  // Per-section pin: when set, that section ignores active-panel changes and stays on its pinned target.
  sidebarPin: { explorer?: string; git?: string }
  hiddenSidebarSections: SidebarSection[]
  // Annotate mode — lock panels and enable drawing tools.
  annotateMode: boolean
  annotateTool: AnnotationType | 'eraser' | 'select'
  annotationsVisible: boolean
  drawColor: string
  drawStrokeWidth: number
  annotateSourcePanelId: string | null
  annotationsBehindPanels: boolean
  // Annotation-only history (separate from panel undo/redo).
  annotationPast: Annotation[][]
  annotationFuture: Annotation[][]
  // Panel MRU quick-switcher.
  panelMruOrder: string[]       // panel IDs, most recent first (cap at 20)
  panelSwitcherOpen: boolean
  // Win+Tab Alt+Tab-style switcher.
  winTabOpen: boolean
  winTabCancelled: boolean
  winTabSelectedPanelId: string | null
  winTabSessionPanels: string[]  // MRU snapshot on open
  // Cursor world position — updated by Canvas on mouse move, used for panel spawning.
  cursorWorldPos: { x: number; y: number }
  keybindings: Record<string, string>

  setHeaderActivePanel: (id: string | null) => void
  setBodyActivePanel: (id: string | null) => void
  setLastFocusedPanel: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarSection: (s: SidebarSection) => void
  setSidebarPin: (section: 'explorer' | 'git', path: string | undefined) => void
  toggleSidebarSectionHidden: (s: SidebarSection) => void

  addPanel: (panel: Panel) => void
  updatePanel: (id: string, updates: Partial<Panel>, opts?: { skipHistory?: boolean }) => void
  deletePanel: (id: string) => void
  selectPanel: (id: string, additive?: boolean) => void
  selectMultiple: (ids: string[]) => void
  clearSelection: () => void
  setViewport: (viewport: Partial<WorkspaceState['viewport']>) => void
  setProject: (projectId: string | null) => void
  toggleCommandPalette: () => void
  togglePanelFinder: () => void
  toggleGlobalSearch: () => void
  toggleSettings: () => void
  updatePrefs: (partial: Partial<WorkspaceState['prefs']>) => void
  requestRename: (id: string | null) => void
  setPanelFinderOpen: (open: boolean) => void
  toggleMinimap: () => void
  toggleOutliner: () => void
  toggleHelp: () => void
  toggleStatusBar: () => void
  toggleChrome: () => void
  // Linked toggle for the top chrome + bottom status bar so Ctrl+\ hides/shows both together.
  toggleBars: () => void
  setBarsVisible: (visible: boolean) => void
  // Distraction-free focus: hide chrome + status bar + minimap in one shot.
  enterFocusMode: () => void

  createTab: (title?: string) => void
  loadPreset: (name: 'life' | 'no-life') => void
  switchTab: (id: string) => void
  renameTab: (id: string, title: string) => void
  closeTab: (id: string) => void
  reorderTab: (fromId: string, toId: string) => void
  initialize: () => void
  getPanelsByType: (type: Panel['type']) => Panel[]
  getPanelsInRegion: (regionId: string) => Panel[]
  movePanel: (id: string, x: number, y: number) => void
  resizePanel: (id: string, width: number, height: number) => void
  // Annotations — sticky notes + text labels layered on the active tab's canvas.
  addAnnotation: (a: Annotation) => void
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  deleteAnnotation: (id: string) => void
  selectAnnotation: (id: string) => void
  selectMultipleAnnotations: (ids: string[]) => void
  clearAnnotationSelection: () => void
  // Annotate mode controls.
  toggleAnnotateMode: () => void
  setAnnotateTool: (tool: WorkspaceState['annotateTool']) => void
  toggleAnnotationsVisible: () => void
  setDrawColor: (color: string) => void
  setDrawStrokeWidth: (width: number) => void
  setAnnotateSourcePanel: (id: string | null) => void
  toggleAnnotationsBehindPanels: () => void
  // Annotation-only undo/redo (annotate mode).
  pushAnnotationHistory: () => void
  undoAnnotation: () => void
  redoAnnotation: () => void
  // Panel MRU switcher.
  pushPanelMru: (id: string) => void
  togglePanelSwitcher: () => void
  setPanelSwitcherOpen: (open: boolean) => void
  // Win+Tab switcher.
  openWinTabSwitcher: () => void
  closeWinTabSwitcher: (commit: boolean) => void
  cycleWinTabSelection: (direction: 1 | -1) => void
  selectWinTabPanel: (idx: number) => void
  setCursorWorldPos: (x: number, y: number) => void
  groupIntoRegion: (panelIds: string[], regionName: string) => string
  ungroupRegion: (regionId: string) => void
  updateRegionMembership: (panelIds: string[]) => void
  clampChildrenToRegion: (regionId: string) => void
  // Docking — tab stacks.
  stackPanels: (hostId: string, panelIds: string[]) => void
  unstackPanel: (panelId: string) => void
  setStackActive: (hostId: string, activeId: string) => void
  setStackDropTarget: (id: string | null) => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  setJumpMode: (active: boolean, letters?: Record<string, string>) => void
  setDragGuides: (guides: Array<{ axis: 'x' | 'y'; world: number }>) => void
  movePanelToTab: (panelId: string, toTabId: string) => void
  exportWorkspace: () => string
  importWorkspace: (json: string) => boolean
  markTabSaved: () => void
  saveBuiltinPreset: (kind: 'preset:life' | 'preset:no-life') => void
  saveCanvasPreset: (name: string) => string
  overwriteCanvasPreset: (id: string) => void
  loadCanvasPreset: (id: string) => void
  deleteCanvasPreset: (id: string) => void
  renameCanvasPreset: (id: string, name: string) => void
  saveViewportBookmark: (num: number) => void
  loadViewportBookmark: (num: number) => void
  findOrCreateScratchpad: () => void
  loadKeybindingsFromFile: () => Promise<void>
  updateKeybinding: (command: string, keyCombo: string) => Promise<void>
  resetKeybindings: () => Promise<void>
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'toggle-help': '?',
  'rename-selected': 'f2',
  'focus-selected': 'f',
  'toggle-minimap': 'm',
  'toggle-annotate-mode': 'a',
  'toggle-command-palette': 'ctrl+p',
  'toggle-settings': 'ctrl+,',
  'toggle-panel-finder': 'ctrl+f',
  'toggle-sidebar': 'ctrl+shift+b',
  'new-browser': 'ctrl+b',
  'undo': 'ctrl+z',
  'redo': 'ctrl+y',
  'toggle-bars': 'ctrl+\\',
  'load-preset-life': 'ctrl+shift+l',
  'load-preset-nolife': 'ctrl+shift+k',
  'arrange-selected': 'ctrl+shift+a',
  'find-scratchpad': 'ctrl+shift+space',
  'open-wintab-switcher': 'meta+tab',
  'toggle-panel-switcher': 'ctrl+tab',
  'new-terminal': 'ctrl+shift+t',
  'new-editor': 'ctrl+alt+n',
  'new-region': 'ctrl+alt+r',
  'zoom-in': 'ctrl+=',
  'zoom-out': 'ctrl+-',
  'reset-viewport': 'ctrl+0',
  'fit-all': 'ctrl+1',
  'toggle-lock': 'ctrl+l',
  'toggle-minimize': 'ctrl+alt+m',
  'toggle-pin-front': 'alt+p',
  'bring-front': ']',
  'send-back': '[',
}

const createEmptyTab = (title = 'Canvas'): WorkspaceTab => ({
  id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  title,
  panels: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedPanelIds: [],
  createdAt: Date.now()
})

const initialTab = createEmptyTab('Canvas 1')

const syncActiveTab = (state: WorkspaceState, updates: Partial<Pick<WorkspaceTab, 'panels' | 'viewport' | 'selectedPanelIds'>>, opts?: { skipDirty?: boolean }) => ({
  tabs: state.tabs.map(tab => {
    if (tab.id !== state.activeTabId) return tab
    const next: WorkspaceTab = { ...tab, ...updates }
    if ('panels' in updates && !opts?.skipDirty) next.lastEditedAt = Date.now()
    return next
  })
})

const fitViewportToPanels = (panels: Record<string, Panel>): Viewport => {
  const items = Object.values(panels).filter(p => p.type !== 'region')
  if (items.length === 0) return { x: 0, y: 0, zoom: 1 }
  const minX = Math.min(...items.map(p => p.x))
  const minY = Math.min(...items.map(p => p.y))
  const maxX = Math.max(...items.map(p => p.x + p.width))
  const maxY = Math.max(...items.map(p => p.y + p.height))
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  const pad = 96
  const zoom = Math.max(0.02, Math.min(2, Math.min(
    (window.innerWidth - pad * 2) / Math.max(bounds.width, 1),
    (window.innerHeight - pad * 2) / Math.max(bounds.height, 1)
  )))
  return {
    zoom,
    x: window.innerWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: window.innerHeight / 2 - (bounds.y + bounds.height / 2) * zoom
  }
}

const snapshot = (state: WorkspaceState): HistorySnapshot => ({
  panels: state.panels,
  selectedPanelIds: state.selectedPanelIds
})

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      panels: initialTab.panels,
      selectedPanelIds: [],
      viewport: initialTab.viewport,
      tabs: [initialTab],
      activeTabId: initialTab.id,
      projectId: null,
      keybindings: DEFAULT_KEYBINDINGS,
      commandPaletteOpen: false,
      panelFinderOpen: false,
      globalSearchOpen: false,
      settingsOpen: false,
      selectedAnnotationIds: [],
      renameRequestId: null,
      stackDropTargetId: null,
      prefs: {
        fontSize: 13,
        density: 'cozy',
        animations: true,
        snapStep: 20,
        showCursorReadout: true,
        editorFontSize: 14,
        editorWordWrap: 'off',
        editorFontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
        terminalFontSize: 15,
        terminalFontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, monospace",
        browserHomeUrl: 'https://google.com',
        browserLazyLoad: false,
        doubleClickToCreate: 'none',
        defaultTerminalShell: '',
        terminalScrollback: 10000,
        panelHeaderDoubleClick: 'rename',
        defaultPanelWidthTerminal: 600,
        defaultPanelHeightTerminal: 400,
        defaultPanelWidthEditor: 1100,
        defaultPanelHeightEditor: 760,
        defaultPanelWidthBrowser: 720,
        defaultPanelHeightBrowser: 560,
        canvasGridStyle: 'none',
        canvasGridSize: 20,
        canvasBgImage: '',
        canvasBgColor: '',
        customBgColors: {},
        panelGlassOpacity: 0.85,
        panelGlassBlur: 12
      },
      minimapVisible: true,
      outlinerOpen: false,
      helpOpen: false,
      statusBarVisible: true,
      chromeVisible: true,

      past: [],
      future: [],
      jumpMode: { active: false, letters: {} },
      reducedMotion: false,
      dragGuides: [],
      headerActivePanelId: null,
      bodyActivePanelId: null,
      lastFocusedPanelId: null,
      sidebarOpen: false,
      sidebarSection: 'explorer',
      sidebarPin: {},
      hiddenSidebarSections: [],
      presetGraveyards: {},
      canvasPresets: {},
      viewportBookmarks: {},
      annotateMode: false,
      annotateTool: 'freehand',
      annotationsVisible: true,
      drawColor: '#ffffff',
      drawStrokeWidth: 2,
      annotateSourcePanelId: null,
      annotationsBehindPanels: false,
      annotationPast: [],
      annotationFuture: [],
      panelMruOrder: [],
      panelSwitcherOpen: false,
      winTabOpen: false,
      winTabCancelled: false,
      winTabSelectedPanelId: null,
      winTabSessionPanels: [],
      cursorWorldPos: { x: 100, y: 100 },

      setHeaderActivePanel: (id) => set({ headerActivePanelId: id }),
      setBodyActivePanel: (id) => set(state => {
        // Skip region: don't let region body activation hijack sidebar context.
        const target = id ? state.panels[id] : null
        const nextLastFocused = target?.type === 'region' ? state.lastFocusedPanelId : (id || state.lastFocusedPanelId)
        return { bodyActivePanelId: id, lastFocusedPanelId: nextLastFocused }
      }),
      setLastFocusedPanel: (id) => set({ lastFocusedPanelId: id }),
      toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarSection: (s) => set({ sidebarSection: s, sidebarOpen: true }),
      setSidebarPin: (section, path) => set(state => ({ sidebarPin: { ...state.sidebarPin, [section]: path } })),
      toggleSidebarSectionHidden: (s) => set(state => {
        if (s === 'outline') return {}
        const hidden = state.hiddenSidebarSections.includes(s)
          ? state.hiddenSidebarSections.filter(x => x !== s)
          : [...state.hiddenSidebarSections, s]
        const ALL: SidebarSection[] = ['explorer', 'git', 'outline']
        const visible = ALL.filter(x => !hidden.includes(x))
        const nextSection = hidden.includes(state.sidebarSection)
          ? (visible[0] || state.sidebarSection)
          : state.sidebarSection
        return { hiddenSidebarSections: hidden, sidebarSection: nextSection }
      }),

      pushHistory: () => set((state) => ({
        past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
        future: []
      })),

      undo: () => set((state) => {
        if (state.past.length === 0) return state
        const prev = state.past[state.past.length - 1]
        const past = state.past.slice(0, -1)
        const future = [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT)
        return {
          past,
          future,
          panels: prev.panels,
          selectedPanelIds: prev.selectedPanelIds,
          ...syncActiveTab(state, { panels: prev.panels, selectedPanelIds: prev.selectedPanelIds })
        }
      }),

      redo: () => set((state) => {
        if (state.future.length === 0) return state
        const next = state.future[0]
        const future = state.future.slice(1)
        const past = [...state.past, snapshot(state)].slice(-HISTORY_LIMIT)
        return {
          past,
          future,
          panels: next.panels,
          selectedPanelIds: next.selectedPanelIds,
          ...syncActiveTab(state, { panels: next.panels, selectedPanelIds: next.selectedPanelIds })
        }
      }),

      addPanel: (panel) =>
        set((state) => {
          const now = Date.now()
          const enriched: Panel = { createdAt: now, updatedAt: now, ...panel }
          const panels = { ...state.panels, [panel.id]: enriched }
          return {
            past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
            future: [],
            panels,
            ...syncActiveTab(state, { panels })
          }
        }),

      updatePanel: (id, updates, opts) =>
        set((state) => {
          if (!state.panels[id]) return state
          const panels = {
            ...state.panels,
            [id]: { ...state.panels[id], ...updates, updatedAt: Date.now() }
          }
          const base = opts?.skipHistory ? {} : {
            past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
            future: []
          }
          return { ...base, panels, ...syncActiveTab(state, { panels }, { skipDirty: opts?.skipHistory }) }
        }),

      deletePanel: (id) =>
        set((state) => {
          const target = state.panels[id]
          // Real cleanup for terminals: kill the pty so we don't leak shell
          // processes. We don't do this on every unmount (panels routinely
          // re-mount during tab switches and pop-out/re-dock) — only here.
          if (target?.type === 'terminal') {
            try { window.electronAPI?.pty?.kill(id) } catch { /* ignore */ }
          }
          const newPanels = { ...state.panels }
          delete newPanels[id]
          // If deleted panel was a region, clear regionId on its (now-orphan) children.
          if (target?.type === 'region' && target.children) {
            target.children.forEach(cid => {
              const c = newPanels[cid]
              if (c) newPanels[cid] = { ...c, regionId: undefined }
            })
          }
          // Detach from any parent region's children list.
          Object.values(newPanels).forEach(panel => {
            if (panel.children?.includes(id)) {
              newPanels[panel.id] = {
                ...panel,
                children: panel.children.filter(childId => childId !== id)
              }
            }
          })
          const selectedPanelIds = state.selectedPanelIds.filter(pid => pid !== id)
          const headerActivePanelId = state.headerActivePanelId === id ? null : state.headerActivePanelId
          const bodyActivePanelId = state.bodyActivePanelId === id ? null : state.bodyActivePanelId
          const lastFocusedPanelId = state.lastFocusedPanelId === id ? null : state.lastFocusedPanelId

          // If the deleted panel belonged to a preset tab AND has a deterministic preset
          // id, snapshot its current size/position to the graveyard so re-loading the
          // preset can resurrect it exactly where it was.
          let presetGraveyards = state.presetGraveyards
          const activeTab = state.tabs.find(t => t.id === state.activeTabId)
          if (target && activeTab?.kind?.startsWith('preset:') && id.startsWith('preset-')) {
            const presetName = activeTab.kind.slice('preset:'.length)
            const grave = { ...(presetGraveyards[presetName] || {}) }
            grave[id] = {
              x: target.x, y: target.y, width: target.width, height: target.height,
              title: target.title, color: target.color, settings: target.settings,
              description: target.description
            }
            presetGraveyards = { ...presetGraveyards, [presetName]: grave }
          }

          return {
            past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
            future: [],
            panels: newPanels,
            selectedPanelIds,
            headerActivePanelId,
            bodyActivePanelId,
            lastFocusedPanelId,
            presetGraveyards,
            ...syncActiveTab(state, { panels: newPanels, selectedPanelIds })
          }
        }),

      selectPanel: (id, additive = false) =>
        set((state) => {
          let selectedPanelIds: string[]
          if (additive) {
            selectedPanelIds = state.selectedPanelIds.includes(id)
              ? state.selectedPanelIds.filter(pid => pid !== id)
              : [...state.selectedPanelIds, id]
          } else {
            selectedPanelIds = [id]
          }
          // Switching selection away from a header-active panel clears that flag.
          const headerActivePanelId = state.headerActivePanelId && state.headerActivePanelId !== id ? null : state.headerActivePanelId
          const bodyActivePanelId = state.bodyActivePanelId && state.bodyActivePanelId !== id ? null : state.bodyActivePanelId
          // Don't reassign lastFocusedPanelId to a region — sidebar context (explorer/git)
          // should keep following the previously focused real panel.
          const target = state.panels[id]
          const nextLastFocused = target?.type === 'region' ? state.lastFocusedPanelId : id
          // Push to MRU.
          const curMru = state.panelMruOrder.filter(x => x !== id)
          const panelMruOrder = [id, ...curMru].slice(0, 20)
          return { selectedPanelIds, headerActivePanelId, bodyActivePanelId, lastFocusedPanelId: nextLastFocused, selectedAnnotationIds: additive ? state.selectedAnnotationIds : [], panelMruOrder, ...syncActiveTab(state, { selectedPanelIds }) }
        }),

      selectMultiple: (ids) => set((state) => ({ selectedPanelIds: ids, headerActivePanelId: null, bodyActivePanelId: null, ...syncActiveTab(state, { selectedPanelIds: ids }) })),

      clearSelection: () => set((state) => ({ selectedPanelIds: [], headerActivePanelId: null, bodyActivePanelId: null, ...syncActiveTab(state, { selectedPanelIds: [] }) })),

      setViewport: (viewport) =>
        set((state) => {
          const nextViewport = { ...state.viewport, ...viewport }
          return { viewport: nextViewport, ...syncActiveTab(state, { viewport: nextViewport }) }
        }),

      setProject: (projectId) => set({ projectId }),

      toggleCommandPalette: () => set((state) => {
        const next = !state.commandPaletteOpen
        if (next) window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return { commandPaletteOpen: next }
      }),
      togglePanelFinder: () => set((state) => {
        const next = !state.panelFinderOpen
        if (next) window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return { panelFinderOpen: next }
      }),
      toggleGlobalSearch: () => set((state) => {
        const next = !state.globalSearchOpen
        if (next) window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return { globalSearchOpen: next }
      }),
      toggleSettings: () => set((state) => {
        const next = !state.settingsOpen
        if (next) window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return { settingsOpen: next }
      }),
      updatePrefs: (partial) => set((state) => ({ prefs: { ...state.prefs, ...partial } })),
      requestRename: (id) => set({ renameRequestId: id }),
      setPanelFinderOpen: (open) => set({ panelFinderOpen: open }),
      toggleMinimap: () => set((state) => ({ minimapVisible: !state.minimapVisible })),
      toggleOutliner: () => set((state) => ({ outlinerOpen: !state.outlinerOpen })),
      toggleHelp: () => set((state) => ({ helpOpen: !state.helpOpen })),
      toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
      toggleChrome: () => set((state) => ({ chromeVisible: !state.chromeVisible })),
      toggleBars: () => set((state) => {
        // If either is showing, hide both. If both hidden, show both. Keeps them in lockstep.
        const next = !(state.chromeVisible || state.statusBarVisible)
        return { chromeVisible: next, statusBarVisible: next }
      }),
      setBarsVisible: (visible) => set({ chromeVisible: visible, statusBarVisible: visible }),
      enterFocusMode: () => set({ chromeVisible: false, statusBarVisible: false, minimapVisible: false }),


      createTab: (title) =>
        set((state) => {
          // Pick the lowest unused number so closing Canvas 1 then creating new doesn't
          // produce "Canvas 3" when Canvas 3 already exists. Walk 1..N+1 for first gap.
          let auto = title
          if (!auto) {
            const used = new Set<number>()
            state.tabs.forEach(t => {
              const m = t.title.match(/^Canvas (\d+)$/)
              if (m) used.add(parseInt(m[1], 10))
            })
            let n = 1
            while (used.has(n)) n++
            auto = `Canvas ${n}`
          }
          const tab = createEmptyTab(auto)
          return {
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            panels: tab.panels,
            selectedPanelIds: tab.selectedPanelIds,
            viewport: tab.viewport,
            past: [],
            future: [],
            jumpMode: state.jumpMode.active ? { active: false, letters: {} } : state.jumpMode
          }
        }),

      // Reuse-or-create-or-resurrect a preset tab.
      //   - Existing preset tab (matched by kind): switch to it AND restore any missing
      //     preset panels from the graveyard (or defaults if never customised).
      //   - No existing tab: build from preset spec, applying graveyard overrides so the
      //     user's last-known positions/sizes/settings are preserved across full close
      //     + reopen.
      loadPreset: (name) => {
        import('../presets').then(({ buildPresetPanels, presetTabMeta }) => {
          const meta = presetTabMeta(name)
          const cur = get()
          const kind = `preset:${name}` as 'preset:life' | 'preset:no-life'
          const existing = cur.tabs.find(t => t.kind === kind) || cur.tabs.find(t => t.title === meta.title)
          const graveyard = cur.presetGraveyards[name] || {}

          // Build the canonical preset panel set with graveyard overrides applied.
          const specPanels = buildPresetPanels(name, graveyard)

          if (existing) {
            // If this is an old preset tab created before deterministic ids were
            // introduced, migrate its panels by matching titles → spec ids. Keeps the
            // user's customised positions/sizes/settings but rekeys so future merges
            // work and graveyard tracking kicks in.
            let workingPanels = existing.panels
            if (!existing.kind) {
              const byTitle = new Map<string, Panel>()
              Object.values(existing.panels).forEach(p => byTitle.set(p.title.toLowerCase(), p))
              const migrated: Record<string, Panel> = {}
              specPanels.forEach(sp => {
                const matched = byTitle.get(sp.title.toLowerCase())
                if (matched) {
                  // Preserve user x/y/w/h and settings; adopt deterministic id.
                  migrated[sp.id] = { ...matched, id: sp.id }
                  byTitle.delete(sp.title.toLowerCase())
                } else {
                  migrated[sp.id] = sp
                }
              })
              // Any leftover panels (user-added customs) keep their original ids.
              byTitle.forEach(p => { migrated[p.id] = p })
              workingPanels = migrated
            }

            // Resurrect any spec panel still missing — but NOT if the user explicitly
            // saved without it (graveyard has preset entries but not this panel = deleted).
            const graveyardHasExplicitSave = Object.keys(graveyard).some(k => k.startsWith(`preset-${name}-`))
            const updatedPanels = { ...workingPanels }
            specPanels.forEach(sp => {
              if (graveyardHasExplicitSave && !graveyard[sp.id]) return  // deleted, skip
              if (!updatedPanels[sp.id]) updatedPanels[sp.id] = sp
              else {
                // Preserve lazyLoad:false — panel was already loaded by the user. Only
                // reset to sleep if the panel hasn't been woken yet. This lets closing
                // and reopening the app keep loaded panels in their loaded state.
                const wasLoaded = (updatedPanels[sp.id].settings as Record<string, unknown> | undefined)?.lazyLoad === false
                updatedPanels[sp.id] = {
                  ...updatedPanels[sp.id],
                  settings: {
                    ...(updatedPanels[sp.id].settings || {}),
                    ...(sp.type === 'browser' ? {
                      browserTabs: sp.settings?.browserTabs,
                      browserActiveTabId: sp.settings?.browserActiveTabId
                    } : {}),
                    lazyLoad: wasLoaded ? false : (sp.settings?.lazyLoad === true)
                  }
                }
              }
            })
            // Sync graveyard to the actual panel state after merge. Clearing was the
            // original intent but it wipes saveBuiltinPreset data on every button click.
            // Writing current positions instead keeps saved layouts alive.
            const newGraveyard = { ...graveyard }
            Object.values(updatedPanels).forEach(p => {
              if (p.id.startsWith('preset-')) {
                newGraveyard[p.id] = {
                  x: p.x, y: p.y, width: p.width, height: p.height,
                  title: p.title, color: p.color, settings: p.settings, description: p.description
                }
              }
            })

            const fitted = fitViewportToPanels(updatedPanels)
            const updatedTabs = cur.tabs.map(t =>
              t.id === existing.id ? { ...t, panels: updatedPanels, kind, lastEditedAt: 0, lastSavedAt: Date.now() } : t
            )
            const isActive = cur.activeTabId === existing.id
            set({
              tabs: updatedTabs,
              activeTabId: existing.id,
              panels: updatedPanels,
              selectedPanelIds: isActive ? cur.selectedPanelIds : [],
              viewport: fitted,
              past: [],
              future: [],
              presetGraveyards: { ...cur.presetGraveyards, [name]: newGraveyard }
            })
            return
          }

          // Fresh tab — build from spec + graveyard overrides.
          // If the user has ever explicitly saved this preset (graveyard has preset-* entries),
          // only include spec panels that are still in the graveyard. Panels the user deleted
          // then saved will be absent from the graveyard and must stay gone.
          const graveyardHasExplicitSave = Object.keys(graveyard).some(k => k.startsWith(`preset-${name}-`))
          const panelMap: Record<string, Panel> = {}
          specPanels.forEach(p => {
            if (graveyardHasExplicitSave && !graveyard[p.id]) return  // deleted, skip
            panelMap[p.id] = p
          })
          // Restore custom (user-added) panels from graveyard — notes, browsers, etc.
          Object.entries(graveyard).forEach(([id, data]) => {
            if (!id.startsWith('preset-') && !panelMap[id]) {
              panelMap[id] = data as Panel
            }
          })
          const fitted = fitViewportToPanels(panelMap)
          const tab: WorkspaceTab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: meta.title,
            color: meta.color,
            panels: panelMap,
            viewport: fitted,
            selectedPanelIds: [],
            createdAt: Date.now(),
            kind,
            lastSavedAt: Date.now(),
            lastEditedAt: 0
          }
          set(state => ({
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            panels: tab.panels,
            selectedPanelIds: [],
            viewport: tab.viewport,
            past: [],
            future: []
          }))
        })
      },

      switchTab: (id) =>
        set((state) => {
          const tab = state.tabs.find(item => item.id === id)
          if (!tab) return state
          // Clear focus pointers that refer to panels in the previous tab to avoid
          // stale sidebar context / blue rings after switching.
          const stillExists = (pid: string | null) => !!(pid && tab.panels[pid])
          return {
            activeTabId: tab.id,
            panels: tab.panels,
            selectedPanelIds: tab.selectedPanelIds,
            viewport: tab.viewport,
            past: [],
            future: [],
            headerActivePanelId: stillExists(state.headerActivePanelId) ? state.headerActivePanelId : null,
            bodyActivePanelId: stillExists(state.bodyActivePanelId) ? state.bodyActivePanelId : null,
            lastFocusedPanelId: stillExists(state.lastFocusedPanelId) ? state.lastFocusedPanelId : null,
            jumpMode: state.jumpMode.active ? { active: false, letters: {} } : state.jumpMode
          }
        }),

      renameTab: (id, title) =>
        set((state) => ({
          tabs: state.tabs.map(tab => {
            if (tab.id !== id) return tab
            const nextTitle = title.trim() || tab.title
            if (nextTitle === tab.title) return tab
            return { ...tab, title: nextTitle, lastEditedAt: Date.now() }
          })
        })),

      reorderTab: (fromId, toId) =>
        set((state) => {
          if (fromId === toId) return state
          const fromIdx = state.tabs.findIndex(t => t.id === fromId)
          const toIdx = state.tabs.findIndex(t => t.id === toId)
          if (fromIdx < 0 || toIdx < 0) return state
          const tabs = [...state.tabs]
          const [moved] = tabs.splice(fromIdx, 1)
          tabs.splice(toIdx, 0, moved)
          return { tabs }
        }),

      closeTab: (id) =>
        set((state) => {
          if (state.tabs.length <= 1) return state
          const tabs = state.tabs.filter(tab => tab.id !== id)
          const activeTab = id === state.activeTabId ? tabs[0] : tabs.find(tab => tab.id === state.activeTabId) || tabs[0]

          // Closing a preset tab: snapshot ALL of its panels to the graveyard so
          // re-loading the preset can resurrect them at their last-known state.
          const presetGraveyards = state.presetGraveyards
          // Intentionally NOT writing graveyard on tab close — graveyard only updates
          // on explicit Ctrl+S (saveBuiltinPreset) or panel delete. Closing without
          // saving should revert to last explicitly saved state.

          // Clear any focus refs pointing at panels we just dropped.
          const stillExists = (pid: string | null) => !!(pid && activeTab.panels[pid])
          return {
            tabs,
            activeTabId: activeTab.id,
            panels: activeTab.panels,
            selectedPanelIds: activeTab.selectedPanelIds,
            viewport: activeTab.viewport,
            jumpMode: state.jumpMode.active ? { active: false, letters: {} } : state.jumpMode,
            headerActivePanelId: stillExists(state.headerActivePanelId) ? state.headerActivePanelId : null,
            bodyActivePanelId: stillExists(state.bodyActivePanelId) ? state.bodyActivePanelId : null,
            lastFocusedPanelId: stillExists(state.lastFocusedPanelId) ? state.lastFocusedPanelId : null,
            presetGraveyards
          }
        }),

      initialize: () => {
        // Cross-window state sync: when another window (pop-out or main) writes
        // to localStorage, pick up the panel/tab updates so we don't render
        // stale state. We deliberately skip local UI fields (selection,
        // viewport, jumpMode, etc.) so each window keeps its own UI state.
        const onStorage = (e: StorageEvent) => {
          if (e.key !== 'worktree-studio-workspace' || !e.newValue) return
          try {
            const parsed = JSON.parse(e.newValue)
            const data = parsed?.state || parsed
            if (!data) return
            useWorkspaceStore.setState((state) => ({
              panels: data.panels ?? state.panels,
              tabs: data.tabs ?? state.tabs,
              activeTabId: data.activeTabId ?? state.activeTabId
            }))
          } catch { /* ignore parse error */ }
        }
        // Avoid double-bind if initialize() is called twice.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any
        if (!w.__wts_storage_bound) {
          window.addEventListener('storage', onStorage)
          w.__wts_storage_bound = true
        }

        // On every launch: put all browser panels back to sleep. Webviews are
        // expensive and the user deliberately chooses when to wake each one.
        // Only call set() if something actually needed sleeping — avoids a
        // spurious state overwrite that could interfere with persistence.
        if (!w.__wts_sleep_reset) {
          w.__wts_sleep_reset = true
          const cur = get()
          const putToSleep = (panels: Record<string, Panel>) => {
            let changed = false
            const next = { ...panels }
            Object.values(next).forEach(p => {
              if (p.type === 'browser' && (p.settings as Record<string, unknown> | undefined)?.lazyLoad === false) {
                next[p.id] = { ...p, settings: { ...(p.settings || {}), lazyLoad: true } }
                changed = true
              }
            })
            return changed ? next : panels
          }
          let anySleepChanged = false
          const tabs = cur.tabs.map(tab => {
            const panels = putToSleep(tab.panels)
            if (panels !== tab.panels) { anySleepChanged = true; return { ...tab, panels } }
            return tab
          })
          if (anySleepChanged) {
            const activeTab = tabs.find(t => t.id === cur.activeTabId)
            set({ tabs, panels: activeTab ? activeTab.panels : cur.panels })
          }
        }

        // Expose dirty-check for main process close handler.
        w.__deck_isDirty = () => {
          const s = get()
          return s.tabs.some(t =>
            Object.keys(t.panels).length > 0 &&
            t.lastEditedAt && t.lastEditedAt > (t.lastSavedAt || 0)
          )
        }

        get().loadKeybindingsFromFile().catch(() => null)
      },

      getPanelsByType: (type) => Object.values(get().panels).filter(p => p.type === type),
      getPanelsInRegion: (regionId) => Object.values(get().panels).filter(p => p.regionId === regionId),

      movePanel: (id, x, y) =>
        set((state) => {
          if (!state.panels[id] || state.panels[id].locked) return state
          const panel = state.panels[id]
          const dx = x - panel.x
          const dy = y - panel.y
          const panels = { ...state.panels, [id]: { ...panel, x, y } }
          if (panel.type === 'region' && panel.children) {
            panel.children.forEach(childId => {
              const child = panels[childId]
              if (child && !child.locked) {
                panels[childId] = { ...child, x: child.x + dx, y: child.y + dy }
              }
            })
          }
          return { panels, ...syncActiveTab(state, { panels }) }
        }),

      resizePanel: (id, width, height) =>
        set((state) => {
          if (!state.panels[id] || state.panels[id].locked) return state
          const panels = {
            ...state.panels,
            [id]: { ...state.panels[id], width, height }
          }
          return { panels, ...syncActiveTab(state, { panels }) }
        }),

      // Helper: when in annotate mode, capture current annotations for undo history.
      // Called before any mutation that changes the visible annotation set.
      //
      // SHALLOW-CLONE INVARIANT: Annotation objects have one array field (pathData).
      // This spread is safe as long as pathData is always *replaced* (annotation.pathData = [...])
      // never mutated in-place (annotation.pathData.push(...)). All write sites in
      // DrawingCanvas.tsx currently comply. If that ever changes, upgrade to a deep clone here.
      addAnnotation: (a) => set((state) => {
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const base = state.annotateMode
          ? { annotationPast: [...state.annotationPast.slice(-59), (tab?.annotations || []).map(x => ({ ...x }))], annotationFuture: [] as Annotation[][] }
          : {}
        return {
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, annotations: [...(t.annotations || []), a], lastEditedAt: Date.now() }
              : t
          ),
          ...base
        }
      }),
      updateAnnotation: (id, updates) => set((state) => {
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const base = state.annotateMode
          ? { annotationPast: [...state.annotationPast.slice(-59), (tab?.annotations || []).map(x => ({ ...x }))], annotationFuture: [] as Annotation[][] }
          : {}
        return {
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, annotations: (t.annotations || []).map(a => a.id === id ? { ...a, ...updates } : a), lastEditedAt: Date.now() }
              : t
          ),
          ...base
        }
      }),
      deleteAnnotation: (id) => set((state) => {
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const base = state.annotateMode
          ? { annotationPast: [...state.annotationPast.slice(-59), (tab?.annotations || []).map(x => ({ ...x }))], annotationFuture: [] as Annotation[][] }
          : {}
        return {
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, annotations: (t.annotations || []).filter(a => a.id !== id), lastEditedAt: Date.now() }
              : t
          ),
          selectedAnnotationIds: state.selectedAnnotationIds.filter(aid => aid !== id),
          ...base
        }
      }),

      selectAnnotation: (id) => set({ selectedAnnotationIds: [id] }),
      selectMultipleAnnotations: (ids) => set({ selectedAnnotationIds: ids }),
      clearAnnotationSelection: () => set({ selectedAnnotationIds: [] }),

      toggleAnnotateMode: () => set(state => {
        const entering = !state.annotateMode
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        return {
          annotateMode: entering,
          annotateTool: entering ? 'select' : state.annotateTool,
          // Capture baseline on enter, clear history on exit.
          annotationPast: entering ? [(tab?.annotations || []).map(x => ({ ...x }))] : [],
          annotationFuture: [],
        }
      }),
      setAnnotateTool: (tool) => set({ annotateTool: tool }),
      toggleAnnotationsVisible: () => set(state => ({ annotationsVisible: !state.annotationsVisible })),
      setDrawColor: (color) => set({ drawColor: color }),
      setDrawStrokeWidth: (width) => set({ drawStrokeWidth: width }),
      setAnnotateSourcePanel: (id) => set({ annotateSourcePanelId: id }),
      toggleAnnotationsBehindPanels: () => set(s => ({ annotationsBehindPanels: !s.annotationsBehindPanels })),

      // Annotation-only undo/redo — snapshots the active tab's annotations array.
      pushAnnotationHistory: () => set(state => {
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const annos = (tab?.annotations || []).map(x => ({ ...x }))
        return {
          annotationPast: [...state.annotationPast.slice(-59), annos],
          annotationFuture: []
        }
      }),
      undoAnnotation: () => set(state => {
        if (state.annotationPast.length === 0) return state
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const current = (tab?.annotations || []).map(x => ({ ...x }))
        const prev = state.annotationPast[state.annotationPast.length - 1]
        return {
          annotationPast: state.annotationPast.slice(0, -1),
          annotationFuture: [current, ...state.annotationFuture].slice(0, 60),
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, annotations: prev, lastEditedAt: Date.now() }
              : t
          )
        }
      }),
      redoAnnotation: () => set(state => {
        if (state.annotationFuture.length === 0) return state
        const tab = state.tabs.find(t => t.id === state.activeTabId)
        const current = (tab?.annotations || []).map(x => ({ ...x }))
        const next = state.annotationFuture[0]
        return {
          annotationFuture: state.annotationFuture.slice(1),
          annotationPast: [...state.annotationPast, current].slice(-60),
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, annotations: next, lastEditedAt: Date.now() }
              : t
          )
        }
      }),

      // Panel MRU tracking — push to front, dedup, cap at 20.
      pushPanelMru: (id) => set(state => {
        const cur = state.panelMruOrder.filter(x => x !== id)
        return { panelMruOrder: [id, ...cur].slice(0, 20) }
      }),
      togglePanelSwitcher: () => set(state => {
        // Populate MRU from current tab panels if empty.
        if (state.panelMruOrder.length === 0) {
          const ids = Object.values(state.panels).filter(p => p.type !== 'region').map(p => p.id)
          return { panelSwitcherOpen: !state.panelSwitcherOpen, panelMruOrder: ids.slice(0, 20) }
        }
        return { panelSwitcherOpen: !state.panelSwitcherOpen }
      }),
      setPanelSwitcherOpen: (open) => set(state => {
        if (open && state.panelMruOrder.length === 0) {
          const ids = Object.values(state.panels).filter(p => p.type !== 'region').map(p => p.id)
          return { panelSwitcherOpen: true, panelMruOrder: ids.slice(0, 20) }
        }
        return { panelSwitcherOpen: open }
      }),
      // Win+Tab switcher — snapshot MRU on open, pre-select next panel.
      openWinTabSwitcher: () => set(state => {
        const mru = state.panelMruOrder.filter(id => state.panels[id] && state.panels[id].type !== 'region')
        const otherIds = Object.keys(state.panels).filter(id => state.panels[id].type !== 'region' && !mru.includes(id))
        const allPanels = [...mru, ...otherIds].slice(0, 20)
        // Pre-select the NEXT panel (allPanels[1]), not current. Fallback to allPanels[0] if only 1.
        const selected = allPanels.length > 1 ? allPanels[1] : allPanels[0] || null
        return {
          winTabOpen: true,
          winTabCancelled: false,
          winTabSelectedPanelId: selected,
          winTabSessionPanels: allPanels,
        }
      }),
      closeWinTabSwitcher: (commit) => set(() => {
        if (!commit) return { winTabOpen: false, winTabCancelled: true, winTabSelectedPanelId: null }
        return { winTabOpen: false, winTabCancelled: false, winTabSelectedPanelId: null }
      }),
      cycleWinTabSelection: (direction) => set(state => {
        const idx = state.winTabSessionPanels.indexOf(state.winTabSelectedPanelId || '')
        const next = (idx + direction + state.winTabSessionPanels.length) % state.winTabSessionPanels.length
        return { winTabSelectedPanelId: state.winTabSessionPanels[next] }
      }),
      selectWinTabPanel: (idx) => set(state => {
        if (idx >= 0 && idx < state.winTabSessionPanels.length) {
          return { winTabSelectedPanelId: state.winTabSessionPanels[idx] }
        }
        return state
      }),
      setCursorWorldPos: (x, y) => set({ cursorWorldPos: { x, y } }),

      loadKeybindingsFromFile: async () => {
        const api = window.electronAPI
        if (!api?.file?.read || !api?.file?.write) return
        try {
          const home = await api.fs.home()
          if (!home) return
          const filePath = `${home}/.config/deck/keybindings.json`
          const res = await api.file.read(filePath)
          if (res.ok && res.content) {
            const parsed = JSON.parse(res.content)
            if (typeof parsed === 'object' && parsed !== null) {
              if (parsed['fit-all'] === 'shift+f') parsed['fit-all'] = 'ctrl+1'
              if (parsed['toggle-pin-front'] === 'ctrl+alt+p') parsed['toggle-pin-front'] = 'alt+p'
              const merged = { ...DEFAULT_KEYBINDINGS, ...parsed }
              set({ keybindings: merged })
            }
          } else {
            await api.file.write(filePath, JSON.stringify(DEFAULT_KEYBINDINGS, null, 2))
          }
        } catch (e) {
          console.error('Failed to load keybindings', e)
        }
      },
      updateKeybinding: async (command: string, keyCombo: string) => {
        const next = { ...get().keybindings, [command]: keyCombo }
        set({ keybindings: next })
        const api = window.electronAPI
        if (!api?.file?.write) return
        try {
          const home = await api.fs.home()
          if (!home) return
          const filePath = `${home}/.config/deck/keybindings.json`
          await api.file.write(filePath, JSON.stringify(next, null, 2))
        } catch (e) {
          console.error('Failed to save keybindings', e)
        }
      },
      resetKeybindings: async () => {
        set({ keybindings: DEFAULT_KEYBINDINGS })
        const api = window.electronAPI
        if (!api?.file?.write) return
        try {
          const home = await api.fs.home()
          if (!home) return
          const filePath = `${home}/.config/deck/keybindings.json`
          await api.file.write(filePath, JSON.stringify(DEFAULT_KEYBINDINGS, null, 2))
        } catch (e) {
          console.error('Failed to reset keybindings', e)
        }
      },

      groupIntoRegion: (panelIds, regionName) => {
        const state = get()
        if (panelIds.length === 0) return ''
        const panels = panelIds.map(id => state.panels[id]).filter(Boolean)
        if (panels.length === 0) return ''
        const minX = Math.min(...panels.map(p => p.x))
        const minY = Math.min(...panels.map(p => p.y))
        const maxX = Math.max(...panels.map(p => p.x + p.width))
        const maxY = Math.max(...panels.map(p => p.y + p.height))
        const width = maxX - minX + 40
        const height = maxY - minY + 40

        const regionId = `region-${Date.now()}`
        const regionPanel: Panel = {
          id: regionId,
          type: 'region',
          x: minX - 20,
          y: minY - 20,
          width,
          height,
          title: regionName,
          children: panelIds,
          settings: { collapsed: false },
          createdAt: Date.now()
        }

        const updatedPanels = { ...state.panels }
        panelIds.forEach(id => {
          updatedPanels[id] = { ...updatedPanels[id], regionId }
        })
        updatedPanels[regionId] = regionPanel

        set((current) => ({
          past: [...current.past.slice(-HISTORY_LIMIT + 1), snapshot(current)],
          future: [],
          panels: updatedPanels,
          selectedPanelIds: [regionId],
          ...syncActiveTab(current, { panels: updatedPanels, selectedPanelIds: [regionId] })
        }))
        return regionId
      },

      updateRegionMembership: (panelIds) => set(state => {
        const panels = { ...state.panels }
        const regions = Object.values(panels).filter(p => p.type === 'region')
        const childAdds = new Map<string, Set<string>>()  // regionId → child ids added
        const childRemoves = new Map<string, Set<string>>()  // regionId → child ids removed
        let changed = false

        const add = (m: Map<string, Set<string>>, k: string, v: string) => {
          if (!m.has(k)) m.set(k, new Set())
          m.get(k)!.add(v)
        }

        panelIds.forEach(id => {
          const p = panels[id]
          if (!p || p.type === 'region') return
          const cur = p.regionId
          // Partially-inside (overlap) test against all regions. If multiple, pick smallest (most specific).
          const candidates = regions.filter(r =>
            p.x + p.width > r.x && p.x < r.x + r.width &&
            p.y + p.height > r.y && p.y < r.y + r.height
          )
          candidates.sort((a, b) => (a.width * a.height) - (b.width * b.height))
          const target = candidates[0]

          if (target && cur !== target.id) {
            panels[id] = { ...p, regionId: target.id }
            if (cur) add(childRemoves, cur, id)
            add(childAdds, target.id, id)
            changed = true
          } else if (!target && cur) {
            const r = panels[cur]
            const fullyOutside = !r || (
              p.x + p.width <= r.x || p.x >= r.x + r.width ||
              p.y + p.height <= r.y || p.y >= r.y + r.height
            )
            if (fullyOutside) {
              panels[id] = { ...p, regionId: undefined }
              add(childRemoves, cur, id)
              changed = true
            }
          }
        })

        if (!changed) return state

        // Mirror regionId changes into region.children arrays.
        const touchedRegionIds = new Set<string>([...childAdds.keys(), ...childRemoves.keys()])
        touchedRegionIds.forEach(rid => {
          const r = panels[rid]
          if (!r || r.type !== 'region') return
          const cur = new Set(r.children || [])
          const removes = childRemoves.get(rid)
          const adds = childAdds.get(rid)
          if (removes) removes.forEach(c => cur.delete(c))
          if (adds) adds.forEach(c => cur.add(c))
          panels[rid] = { ...r, children: Array.from(cur) }
        })

        return { panels, ...syncActiveTab(state, { panels }) }
      }),

      stackPanels: (hostId, panelIds) => set(state => {
        const host = state.panels[hostId]
        if (!host || host.type === 'region') return state
        const toMerge = panelIds.filter(id => id !== hostId && state.panels[id] && state.panels[id].type !== 'region')
        if (toMerge.length === 0) return state
        const panels = { ...state.panels }
        // Promote host with merged children. Defensive against double-stack:
        // if a child is already host of its own stack, fold its children up.
        const childrenAcc: string[] = [...(host.stackChildren || [])]
        toMerge.forEach(cid => {
          const c = panels[cid]
          if (!c) return
          if (c.stackChildren && c.stackChildren.length > 0) {
            // Promote grand-children directly under new host.
            c.stackChildren.forEach(gc => {
              const g = panels[gc]
              if (!g) return
              if (!childrenAcc.includes(gc) && gc !== hostId) childrenAcc.push(gc)
              panels[gc] = {
                ...g,
                stackParentId: hostId,
                // Preserve pre-stack bbox if not already recorded.
                preStackBbox: g.preStackBbox ?? { x: g.x, y: g.y, width: g.width, height: g.height }
              }
            })
          }
          if (!childrenAcc.includes(cid)) childrenAcc.push(cid)
          panels[cid] = {
            ...c,
            stackParentId: hostId,
            stackChildren: undefined,
            stackActive: undefined,
            // Snapshot the original size so unstack/pop-out can restore it.
            preStackBbox: c.preStackBbox ?? { x: c.x, y: c.y, width: c.width, height: c.height }
          }
        })
        panels[hostId] = { ...host, stackChildren: childrenAcc, stackActive: host.stackActive || hostId }
        return {
          past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
          future: [],
          panels,
          selectedPanelIds: [hostId],
          ...syncActiveTab(state, { panels, selectedPanelIds: [hostId] })
        }
      }),

      unstackPanel: (panelId) => set(state => {
        const p = state.panels[panelId]
        if (!p) return state
        const panels = { ...state.panels }
        let hostId: string | undefined
        if (p.stackParentId) hostId = p.stackParentId
        else if (p.stackChildren && p.stackChildren.length > 0) {
          // Unstacking the host itself: promote first child to new host.
          const newHostId = p.stackChildren[0]
          const remainingChildren = p.stackChildren.slice(1)
          const newHost = panels[newHostId]
          if (newHost) {
            panels[newHostId] = {
              ...newHost,
              x: p.x, y: p.y, width: p.width, height: p.height,
              stackParentId: undefined,
              stackChildren: remainingChildren.length ? remainingChildren : undefined,
              stackActive: remainingChildren.length ? newHostId : undefined
            }
            remainingChildren.forEach(cid => {
              if (panels[cid]) panels[cid] = { ...panels[cid], stackParentId: newHostId }
            })
          }
          // Old host becomes standalone, offset so it doesn't perfectly overlap.
          panels[panelId] = {
            ...p,
            x: p.x + 40, y: p.y + 40,
            stackChildren: undefined,
            stackActive: undefined
          }
          return {
            past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
            future: [],
            panels,
            ...syncActiveTab(state, { panels })
          }
        }
        if (!hostId) return state
        const host = panels[hostId]
        if (!host || !host.stackChildren) return state
        const remaining = host.stackChildren.filter(id => id !== panelId)
        panels[hostId] = {
          ...host,
          stackChildren: remaining.length ? remaining : undefined,
          stackActive: host.stackActive === panelId ? hostId : host.stackActive
        }
        // Restore the panel's pre-stack dimensions. Position next to host.
        const restore = p.preStackBbox
        panels[panelId] = {
          ...p,
          x: host.x + host.width + 24,
          y: host.y,
          width: restore?.width ?? host.width,
          height: restore?.height ?? host.height,
          stackParentId: undefined,
          stackChildren: undefined,
          stackActive: undefined,
          preStackBbox: undefined
        }
        return {
          past: [...state.past.slice(-HISTORY_LIMIT + 1), snapshot(state)],
          future: [],
          panels,
          ...syncActiveTab(state, { panels })
        }
      }),

      setStackDropTarget: (id) => set({ stackDropTargetId: id }),

      setStackActive: (hostId, activeId) => set(state => {
        const host = state.panels[hostId]
        if (!host || !host.stackChildren) return state
        if (activeId !== hostId && !host.stackChildren.includes(activeId)) return state
        const panels = { ...state.panels, [hostId]: { ...host, stackActive: activeId } }
        return { panels, ...syncActiveTab(state, { panels }) }
      }),

      clampChildrenToRegion: (regionId) => set(state => {
        const region = state.panels[regionId]
        if (!region || region.type !== 'region') return state
        const panels = { ...state.panels }
        let changed = false
        Object.values(state.panels).forEach(p => {
          if (p.regionId !== regionId) return
          let nx = p.x, ny = p.y
          const maxX = region.x + region.width - p.width
          const maxY = region.y + region.height - p.height
          if (nx < region.x) nx = region.x
          if (ny < region.y) ny = region.y
          if (nx > maxX) nx = Math.max(region.x, maxX)
          if (ny > maxY) ny = Math.max(region.y, maxY)
          if (nx !== p.x || ny !== p.y) {
            panels[p.id] = { ...p, x: nx, y: ny }
            changed = true
          }
        })
        if (!changed) return state
        return { panels, ...syncActiveTab(state, { panels }) }
      }),

      setJumpMode: (active, letters) => set({ jumpMode: { active, letters: letters || {} } }),

      setDragGuides: (guides) => set({ dragGuides: guides }),

      markTabSaved: () => set(state => ({
        tabs: state.tabs.map(tab => tab.id === state.activeTabId ? { ...tab, lastSavedAt: Date.now() } : tab)
      })),

      saveBuiltinPreset: (kind) => {
        const state = get()
        const presetName = kind.slice('preset:'.length) as 'life' | 'no-life'
        const tab = state.tabs.find(t => t.kind === kind)
        if (!tab) return
        const grave: Record<string, Partial<Panel>> = { ...(state.presetGraveyards[presetName] || {}) }
        // Clear every panel not in the current tab — covers deleted spec panels AND deleted
        // custom panels (notes, editors). Graveyard after save = exact current tab state.
        Object.keys(grave).forEach(id => { if (!tab.panels[id]) delete grave[id] })
        Object.values(tab.panels).forEach(p => { grave[p.id] = { ...p } })
        set(s => ({
          presetGraveyards: { ...s.presetGraveyards, [presetName]: grave },
          tabs: s.tabs.map(t => t.id === tab.id ? { ...t, lastSavedAt: Date.now() } : t)
        }))
      },

      saveCanvasPreset: (name) => {
        const state = get()
        const id = `cpreset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const preset: CanvasPreset = {
          id,
          name: name.trim() || 'Untitled',
          savedAt: Date.now(),
          panels: state.panels,
          annotations: state.tabs.find(t => t.id === state.activeTabId)?.annotations,
          viewport: state.viewport
        }
        set(s => ({
          canvasPresets: { ...s.canvasPresets, [id]: preset },
          tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, linkedPresetId: id, lastSavedAt: Date.now() } : t)
        }))
        return id
      },

      overwriteCanvasPreset: (id) => {
        const state = get()
        const preset = state.canvasPresets[id]
        if (!preset) return
        const updated: CanvasPreset = { ...preset, savedAt: Date.now(), panels: state.panels, annotations: state.tabs.find(t => t.id === state.activeTabId)?.annotations, viewport: state.viewport }
        set(s => ({
          canvasPresets: { ...s.canvasPresets, [id]: updated },
          tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, lastSavedAt: Date.now() } : t)
        }))
      },

      loadCanvasPreset: (id) => {
        const state = get()
        const preset = state.canvasPresets[id]
        if (!preset) return
        // Clone panels and put browser panels to sleep.
        const panels: Record<string, Panel> = {}
        Object.values(preset.panels).forEach(p => {
          panels[p.id] = p.type === 'browser'
            ? { ...p, settings: { ...(p.settings || {}), lazyLoad: true } }
            : { ...p }
        })
        const fitted = fitViewportToPanels(panels)
        const tab: WorkspaceTab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: preset.name,
          panels,
          annotations: preset.annotations ? [...preset.annotations] : undefined,
          viewport: fitted,
          selectedPanelIds: [],
          createdAt: Date.now(),
          linkedPresetId: id,
          lastSavedAt: Date.now(),
          lastEditedAt: 0
        }
        set(s => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          panels: tab.panels,
          selectedPanelIds: [],
          viewport: tab.viewport,
          past: [],
          future: []
        }))
      },

      deleteCanvasPreset: (id) => set(state => {
        const next = { ...state.canvasPresets }
        delete next[id]
        return { canvasPresets: next }
      }),

      renameCanvasPreset: (id, name) => set(state => {
        const preset = state.canvasPresets[id]
        if (!preset) return {}
        return {
          canvasPresets: {
            ...state.canvasPresets,
            [id]: { ...preset, name }
          }
        }
      }),

      saveViewportBookmark: (num) => {
        const state = get()
        set((s) => ({
          viewportBookmarks: {
            ...(s.viewportBookmarks || {}),
            [num]: state.viewport
          }
        }))
      },

      loadViewportBookmark: (num) => {
        const state = get()
        const bookmark = state.viewportBookmarks?.[num]
        if (bookmark) {
          window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
          set({ viewport: bookmark })
        }
      },

      findOrCreateScratchpad: () => {
        const state = get()
        const existing = state.tabs.find(t => t.kind === 'scratchpad')
        if (existing) {
          set({ activeTabId: existing.id, panels: existing.panels, viewport: existing.viewport, selectedPanelIds: [] })
          return
        }
        const tab = createEmptyTab('Scratchpad')
        tab.kind = 'scratchpad'
        tab.color = '#6b7280'
        set(state2 => ({
          tabs: [...state2.tabs, tab],
          activeTabId: tab.id,
          panels: {},
          viewport: { x: 0, y: 0, zoom: 1 },
          selectedPanelIds: [],
          past: [],
          future: []
        }))
      },

      movePanelToTab: (panelId, toTabId) => set(state => {
        if (toTabId === state.activeTabId) return state
        const panel = state.panels[panelId]
        if (!panel) return state
        const fromPanels = { ...state.panels }
        delete fromPanels[panelId]
        // Cascade: if region, take children with it.
        const moved: Record<string, Panel> = { [panelId]: panel }
        if (panel.type === 'region' && panel.children) {
          panel.children.forEach(cid => {
            const c = state.panels[cid]
            if (c) {
              moved[cid] = c
              delete fromPanels[cid]
            }
          })
        }
        const tabs = state.tabs.map(tab => {
          if (tab.id === state.activeTabId) {
            return { ...tab, panels: fromPanels, selectedPanelIds: tab.selectedPanelIds.filter(id => !(id in moved)), lastEditedAt: Date.now() }
          }
          if (tab.id === toTabId) {
            return { ...tab, panels: { ...tab.panels, ...moved }, lastEditedAt: Date.now() }
          }
          return tab
        })
        return {
          tabs,
          panels: fromPanels,
          selectedPanelIds: state.selectedPanelIds.filter(id => !(id in moved))
        }
      }),

      exportWorkspace: () => {
        const state = get()
        return JSON.stringify({
          version: 1,
          exportedAt: Date.now(),
          tabs: state.tabs,
          activeTabId: state.activeTabId
        }, null, 2)
      },

      importWorkspace: (json) => {
        try {
          const data = JSON.parse(json)
          if (!data.tabs || !Array.isArray(data.tabs) || data.tabs.length === 0) return false
          // Validate each tab has minimum required shape.
          const validTabs: WorkspaceTab[] = data.tabs.filter((t: unknown): t is WorkspaceTab => {
            const cand = t as Partial<WorkspaceTab> | null
            return !!cand && typeof cand.id === 'string' && typeof cand.title === 'string' &&
              cand.panels !== undefined && cand.viewport !== undefined
          })
          if (validTabs.length === 0) return false
          // Fall back to first tab if activeTabId points nowhere.
          const activeTabId = validTabs.find(t => t.id === data.activeTabId)?.id || validTabs[0].id
          const active = validTabs.find(t => t.id === activeTabId)!
          set({
            tabs: validTabs,
            activeTabId,
            panels: active.panels || {},
            selectedPanelIds: [],
            viewport: active.viewport || { x: 0, y: 0, zoom: 1 },
            past: [],
            future: []
          })
          return true
        } catch {
          return false
        }
      },

      ungroupRegion: (regionId) => {
        const state = get()
        const region = state.panels[regionId]
        if (!region || region.type !== 'region') return
        const updatedPanels = { ...state.panels }
        const childIds = region.children || []
        childIds.forEach(id => {
          if (updatedPanels[id]) {
            updatedPanels[id] = { ...updatedPanels[id], regionId: undefined }
          }
        })
        delete updatedPanels[regionId]
        set((current) => ({
          past: [...current.past.slice(-HISTORY_LIMIT + 1), snapshot(current)],
          future: [],
          panels: updatedPanels,
          selectedPanelIds: childIds.filter(id => updatedPanels[id]),
          ...syncActiveTab(current, { panels: updatedPanels, selectedPanelIds: childIds.filter(id => updatedPanels[id]) })
        }))
      }
    }),
    {
      name: 'worktree-studio-workspace',
      storage: createJSONStorage(() => dualStorage),
      version: 5,
      partialize: (state) => {
        const nonScratchTabs = state.tabs.filter(t => t.kind !== 'scratchpad')
        const activeIsScratch = state.tabs.find(t => t.id === state.activeTabId)?.kind === 'scratchpad'
        return {
          panels: state.panels,
          viewport: state.viewport,
          tabs: nonScratchTabs,
          activeTabId: activeIsScratch ? (nonScratchTabs[0]?.id || state.activeTabId) : state.activeTabId,
          projectId: state.projectId,
          minimapVisible: state.minimapVisible,
          outlinerOpen: state.outlinerOpen,
          statusBarVisible: state.statusBarVisible,
          chromeVisible: state.chromeVisible,
          sidebarOpen: state.sidebarOpen,
          sidebarSection: state.sidebarSection,
          sidebarPin: state.sidebarPin,
          hiddenSidebarSections: state.hiddenSidebarSections,
          prefs: state.prefs,
          presetGraveyards: state.presetGraveyards,
          canvasPresets: state.canvasPresets,
          annotationsVisible: state.annotationsVisible,
          viewportBookmarks: state.viewportBookmarks
        }
      },
      // v2: scrub retired gold/amber colors. v3: force snapToGrid off. v4: add canvasPresets. v5: snapToGrid removed.
      // v5: remove retired 'tokens' and 'notes' sidebar sections.
      migrate: (persisted: unknown, version: number) => {
        const RETIRED = new Set(['#d4a017', '#ffd36a', '#ffc517', '#ffbd2e'])
        const scrub = (c?: string) => (c && RETIRED.has(c.toLowerCase()) ? '' : c)
        const data = persisted as {
          panels?: Record<string, Panel>; tabs?: WorkspaceTab[];
          canvasPresets?: Record<string, CanvasPreset>;
          sidebarSection?: string; hiddenSidebarSections?: string[]
        }
        if (data?.panels) {
          Object.values(data.panels).forEach(p => { if (p.color) p.color = scrub(p.color) })
        }
        if (data?.tabs) {
          data.tabs.forEach(t => {
            if (t.color) t.color = scrub(t.color)
            if (t.panels) Object.values(t.panels).forEach(p => { if (p.color) p.color = scrub(p.color) })
          })
        }
        if (data && !data.canvasPresets) data.canvasPresets = {}
        if (data && !data.viewportBookmarks) data.viewportBookmarks = {}
        if (version < 5) {
          if (data.sidebarSection === 'tokens' || data.sidebarSection === 'notes') {
            data.sidebarSection = 'explorer'
          }
          if (data.hiddenSidebarSections) {
            data.hiddenSidebarSections = data.hiddenSidebarSections.filter(
              s => s !== 'tokens' && s !== 'notes'
            )
          }
        }
        return data as WorkspaceState
      }
    }
  )
)
