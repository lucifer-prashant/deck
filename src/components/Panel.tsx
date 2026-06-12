import React, { useRef, useState, useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { Panel as PanelType, useWorkspaceStore } from '../store/workspaceStore'
import { TerminalShellType, ShellConfig, SHELL_CONFIGS, getShellOptions } from '../types/terminalShells'
import ShellSwitchConfirmDialog from './ShellSwitchConfirmDialog'
import { executeWorkspaceCommand } from '../workspaceCommands'
import { confirmPanelsDeletion } from '../panelDeletion'
import PanelContextMenu from './PanelContextMenu'
import BrowserPanel from './BrowserPanel'
import TerminalPanel from './TerminalPanel'
import EditorPanel from './EditorPanel'
import { getAnchorPoint, resolveConnectionRoute, generateStraightPath, generateSmoothPath } from '../annotationUtils'
import './Panel.css'

interface PanelProps {
  panel: PanelType
  isSelected: boolean
  offscreen?: boolean
  annotateMode?: boolean
  embedded?: boolean  // rendered inside another panel's stack body — skip chrome + positioning
  onSelect: (id: string, additive: boolean) => void
  onMove: (id: string, x: number, y: number) => void
  onResize: (id: string, width: number, height: number) => void
}

type ResizeDir = 'se' | 'sw' | 'ne' | 'nw' | 'n' | 's' | 'e' | 'w'

const TYPE_ICON: Record<PanelType['type'], string> = {
  terminal: '▶',
  editor: '✎',
  browser: '◐',
  region: '▢'
}

const healthTitle = (s: string) => {
  switch (s) {
    case 'alive': return 'Terminal running'
    case 'loading': return 'Loading...'
    case 'sleeping': return 'Sleeping (click to wake)'
    case 'loaded': return 'Loaded'
    case 'dead': return 'Terminal exited — click to restart'
    case 'crashed': return 'Crashed — click to reload'
    default: return ''
  }
}

function createRelationshipArrow(targetId: string) {
  const s = useWorkspaceStore.getState()
  const srcId = s.annotateSourcePanelId
  if (!srcId || srcId === targetId) return
  const src = s.panels[srcId]
  const tgt = s.panels[targetId]
  if (!src || !tgt) return
  const anno = {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'relationship' as const,
    x: 0, y: 0, width: 0, height: 0,
    text: '', color: s.drawColor || '#6b7280',
    sourcePanelId: srcId,
    targetPanelId: targetId,
    sourceAnchor: 'center' as const,
    targetAnchor: 'center' as const
  }
  s.addAnnotation(anno)
  s.setAnnotateSourcePanel(null)
}

const SNAP_PX = 6 // screen-space alignment-guide threshold

// Retired gold accents — any persisted panel.color matching these is ignored at render
// time so old saves can't show a gold border even if migration hasn't run yet.
const RETIRED_COLORS = new Set(['#d4a017', '#ffd36a', '#ffc517', '#ffbd2e'])
const sanitizeColor = (c?: string): string | undefined => {
  if (!c) return undefined
  return RETIRED_COLORS.has(c.toLowerCase()) ? undefined : c
}

const SleepPlaceholder: React.FC<{ panel: PanelType; onLoad: () => void }> = ({ panel, onLoad }) => {
  const accent = sanitizeColor(panel.color) || '#4dabe8'
  // Don't stop mousedown propagation — let Panel's handler run so dragging works
  // straight from the placeholder. Only the click handler wakes the panel.
  return (
    <div
      className="panel-content"
      onClick={(e) => { e.stopPropagation(); onLoad() }}
      role="button"
      title={`Click to load ${panel.title}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: `radial-gradient(120% 90% at 50% 30%, ${accent}22, transparent 65%), linear-gradient(180deg, #16181d, #0d0f12)`,
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      <div style={{
        width: 68,
        height: 68,
        borderRadius: 16,
        background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 30,
        fontWeight: 800,
        boxShadow: `0 12px 32px ${accent}44, 0 0 0 1px ${accent}66 inset`
      }}>{TYPE_ICON[panel.type]}</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{panel.title}</div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>{panel.type}</div>
      </div>
      <div style={{
        marginTop: 4,
        padding: '8px 18px',
        borderRadius: 999,
        background: `${accent}22`,
        border: `1px solid ${accent}55`,
        color: '#fff',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase'
      }}>click to load</div>
    </div>
  )
}

const Panel: React.FC<PanelProps> = ({ panel, isSelected, offscreen, annotateMode, embedded, onSelect, onMove, onResize }) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const shellSwitcherRef = useRef<HTMLDivElement>(null)
  const [pillOpen, setPillOpen] = useState(false)
  const [pendingShell, setPendingShell] = useState<(ShellConfig & { pathHint?: string }) | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState<ResizeDir | null>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const dragStartCursor = useRef({ x: 0, y: 0 })
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, panelX: 0, panelY: 0 })
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(panel.title)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; targetPanel?: PanelType } | null>(null)
  const initialPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  const annoInitialPositions = useRef<Array<{ id: string; x: number; y: number }>>([])
  const dragMoved = useRef(false)
  // Cached header elements for stack-merge hit testing during drag.
  // Populated once at drag start, cleared on mouseup — avoids querySelectorAll at 60fps.
  const cachedHeaders = useRef<Array<{ el: HTMLElement; pid: string; rect: DOMRect }> | null>(null)
  // When user clicks (no shift) on a panel that's already part of a multi-selection,
  // defer collapsing selection to single until mouseup — gives them a chance to drag
  // the whole group from this panel first. If they only click (no drag), collapse.
  const pendingCollapseToSingle = useRef(false)

  // Heavy perf optimization: Panel previously subscribed to s.panels (whole object) which
  // meant every Panel re-rendered on every mouse move during a drag of any other panel.
  // Now we only subscribe to the small slices that actually affect this panel's render
  // output. Everything cross-panel (snap math, max zIndex, selection batch) reads via
  // getState() inside event handlers — fresh values without React re-renders.
  const jumpModeActive = useWorkspaceStore(s => s.jumpMode.active)
  const headerActiveId = useWorkspaceStore(s => s.headerActivePanelId)
  const bodyActiveId = useWorkspaceStore(s => s.bodyActivePanelId)
  // Actions are stable references, pull from getState() to avoid subscribing.
  const deletePanel = useWorkspaceStore(s => s.deletePanel)
  const updatePanel = useWorkspaceStore(s => s.updatePanel)
  const pushHistory = useWorkspaceStore(s => s.pushHistory)
  const setDragGuides = useWorkspaceStore(s => s.setDragGuides)
  const stackDropTargetId = useWorkspaceStore(s => s.stackDropTargetId)
  const prefs = useWorkspaceStore(s => s.prefs)
  // Track which other panel's header is under the cursor during a drag — used
  // for drag-onto-header → stack merge. Updated in applyMove; consumed in mouseup.
  const stackHitRef = useRef<string | null>(null)

  useEffect(() => {
    if (!renaming) setDraftTitle(panel.title)
  }, [panel.title, renaming])

  useEffect(() => {
    if (!pillOpen) return
    const handler = (e: MouseEvent) => {
      if (shellSwitcherRef.current && !shellSwitcherRef.current.contains(e.target as Node)) {
        setPillOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pillOpen])

  const getPanelShellType = useCallback((): TerminalShellType | null => {
    const shellPath = (panel.settings?.shellPath as string) || ''
    if (shellPath in SHELL_CONFIGS) {
      return shellPath as TerminalShellType
    }
    if (shellPath) {
      return 'custom'
    }
    const defType = prefs.defaultTerminalShellType
    if (defType && defType !== 'remember_last') {
      return defType === 'custom' ? 'custom' : (defType as TerminalShellType)
    }
    const lastType = prefs.lastSpawnedShellType
    if (lastType) {
      return lastType
    }
    return null
  }, [panel.settings?.shellPath, prefs.defaultTerminalShellType, prefs.lastSpawnedShellType])

  const executeShellSwitch = useCallback((shellType: TerminalShellType, customPathOverride?: string) => {
    window.electronAPI?.pty?.kill(panel.id)
    let shellPath = ''
    if (customPathOverride !== undefined) {
      shellPath = customPathOverride
    } else if (shellType === 'custom') {
      const customPath = window.prompt("Enter custom shell executable path:", (panel.settings?.shellPath as string) || '')
      if (customPath === null) return false
      shellPath = customPath
    } else {
      shellPath = shellType
    }

    updatePanel(panel.id, {
      settings: {
        ...(panel.settings || {}),
        shellPath
      }
    })

    useWorkspaceStore.getState().updatePrefs({ lastSpawnedShellType: shellType })
    return true
  }, [panel.id, panel.settings, updatePanel])

  const handleSelectShell = useCallback((toShellConfig: ShellConfig & { pathHint?: string }) => {
    setPillOpen(false)
    const activePath = (panel.settings?.shellPath as string) || (panel.settings?.resolvedShellPath as string) || prefs.defaultTerminalShell || ''
    const isSame = toShellConfig.pathHint !== undefined
      ? (toShellConfig.pathHint === activePath)
      : (toShellConfig.type === getPanelShellType())

    if (isSame) {
      return // close and no-op
    }

    if (prefs.skipShellSwitchConfirmation) {
      executeShellSwitch(toShellConfig.type, toShellConfig.pathHint)
    } else {
      setPendingShell(toShellConfig)
    }
  }, [panel.settings?.shellPath, panel.settings?.resolvedShellPath, prefs.defaultTerminalShell, getPanelShellType, prefs.skipShellSwitchConfirmation, executeShellSwitch])

  const currentShellType = getPanelShellType()
  const currentShellConfig = currentShellType ? SHELL_CONFIGS[currentShellType] : null
  const pillIcon = currentShellConfig ? currentShellConfig.icon : 'ti ti-terminal-2'
  const activeShellPath = (panel.settings?.shellPath as string) || (panel.settings?.resolvedShellPath as string) || prefs.defaultTerminalShell || ''
  const displayLabel = (currentShellType && currentShellType !== 'custom')
    ? SHELL_CONFIGS[currentShellType].label
    : (activeShellPath
        ? (activeShellPath.split(/[/\\]/).filter(Boolean).pop() || 'Terminal')
        : 'Terminal')

  const isWin = (window.electronAPI?.platform || 'linux') === 'win32'
  const recentShellPaths = prefs.recentShellPaths || []
  const canSwitch = isWin
    ? getShellOptions('win32').length > 1
    : recentShellPaths.length > 1

  const dynamicFromShell = (currentShellType && currentShellType !== 'custom')
    ? SHELL_CONFIGS[currentShellType]
    : {
        type: 'custom' as TerminalShellType,
        label: activeShellPath.split(/[/\\]/).filter(Boolean).pop() || 'Terminal',
        icon: 'ti ti-terminal-2',
        windowsOnly: false,
        defaultPath: activeShellPath
      }

  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      })
    }
  }, [renaming])

  const beginRename = useCallback(() => {
    if (panel.locked) return
    setDraftTitle(panel.title)
    setRenaming(true)
  }, [panel.title, panel.locked])

  // External rename request (e.g. F2 from canvas) → enter inline rename mode.
  const renameRequestId = useWorkspaceStore(s => s.renameRequestId)
  const requestRename = useWorkspaceStore(s => s.requestRename)
  useEffect(() => {
    if (renameRequestId === panel.id) {
      beginRename()
      requestRename(null)
    }
  }, [renameRequestId, panel.id, beginRename, requestRename])

  const commitRename = useCallback(() => {
    const next = draftTitle.trim()
    if (next && next !== panel.title) updatePanel(panel.id, { title: next })
    setRenaming(false)
  }, [draftTitle, panel.id, panel.title, updatePanel])

  const cancelRename = useCallback(() => {
    setDraftTitle(panel.title)
    setRenaming(false)
  }, [panel.title])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (renaming) return
    if (e.button === 2) return
    if (jumpModeActive) { e.stopPropagation(); return }
    if (annotateMode) {
      const s = useWorkspaceStore.getState()
      const tool = s.annotateTool
      if (tool === 'arrow' && s.annotateSourcePanelId && s.annotateSourcePanelId !== panel.id) {
        e.stopPropagation()
        createRelationshipArrow(panel.id)
        return
      }
      // Block panel interaction when in annotate mode.
      e.stopPropagation()
      return
    }
    // Mousedown inside terminal xterm or note textarea must go to the embedded
    // app (selection / cursor placement) — don't initiate a panel drag here.
    // The header still drags normally because xterm/note don't live there.
    const t = e.target as HTMLElement | null
    const inEmbeddedBody = !!(
      t?.closest?.('.terminal-xterm') ||
      t?.closest?.('.note-content') ||
      t?.closest?.('.xterm') ||
      t?.tagName === 'WEBVIEW' ||
      t?.closest?.('webview')
    )
    if (inEmbeddedBody) {
      // Still stop bubbling so Canvas doesn't treat this as empty-canvas pan,
      // and record selection + focus, but skip drag setup so xterm/textarea
      // gets the raw mousedown for selection.
      e.stopPropagation()
      const sBefore2 = useWorkspaceStore.getState()
      if (!sBefore2.selectedPanelIds.includes(panel.id)) onSelect(panel.id, false)
      if (panel.type !== 'region') sBefore2.setLastFocusedPanel(panel.id)
      return
    }
    e.stopPropagation()

    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const sBefore = useWorkspaceStore.getState()
    const alreadyInMulti = (sBefore.selectedPanelIds.length > 1 || sBefore.selectedAnnotationIds.length > 0) && sBefore.selectedPanelIds.includes(panel.id)

    if (additive) {
      onSelect(panel.id, true)
    } else if (alreadyInMulti) {
      // Keep multi-selection live so the upcoming move (if any) drags the whole group.
      // Bump lastFocusedPanel so sidebar context still follows this click.
      // Skip for regions — region click must not steal sidebar context.
      if (panel.type !== 'region') sBefore.setLastFocusedPanel(panel.id)
      pendingCollapseToSingle.current = true
    } else {
      onSelect(panel.id, false)
    }

    // Auto-raise (skip if pinned front or pinned back). Read panels via getState so we
    // don't subscribe to the whole object.
    if (panel.type !== 'region' && !panel.pinFront && !panel.pinBack) {
      const allPanels = Object.values(useWorkspaceStore.getState().panels)
      const otherZs = allPanels
        .filter(p => p.id !== panel.id && !p.pinFront && !p.pinBack)
        .map(p => p.zIndex || 1)
      const maxOtherZ = otherZs.length > 0 ? Math.max(...otherZs) : 1
      if (panel.zIndex === undefined || panel.zIndex <= maxOtherZ) {
        updatePanel(panel.id, { zIndex: maxOtherZ + 1 }, { skipHistory: true })
      }
    }

    if (!panelRef.current || panel.locked) return

    const rect = panelRef.current.getBoundingClientRect()
    setIsDragging(true)
    dragMoved.current = false
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    dragStartCursor.current = { x: e.clientX, y: e.clientY }

    const s = useWorkspaceStore.getState()
    const baseSelected = s.selectedPanelIds.length > 0 ? s.selectedPanelIds : [panel.id]
    // Expand any region in the drag set to include its children — region drag must
    // carry its contents. Children get the same dx/dy via the existing multi-drag
    // transform path, so no per-frame store writes (smoothness preserved).
    const dragSet = new Set<string>(baseSelected)
    baseSelected.forEach(id => {
      const p = s.panels[id]
      if (p && p.type === 'region') {
        Object.values(s.panels).forEach(child => {
          if (child.regionId === id) dragSet.add(child.id)
        })
      }
    })
    const positions = new Map<string, { x: number; y: number }>()
    dragSet.forEach(id => {
      const p = s.panels[id]
      if (p) positions.set(id, { x: p.x, y: p.y })
    })
    initialPositions.current = positions

    // Cache all panel headers once here so the drag rAF loop doesn't querySelectorAll every frame.
    if (panel.type !== 'region') {
      const headerEls = document.querySelectorAll<HTMLElement>('.panel > .panel-header')
      cachedHeaders.current = []
      headerEls.forEach(h => {
        const parent = h.parentElement as HTMLElement | null
        if (!parent || parent === panelRef.current) return
        const pid = parent.getAttribute('data-panel-id')
        if (!pid || pid === panel.id) return
        cachedHeaders.current!.push({ el: h, pid, rect: h.getBoundingClientRect() })
      })
    }

    // Cache selected annotation positions for cross-type multi-move.
    const s3 = useWorkspaceStore.getState()
    const tab = s3.tabs.find(t => t.id === s3.activeTabId)
    if (tab?.annotations && s3.selectedAnnotationIds.length > 0) {
      annoInitialPositions.current = s3.selectedAnnotationIds.map(id => {
        const a = tab.annotations!.find(aa => aa.id === id)
        return a ? { id, x: a.x, y: a.y } : null
      }).filter(Boolean) as { id: string; x: number; y: number }[]
    } else {
      annoInitialPositions.current = []
    }
  }, [panel.id, panel.type, panel.locked, panel.pinFront, panel.pinBack, panel.zIndex, onSelect, renaming, updatePanel, jumpModeActive, annotateMode])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (jumpModeActive || annotateMode) return
    const target = e.target as HTMLElement
    const isHeaderOrTabstrip = !!(
      target.closest('.panel-header') ||
      target.closest('.panel-stack-tabs') ||
      target.closest('.browser-tabstrip')
    )
    if (!isHeaderOrTabstrip) return
    e.preventDefault()
    e.stopPropagation()
    const s = useWorkspaceStore.getState()
    if (!s.selectedPanelIds.includes(panel.id)) onSelect(panel.id, false)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [panel.id, onSelect, jumpModeActive, annotateMode])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmPanelsDeletion([panel])) deletePanel(panel.id)
  }, [panel, deletePanel])

  const handleResizeMouseDown = useCallback((dir: ResizeDir) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (panel.locked || annotateMode) return
    pushHistory()
    setIsResizing(dir)
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: panel.width,
      height: panel.height,
      panelX: panel.x,
      panelY: panel.y
    })
  }, [panel.width, panel.height, panel.x, panel.y, panel.locked, annotateMode, pushHistory])

  const toggleMinimized = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    updatePanel(panel.id, { minimized: !panel.minimized })
  }, [panel.id, panel.minimized, updatePanel])

  const toggleLocked = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    updatePanel(panel.id, { locked: !panel.locked })
  }, [panel.id, panel.locked, updatePanel])

  const togglePinFront = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear pinBack on either transition to keep mutex consistent.
    updatePanel(panel.id, { pinFront: !panel.pinFront, pinBack: false })
  }, [panel.id, panel.pinFront, updatePanel])

  useEffect(() => {
    // PERF: during a drag we don't call onMove every frame — that would trigger a store
    // commit and re-render the whole panel tree (including expensive webviews inside
    // editors/browsers). Instead we apply CSS transform directly to each dragged panel's
    // DOM element so the compositor moves them without layout/repaint. On mouseup we
    // commit the final positions to the store in a single batch.
    let pendingMove: MouseEvent | null = null
    let rafId = 0
    let dragCommit: null | (() => void) = null
    let resizeCommit: null | (() => void) = null

    // Cache DOM queries at drag start to avoid querySelectorAll layout thrashing at 60fps
    let cachedPorts: SVGCircleElement[] = []
    let cachedRelPaths: SVGPathElement[] = []
    const cachedRelLabels = new Map<string, SVGTextElement>()
    const cachedPanelEls = new Map<string, HTMLElement>()

    if (isDragging) {
      cachedPorts = Array.from(document.querySelectorAll<SVGCircleElement>('circle[data-port-panel-id]'))
      cachedRelPaths = Array.from(document.querySelectorAll<SVGPathElement>('path[data-relationship-id]'))
      document.querySelectorAll<SVGTextElement>('text[data-relationship-label-id]').forEach(el => {
        const id = el.getAttribute('data-relationship-label-id')
        if (id) cachedRelLabels.set(id, el)
      })
      initialPositions.current.forEach((_, id) => {
        const el = document.querySelector(`.panel[data-panel-id="${id}"]`) as HTMLElement | null
        if (el) cachedPanelEls.set(id, el)
      })
    }

    const setPanelTransform = (id: string, dxWorld: number, dyWorld: number) => {
      const el = cachedPanelEls.get(id) || document.querySelector(`.panel[data-panel-id="${id}"]`) as HTMLElement | null
      if (el) el.style.transform = `translate3d(${dxWorld}px, ${dyWorld}px, 0)`
    }

    const applyMove = (e: MouseEvent) => {
      if (isDragging) {
        if (!dragMoved.current) {
          const cdx = e.clientX - dragStartCursor.current.x
          const cdy = e.clientY - dragStartCursor.current.y
          if (Math.hypot(cdx, cdy) < 4) return
          pushHistory()
          dragMoved.current = true
        }
        const s = useWorkspaceStore.getState()
        const viewport = s.viewport
        let newX = (e.clientX - dragStart.x - viewport.x) / viewport.zoom
        let newY = (e.clientY - dragStart.y - viewport.y) / viewport.zoom

        const initial = initialPositions.current
        const isMulti = initial.size > 1
        const anchor = isMulti ? initial.get(panel.id) : null

        let snapX: number | null = null
        let snapY: number | null = null
        // Alignment guides — always active, Shift disables.
        if (!isMulti && !e.shiftKey) {
          const tolWorld = SNAP_PX / viewport.zoom
          const myL = newX
          const myR = newX + panel.width
          const myCx = newX + panel.width / 2
          const myT = newY
          const myB = newY + panel.height
          const myCy = newY + panel.height / 2
          const others = Object.values(s.panels).filter(p => p.id !== panel.id && p.type !== 'region')
          const guides: Array<{ axis: 'x' | 'y'; world: number }> = []
          let bestDx = tolWorld
          let bestDy = tolWorld
          others.forEach(p => {
            const candX = [p.x, p.x + p.width / 2, p.x + p.width]
            candX.forEach(cx => {
              [myL, myCx, myR].forEach((my, i) => {
                const d = Math.abs(cx - my)
                if (d < bestDx) {
                  bestDx = d
                  snapX = cx - (i === 0 ? 0 : i === 1 ? panel.width / 2 : panel.width)
                }
              })
            })
            const candY = [p.y, p.y + p.height / 2, p.y + p.height]
            candY.forEach(cy => {
              [myT, myCy, myB].forEach((my, i) => {
                const d = Math.abs(cy - my)
                if (d < bestDy) {
                  bestDy = d
                  snapY = cy - (i === 0 ? 0 : i === 1 ? panel.height / 2 : panel.height)
                }
              })
            })
          })
          if (snapX !== null) newX = snapX
          if (snapY !== null) newY = snapY
          if (snapX !== null) {
            const lines = new Set<number>()
            const x = snapX
            ;[x, x + panel.width / 2, x + panel.width].forEach(v => lines.add(v))
            others.forEach(p => {
              [p.x, p.x + p.width / 2, p.x + p.width].forEach(v => {
                lines.forEach(l => {
                  if (Math.abs(l - v) < 0.5) guides.push({ axis: 'x', world: v })
                })
              })
            })
          }
          if (snapY !== null) {
            const lines = new Set<number>()
            const y = snapY
            ;[y, y + panel.height / 2, y + panel.height].forEach(v => lines.add(v))
            others.forEach(p => {
              [p.y, p.y + p.height / 2, p.y + p.height].forEach(v => {
                lines.forEach(l => {
                  if (Math.abs(l - v) < 0.5) guides.push({ axis: 'y', world: v })
                })
              })
            })
          }
          setDragGuides(guides)
        }

        if (isMulti && anchor) {
          const dx = newX - anchor.x
          const dy = newY - anchor.y
          const finalPositions = new Map<string, { x: number; y: number }>()
          initial.forEach((pos, id) => {
            const nx = pos.x + dx, ny = pos.y + dy
            setPanelTransform(id, nx - pos.x, ny - pos.y)
            finalPositions.set(id, { x: nx, y: ny })
          })
          // Move selected annotations in sync with panels.
          if (annoInitialPositions.current.length > 0) {
            const sAnno = useWorkspaceStore.getState()
            annoInitialPositions.current.forEach(({ id, x, y }) => {
              sAnno.updateAnnotation(id, { x: x + dx, y: y + dy })
            })
          }
          // CRITICAL: write final inline left/top AND clear transform BEFORE flushSync.
          // Otherwise React commits new left/top while the transform offset is still on
          // the DOM, briefly placing the panel at (finalX + dragOffset) — the jerk.
          dragCommit = () => {
            finalPositions.forEach((pos, id) => {
              const el = document.querySelector(`.panel[data-panel-id="${id}"]`) as HTMLElement | null
              if (el) {
                el.style.transform = ''
                el.style.left = `${pos.x}px`
                el.style.top = `${pos.y}px`
              }
            })
            flushSync(() => {
              finalPositions.forEach((pos, id) => onMove(id, pos.x, pos.y))
            })
            // Region-membership recompute for moved panels. Skip the panels that
            // were dragged as part of a region (they moved with their region, so
            // membership doesn't change). Only check panels whose drag origin was
            // a real user selection — not children expanded by the region-carry.
            const s2 = useWorkspaceStore.getState()
            const draggedIds = Array.from(finalPositions.keys())
            const draggedRegionIds = new Set(
              draggedIds.filter(id => s2.panels[id]?.type === 'region')
            )
            const toCheck = draggedIds.filter(id => {
              const p = s2.panels[id]
              if (!p || p.type === 'region') return false
              // If this panel's regionId is a region also in the drag set, it
              // moved with the region — don't reassign.
              if (p.regionId && draggedRegionIds.has(p.regionId)) return false
              return true
            })
            if (toCheck.length) s2.updateRegionMembership(toCheck)
          }
        } else {
          const liveX = newX, liveY = newY
          const anchorSingle = initial.get(panel.id) || { x: panel.x, y: panel.y }
          setPanelTransform(panel.id, liveX - anchorSingle.x, liveY - anchorSingle.y)
          const finalX = liveX, finalY = liveY
          // Move selected annotations in sync with this panel.
          if (annoInitialPositions.current.length > 0) {
            const sAnno = useWorkspaceStore.getState()
            const adx = liveX - anchorSingle.x
            const ady = liveY - anchorSingle.y
            annoInitialPositions.current.forEach(({ id, x, y }) => {
              sAnno.updateAnnotation(id, { x: x + adx, y: y + ady })
            })
          }

          // Drag-onto-header → stack merge detection. Use headers cached at drag start
          // (avoids querySelectorAll at 60fps). Skip for regions.
          if (panel.type !== 'region') {
            const headers = cachedHeaders.current || []
            let hit: string | null = null
            for (let i = 0; i < headers.length; i++) {
              const { pid, rect: r } = headers[i]
              if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                // Also skip if target panel is itself stacked into someone else
                // (we only merge into top-level hosts to keep tree flat).
                const tp = useWorkspaceStore.getState().panels[pid]
                if (tp && !tp.stackParentId && tp.type !== 'region') {
                  hit = pid
                  break
                }
              }
            }
            stackHitRef.current = hit
            const cur = useWorkspaceStore.getState().stackDropTargetId
            if (hit !== cur) useWorkspaceStore.getState().setStackDropTarget(hit)
          }
          // CRITICAL: write final inline left/top AND clear transform BEFORE flushSync.
          // Otherwise React commits new left/top while the transform offset is still on
          // the DOM, briefly placing the panel at (finalX + dragOffset) — the jerk.
          dragCommit = () => {
            // Stack merge takes priority — if cursor was over another panel's
            // header at release, fold this panel into that one and skip the
            // position commit (host's bbox wins).
            const hit = stackHitRef.current
            stackHitRef.current = null
            const s2 = useWorkspaceStore.getState()
            s2.setStackDropTarget(null)
            if (hit && panel.type !== 'region') {
              const el = panelRef.current
              if (el) el.style.transform = ''  // clear drag offset
              s2.stackPanels(hit, [panel.id])
              return
            }
            const el = panelRef.current
            if (el) {
              el.style.transform = ''
              el.style.left = `${finalX}px`
              el.style.top = `${finalY}px`
            }
            flushSync(() => { onMove(panel.id, finalX, finalY) })
            // Region-membership recompute for the moved panel (skip regions).
            if (panel.type !== 'region') {
              useWorkspaceStore.getState().updateRegionMembership([panel.id])
            }
          }
        }

        // Update any connecting relationship arrows in the DOM in real-time.
        const currentPanels: Record<string, { id: string; x: number; y: number; width: number; height: number; type: 'terminal' | 'editor' | 'browser' | 'region'; minimized?: boolean }> = {}
        const allPanels = useWorkspaceStore.getState().panels
        Object.entries(allPanels).forEach(([id, p]) => {
          currentPanels[id] = { id, x: p.x, y: p.y, width: p.width, height: p.height, type: p.type, minimized: p.minimized }
        })
        // Update positions for panels currently being dragged
        if (isMulti && anchor) {
          const dx = newX - anchor.x
          const dy = newY - anchor.y
          initial.forEach((pos, id) => {
            if (currentPanels[id]) {
              currentPanels[id].x = pos.x + dx
              currentPanels[id].y = pos.y + dy
            }
          })
        } else {
          if (currentPanels[panel.id]) {
            currentPanels[panel.id].x = newX
            currentPanels[panel.id].y = newY
          }
        }

        // Update port positions in the DOM in real-time
        cachedPorts.forEach(circle => {
          const pid = circle.getAttribute('data-port-panel-id')
          if (!pid) return
          // Only update ports of panels that are moving
          const isMoving = isMulti ? initial.has(pid) : (pid === panel.id)
          if (!isMoving) return

          const anchor = circle.getAttribute('data-port-anchor')
          if (!anchor) return
          const p = currentPanels[pid]
          if (p) {
            const h = p.minimized ? 34 : p.height
            let cx = p.x
            let cy = p.y
            if (anchor === 'top') {
              cx = p.x + p.width / 2
              cy = p.y
            } else if (anchor === 'bottom') {
              cx = p.x + p.width / 2
              cy = p.y + h
            } else if (anchor === 'left') {
              cx = p.x
              cy = p.y + h / 2
            } else if (anchor === 'right') {
              cx = p.x + p.width
              cy = p.y + h / 2
            }
            circle.setAttribute('cx', String(cx))
            circle.setAttribute('cy', String(cy))
          }
        })

        // Find all relationship path elements in the DOM
        cachedRelPaths.forEach(path => {
          const srcId = path.getAttribute('data-source-panel-id')
          const tgtId = path.getAttribute('data-target-panel-id')
          if (!srcId || !tgtId) return

          // Only recalculate if one of the connected panels is being dragged
          const isSrcMoving = isMulti ? initial.has(srcId) : (srcId === panel.id)
          const isTgtMoving = isMulti ? initial.has(tgtId) : (tgtId === panel.id)
          if (!isSrcMoving && !isTgtMoving) return

          const src = currentPanels[srcId]
          const tgt = currentPanels[tgtId]
          if (src && tgt) {
            const sourceAnchor = path.getAttribute('data-source-anchor') || 'center'
            const targetAnchor = path.getAttribute('data-target-anchor') || 'center'
            const sourceEdgePos = parseFloat(path.getAttribute('data-source-edge-pos') || '0.5')
            const targetEdgePos = parseFloat(path.getAttribute('data-target-edge-pos') || '0.5')
            const curved = path.getAttribute('data-curved') === 'true'

            // Mock the annotation for the routing algorithm
            const tempAnnotation = {
              sourcePanelId: srcId,
              targetPanelId: tgtId,
              sourceAnchor,
              targetAnchor,
              sourceEdgePos,
              targetEdgePos,
            }

            const route = resolveConnectionRoute(tempAnnotation, currentPanels, true)
            const pathD = curved === false
              ? generateStraightPath(route)
              : generateSmoothPath(route, 0.22)

            path.setAttribute('d', pathD)

            // Update relationship label position if it exists
            const relId = path.getAttribute('data-relationship-id')
            const textEl = cachedRelLabels.get(relId || '')
            if (textEl) {
              const srcPt = getAnchorPoint(src, sourceAnchor, sourceEdgePos)
              const tgtPt = getAnchorPoint(tgt, targetAnchor, targetEdgePos)
              const midX = (srcPt.x + tgtPt.x) / 2
              const midY = (srcPt.y + tgtPt.y) / 2
              textEl.setAttribute('x', String(midX))
              textEl.setAttribute('y', String(midY - 8))
            }
          }
        })
        window.dispatchEvent(new CustomEvent('deck:panels-drag', { detail: currentPanels }))
      }

      if (isResizing) {
        // Resize updates the actual DOM size live (children need to reflow — terminal cols,
        // webview viewport). But we still write through React state via onResize/onMove.
        // We just commit-on-release path is shorter for resize too.
        const viewport = useWorkspaceStore.getState().viewport
        const dx = (e.clientX - resizeStart.x) / viewport.zoom
        const dy = (e.clientY - resizeStart.y) / viewport.zoom
        let { width, height, panelX: x, panelY: y } = resizeStart
        const dir = isResizing
        if (dir.includes('e')) width = Math.max(200, resizeStart.width + dx)
        if (dir.includes('w')) {
          width = Math.max(200, resizeStart.width - dx)
          x = resizeStart.panelX + (resizeStart.width - width)
        }
        if (dir.includes('s')) height = Math.max(110, resizeStart.height + dy)
        if (dir.includes('n')) {
          height = Math.max(110, resizeStart.height - dy)
          y = resizeStart.panelY + (resizeStart.height - height)
        }
        // Live DOM update for buttery feel — webview can still composite at its own rate.
        const el = panelRef.current
        if (el) {
          el.style.width = `${width}px`
          el.style.height = `${height}px`
          if (x !== resizeStart.panelX || y !== resizeStart.panelY) {
            el.style.left = `${x}px`
            el.style.top = `${y}px`
          }
        }
        // Commit on mouseup. flushSync forces React to re-render with the final size/pos
        // synchronously, which overwrites our inline style.* writes via React's own
        // style reconciliation.
        resizeCommit = () => {
          flushSync(() => {
            onResize(panel.id, width, height)
            if (x !== resizeStart.panelX || y !== resizeStart.panelY) onMove(panel.id, x, y)
          })
          // Region resize: clamp its children back inside the new bbox so shrinking
          // doesn't orphan them visually.
          if (panel.type === 'region') {
            useWorkspaceStore.getState().clampChildrenToRegion(panel.id)
          }
        }
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      pendingMove = e
      if (rafId !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const ev = pendingMove
        pendingMove = null
        if (ev) applyMove(ev)
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      // Drain any mousemove that was batched into rAF but didn't run yet, so the
      // dragCommit fires with cursor's true final position. Without this, releasing
      // fast snaps the panel back to wherever the last rAF tick happened — the jitter.
      const pending = pendingMove
      pendingMove = null
      if (pending) applyMove(pending)
      // Also process mouseup's own coords (covers the case where user nudged cursor
      // between last mousemove and release — mouseup carries the freshest position).
      applyMove(e)
      try { dragCommit?.() } catch { /* ignore */ }
      try { resizeCommit?.() } catch { /* ignore */ }
      dragCommit = null
      resizeCommit = null
      // Click-only on a multi-selected panel (no drag past threshold) → collapse selection
      // to single now. Dragging consumed the intent → keep multi.
      // If annotations are also selected, keep both selections — don't collapse.
      if (pendingCollapseToSingle.current && !dragMoved.current && !useWorkspaceStore.getState().selectedAnnotationIds.length) {
        useWorkspaceStore.getState().selectPanel(panel.id, false)
      }
      pendingCollapseToSingle.current = false
      setIsDragging(false)
      setIsResizing(null)
      initialPositions.current.clear()
      cachedHeaders.current = null
      setDragGuides([])
    }

    if (isDragging || isResizing) {
      document.body.classList.add('panel-interacting')
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.body.classList.remove('panel-interacting')
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        if (rafId) cancelAnimationFrame(rafId)
      }
    }
    // panel.x / panel.y are intentionally NOT in deps — we read them lazily via the
    // anchor positions snapshot (initialPositions) so changes mid-drag don't tear
    // the effect down. The single-drag branch falls back to current panel.x/y if no
    // anchor exists (first move before initialPositions populated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, isResizing, dragStart, resizeStart, panel.id, panel.width, panel.height, onMove, onResize, pushHistory, setDragGuides])

  // Esc is handled by the global cascade in App.tsx (blur note → focus panel outer → clear selection).
  // No per-key note handling needed; the textarea's onKeyDown stays at the wrapper level.

  const focusPanel = useCallback((additive: boolean) => {
    onSelect(panel.id, additive)
    if (panel.type !== 'region' && !panel.pinFront && !panel.pinBack) {
      const all = Object.values(useWorkspaceStore.getState().panels)
      const otherZs = all
        .filter(p => p.id !== panel.id && !p.pinFront && !p.pinBack)
        .map(p => p.zIndex || 1)
      const maxOtherZ = otherZs.length > 0 ? Math.max(...otherZs) : 1
      if (panel.zIndex === undefined || panel.zIndex <= maxOtherZ) {
        updatePanel(panel.id, { zIndex: maxOtherZ + 1 }, { skipHistory: true })
      }
    }
  }, [onSelect, panel.id, panel.type, panel.pinFront, panel.pinBack, panel.zIndex, updatePanel])

  const handleBodyMouseDown = useCallback((e: React.MouseEvent) => {
    focusPanel(e.shiftKey || e.ctrlKey || e.metaKey)
    e.stopPropagation()
  }, [focusPanel])

  const getPanelClass = () => {
    const classes = ['panel', `panel-type-${panel.type}`]
    if (isSelected) classes.push('selected')
    if (isDragging) classes.push('dragging')
    if (panel.locked) classes.push('locked')
    if (panel.minimized) classes.push('minimized')
    if (sanitizeColor(panel.color)) classes.push('has-color')
    if (panel.pinFront) classes.push('pin-front')
    if (panel.pinBack) classes.push('pin-back')
    if (panel.starred) classes.push('starred')
    if (headerActiveId === panel.id) classes.push('header-active')
    if (bodyActiveId === panel.id) classes.push('body-active')
    if (offscreen) classes.push('offscreen')
    if (panel.detached) classes.push('detached')
    if (stackDropTargetId === panel.id) classes.push('stack-drop-target')
    return classes.join(' ')
  }

  const regionCollapsed = panel.type === 'region' && (panel.settings as { collapsed?: boolean } | undefined)?.collapsed
  // Stack host bits — list of stacked child panels + the currently-active id.
  const isStackHost = !!(panel.stackChildren && panel.stackChildren.length > 0)
  const stackChildren = useWorkspaceStore(
    useCallback(
      s => {
        if (!isStackHost) return []
        return (panel.stackChildren || []).map(id => s.panels[id]).filter(Boolean)
      },
      [isStackHost, panel.stackChildren]
    ),
    (a, b) => {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
      }
      return true
    }
  )
  const stackOrder: PanelType[] = isStackHost ? [panel, ...stackChildren] : []
  const stackActiveId = isStackHost ? (panel.stackActive || panel.id) : panel.id
  const setStackActive = useWorkspaceStore(s => s.setStackActive)
  const unstackPanel = useWorkspaceStore(s => s.unstackPanel)
  const lazyLoad = (panel.settings as { lazyLoad?: boolean } | undefined)?.lazyLoad === true
  const loadSleepingPanel = () => {
    updatePanel(panel.id, { settings: { ...(panel.settings || {}), lazyLoad: false } }, { skipHistory: true })
  }

  const renderContent = () => {
    switch (panel.type) {
      case 'terminal':
        if (lazyLoad) return <SleepPlaceholder panel={panel} onLoad={loadSleepingPanel} />
        return (
          <div className="panel-content terminal-content" onMouseDown={handleBodyMouseDown}>
            <TerminalPanel panel={panel} />
          </div>
        )
      case 'editor':
        if (lazyLoad) return <SleepPlaceholder panel={panel} onLoad={loadSleepingPanel} />
        return (
          <div className="panel-content editor-content" onMouseDown={handleBodyMouseDown}>
            <EditorPanel panel={panel} />
          </div>
        )
      case 'browser':
        return <BrowserPanel panel={panel} />
      case 'region':
        if (lazyLoad) return <SleepPlaceholder panel={panel} onLoad={loadSleepingPanel} />
        return (
          <div className="panel-content region-content">
            <span className="region-children">{panel.children?.length || 0} {(panel.children?.length || 0) === 1 ? 'panel' : 'panels'}</span>
          </div>
        )
      default:
        return <div className="panel-content">Unknown panel type</div>
    }
  }

  const accent = sanitizeColor(panel.color)
  const borderColor = isSelected ? undefined : accent

  // 8-way resize for all panels including regions. Midpoint dots are rendered
  // via CSS pseudo-elements on the n/s/e/w handles when type === 'region'.
  const resizeDirs: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  // Embedded mode: rendered inside another panel's stack body. No chrome,
  // no positioning, no resize handles — just the inner content. Parent host
  // handles selection + drag.
  if (embedded) {
    return (
      <div className="panel-embedded" data-panel-id={panel.id} onMouseDown={(e) => { e.stopPropagation(); focusPanel(false) }}>
        {renderContent()}
      </div>
    )
  }

  return (
    <>
      <div
        ref={panelRef}
        className={getPanelClass()}
        style={{
          left: panel.x,
          top: panel.y,
          width: panel.width,
          height: panel.minimized || regionCollapsed ? 34 : panel.height,
          zIndex: panel.pinFront ? 9000 : panel.pinBack ? 0 : panel.zIndex,
          borderColor,
          ['--accent' as string]: accent || '',
          background: `color-mix(in srgb, var(--panel-bg, #2d2d30) ${(prefs.panelGlassOpacity ?? 0.85) * 100}%, transparent)`,
          backdropFilter: `blur(${prefs.panelGlassBlur ?? 12}px)`,
          WebkitBackdropFilter: `blur(${prefs.panelGlassBlur ?? 12}px)`
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        data-panel-id={panel.id}
        data-panel-type={panel.type}
        tabIndex={-1}
      >
        {accent && <div className="panel-accent-bar" style={{ background: accent }} />}
        <div
          className="panel-header"
          onDoubleClick={(e) => {
            e.stopPropagation()
            const action = prefs.panelHeaderDoubleClick || 'rename'
            if (action === 'rename') {
              beginRename()
            } else if (action === 'minimize') {
              updatePanel(panel.id, { minimized: !panel.minimized })
            } else if (action === 'focus') {
              useWorkspaceStore.getState().selectPanel(panel.id, false)
              executeWorkspaceCommand('focus-selected')
            }
          }}
        >
          <span className="panel-type-icon" aria-hidden>{TYPE_ICON[panel.type]}</span>
          {(panel.type === 'terminal' || panel.type === 'browser' || panel.type === 'editor') && panel.healthState && (
            <span
              className={`panel-health-dot health-${panel.healthState}`}
              title={healthTitle(panel.healthState)}
              onClick={(e) => {
                e.stopPropagation()
                if (panel.healthState === 'dead' || panel.healthState === 'crashed') {
                  window.dispatchEvent(new CustomEvent('deck:restart-panel', { detail: panel.id }))
                }
              }}
            />
          )}
          {panel.type === 'terminal' && (
            <div className="terminal-shell-switcher" ref={shellSwitcherRef}>
              {canSwitch ? (
                <button
                  className="shell-switcher-pill"
                  onClick={(e) => { e.stopPropagation(); setPillOpen(!pillOpen) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Switch terminal shell"
                >
                  <i className={pillIcon} />
                  <span>{displayLabel}</span>
                  <span className="pill-arrow">▼</span>
                </button>
              ) : (
                <div
                  className="shell-switcher-pill"
                  style={{ cursor: 'default' }}
                  title="Terminal shell"
                >
                  <i className={pillIcon} />
                  <span>{displayLabel}</span>
                </div>
              )}
              
              {canSwitch && pillOpen && (
                <div className="shell-dropdown-menu">
                  {isWin ? (
                    getShellOptions('win32').map(option => (
                      <button
                        key={option.type}
                        className={`shell-dropdown-item ${currentShellType === option.type ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectShell(option)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <i className={option.icon} />
                        <span>{option.label}</span>
                      </button>
                    ))
                  ) : (
                    recentShellPaths.map(path => {
                      const label = path.split(/[/\\]/).filter(Boolean).pop() || 'Terminal'
                      const activePath = (panel.settings?.shellPath as string) || (panel.settings?.resolvedShellPath as string) || prefs.defaultTerminalShell || ''
                      const isActive = path === activePath
                      return (
                        <button
                          key={path}
                          className={`shell-dropdown-item ${isActive ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectShell({
                              type: 'custom',
                              label,
                              icon: 'ti ti-terminal-2',
                              windowsOnly: false,
                              defaultPath: path,
                              pathHint: path
                            })
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          title={path}
                        >
                          <i className="ti ti-terminal-2" />
                          <span>{label}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )}
          {renaming ? (
            <input
              ref={titleInputRef}
              className="panel-title-input"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                else if (e.key === 'Escape') cancelRename()
              }}
            />
          ) : (
            <div className="panel-title-wrap">
              <span className="panel-title" title={panel.locked ? 'Locked — unlock to rename' : 'Double-click to rename'}>{panel.title}</span>
              {panel.description && <span className="panel-description">{panel.description}</span>}
            </div>
          )}
          {panel.starred && <span className="panel-locked-badge" title="Starred">★</span>}
          {panel.locked && <span className="panel-locked-badge" title="Locked">🔒</span>}
          <div className="panel-controls">
            {!panel.locked && (
              <button className="panel-control-btn" title="Rename" onClick={(e) => { e.stopPropagation(); beginRename() }} onMouseDown={(e) => e.stopPropagation()}>✎</button>
            )}
            {panel.type === 'region' && (
              <button
                className={`panel-control-btn ${regionCollapsed ? 'active' : ''}`}
                title={regionCollapsed ? 'Expand region' : 'Collapse region'}
                onClick={(e) => {
                  e.stopPropagation()
                  updatePanel(panel.id, { settings: { ...(panel.settings || {}), collapsed: !regionCollapsed } })
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >{regionCollapsed ? '▸' : '▾'}</button>
            )}
            <button
              className={`panel-control-btn ${panel.pinFront ? 'active pin' : ''}`}
              title={panel.pinFront ? 'Unpin from front' : 'Pin to front'}
              onClick={togglePinFront}
              onMouseDown={(e) => e.stopPropagation()}
            >📌</button>
            <button className={`panel-control-btn ${panel.locked ? 'active' : ''}`} title={panel.locked ? 'Unlock' : 'Lock'} onClick={toggleLocked} onMouseDown={(e) => e.stopPropagation()}>{panel.locked ? '⚿' : '⚷'}</button>
            <button className="panel-control-btn" title={panel.minimized ? 'Restore' : 'Minimize'} onClick={toggleMinimized} onMouseDown={(e) => e.stopPropagation()}>{panel.minimized ? '▢' : '▭'}</button>
            <button className="panel-control-btn danger" title="Close" onClick={handleClose} onMouseDown={(e) => e.stopPropagation()}>×</button>
          </div>
        </div>
        {isStackHost && !panel.minimized && (
          <div className="panel-stack-tabs">
            {stackOrder.map(p => (
              <StackTabButton
                key={p.id}
                hostId={panel.id}
                child={p}
                active={p.id === stackActiveId}
                isHostTab={p.id === panel.id}
                onActivate={() => setStackActive(panel.id, p.id)}
                onUnstack={() => unstackPanel(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  setCtxMenu({ x: e.clientX, y: e.clientY, targetPanel: p })
                }}
              />
            ))}
          </div>
        )}
        {!panel.minimized && !regionCollapsed && (
          <div className="panel-body" tabIndex={-1}>
            {isStackHost ? (
              <div className="panel-stack-body">
                {stackOrder.map(p => (
                  <div
                    key={p.id}
                    className={`stack-pane ${p.id === stackActiveId ? 'visible' : ''}`}
                  >
                    {p.id === panel.id ? (
                      renderContent()
                    ) : (
                      <Panel
                        panel={p}
                        isSelected={false}
                        embedded
                        onSelect={onSelect}
                        onMove={onMove}
                        onResize={onResize}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              renderContent()
            )}
          </div>
        )}
        {isSelected && !panel.minimized && !regionCollapsed && !panel.locked && resizeDirs.map(dir => (
          <div
            key={dir}
            className={`resize-handle resize-${dir}`}
            onMouseDown={handleResizeMouseDown(dir)}
          />
        ))}
        {pendingShell && (
          <ShellSwitchConfirmDialog
            fromShell={dynamicFromShell}
            toShell={pendingShell}
            onConfirm={() => {
              if (executeShellSwitch(pendingShell.type, pendingShell.pathHint)) {
                setPendingShell(null)
              }
            }}
            onCancel={() => {
              setPendingShell(null)
            }}
            onSkipFuture={() => {
              useWorkspaceStore.getState().updatePrefs({ skipShellSwitchConfirmation: true })
              if (executeShellSwitch(pendingShell.type, pendingShell.pathHint)) {
                setPendingShell(null)
              }
            }}
          />
        )}
      </div>
      {ctxMenu && (
        <PanelContextMenu
          panel={ctxMenu.targetPanel || panel}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onRename={() => {
            // Rename targets whichever panel the menu was opened for.
            const tid = (ctxMenu.targetPanel || panel).id
            useWorkspaceStore.getState().requestRename(tid)
          }}
        />
      )}
    </>
  )
}

interface StackTabBtnProps {
  hostId: string
  child: PanelType
  active: boolean
  isHostTab: boolean
  onActivate: () => void
  onUnstack: () => void
  onContextMenu: (e: React.MouseEvent) => void
}
// A tab in a stacked panel's strip. Click → switch active. Drag past threshold
// → unstack the panel AND let it follow the cursor until mouseup (user drops
// it wherever they want). Right-click → full panel ctx (which has snap-back
// unstack via "Unstack panel" item).
const StackTabButton: React.FC<StackTabBtnProps> = ({ child, active, isHostTab, onActivate, onUnstack, onContextMenu }) => {
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    let unstacked = false
    let moved = false
    let rafId = 0
    let pending: MouseEvent | null = null

    const apply = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) > 8) moved = true
      if (!moved) return
      if (!unstacked) {
        // Threshold crossed → unstack. The store places the panel beside the
        // host with its original size; we then immediately move it under the
        // cursor on subsequent ticks.
        onUnstack()
        unstacked = true
      }
      const s = useWorkspaceStore.getState()
      const p = s.panels[child.id]
      if (!p) return
      const container = document.querySelector('.canvas-container')
      const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 }
      const worldX = (ev.clientX - rect.left - s.viewport.x) / s.viewport.zoom
      const worldY = (ev.clientY - rect.top - s.viewport.y) / s.viewport.zoom
      // Anchor: cursor sits near the top-center of the panel (where the title is).
      s.movePanel(child.id, worldX - p.width / 2, worldY - 18)
    }

    const onMove = (ev: MouseEvent) => {
      pending = ev
      if (rafId !== 0) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        if (pending) apply(pending)
        pending = null
      })
    }
    const onUp = () => {
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!moved) onActivate()
      else if (unstacked) {
        // Select the freshly-dropped panel for immediate keyboard control.
        useWorkspaceStore.getState().selectPanel(child.id)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <button
      className={`stack-tab ${active ? 'active' : ''}`}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      title={`${child.title} — drag down to unstack, right-click for options`}
    >
      <span className="stack-tab-icon" aria-hidden>{TYPE_ICON[child.type]}</span>
      <span className="stack-tab-title">{child.title}</span>
      {!isHostTab && (
        <span
          className="stack-tab-close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onUnstack() }}
          title="Unstack this panel"
        >×</span>
      )}
    </button>
  )
}

export default React.memo(Panel)
