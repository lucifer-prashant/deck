import React, { useEffect } from 'react'
import AppCanvas from './components/Canvas'
import CommandPalette from './components/CommandPalette'
import PanelFinder from './components/PanelFinder'
import SettingsPane from './components/SettingsPane'
import WorkspaceChrome from './components/WorkspaceChrome'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import HelpOverlay from './components/HelpOverlay'
import EmptyState from './components/EmptyState'
import JumpOverlay from './components/JumpOverlay'
import PopoutWindow from './components/PopoutWindow'
import { useWorkspaceStore } from './store/workspaceStore'
import { executeWorkspaceCommand, WorkspaceCommand, fitPanelsToViewport } from './workspaceCommands'
import './App.css'

const JUMP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function App() {
  // Detect popout mode via URL query: ?popout=<panelId>
  const popoutId = new URLSearchParams(window.location.search).get('popout')
  if (popoutId) return <PopoutWindow panelId={popoutId} />

  return <MainAppShell />
}

function MainAppShell() {
  const {
    initialize,
    commandPaletteOpen,
    toggleCommandPalette,
    togglePanelFinder,
    toggleOutliner,
    toggleHelp,
    cycleTheme,
    undo,
    redo,
    theme,
    panels,
    selectedPanelIds,
    updatePanel,
    toggleMinimap,
    jumpMode,
    setJumpMode,
    selectPanel,
    setViewport,
    chromeVisible,
    toggleChrome
  } = useWorkspaceStore()

  useEffect(() => { initialize() }, [initialize])

  // Handle main-process "Save & Close" request: auto-save then force-close.
  useEffect(() => {
    const unsub = window.electronAPI?.appClose?.onSaveThenClose(() => {
      const s = useWorkspaceStore.getState()
      const activeTab = s.tabs.find(t => t.id === s.activeTabId)
      if (activeTab?.linkedPresetId && s.canvasPresets[activeTab.linkedPresetId]) {
        s.overwriteCanvasPreset(activeTab.linkedPresetId)
      } else if (activeTab && Object.keys(activeTab.panels).length > 0) {
        s.saveCanvasPreset(activeTab.title || 'Canvas')
      }
      s.markTabSaved()
      window.electronAPI?.appClose?.forceClose()
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    // 'system' = follow OS preference. Watch the media query and remap to
    // dark/light dynamically so user can switch OS theme and we follow.
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = () => document.documentElement.setAttribute('data-theme', mq.matches ? 'light' : 'dark')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Panel ring states are explicit store flags (not :focus-based, because webview/xterm
  // fight us for focus). headerActivePanelId → blue ring forced on. bodyActivePanelId
  // → ring suppressed (user is using the body). mousedown anywhere updates both.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const panelEl = t?.closest?.('.panel') as HTMLElement | null
      const s = useWorkspaceStore.getState()
      // Any click anywhere clears header-active (user moved on).
      if (s.headerActivePanelId) s.setHeaderActivePanel(null)
      if (!panelEl) {
        if (s.bodyActivePanelId) s.setBodyActivePanel(null)
        return
      }
      const inBody = !!(t?.closest?.('.panel-body')) || t?.tagName === 'WEBVIEW'
      const pid = panelEl.getAttribute('data-panel-id')
      if (inBody && pid) {
        if (s.bodyActivePanelId !== pid) s.setBodyActivePanel(pid)
      } else {
        if (s.bodyActivePanelId) s.setBodyActivePanel(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.isContentEditable === true
      // Focus is inside a panel body (note textarea, webview, future xterm/monaco).
      // Hand the keyboard completely to the embedded app — but regions don't have
      // an embedded app, their body is decorative, so canvas shortcuts (F/Del/etc.)
      // must still fire when a region's body has the active panel.
      const targetBody = target?.closest?.('.panel-body') as HTMLElement | null
      const activeBody = active?.closest?.('.panel-body') as HTMLElement | null
      const isRegionBody = (el: HTMLElement | null) =>
        !!el?.closest?.('.panel.panel-type-region')
      const isInsidePanelBody =
        (!!targetBody && !isRegionBody(targetBody)) ||
        (!!activeBody && !isRegionBody(activeBody)) ||
        target?.tagName === 'WEBVIEW' ||
        active?.tagName === 'WEBVIEW'

      // Read live state to avoid stale closure on rapid Tab→Esc sequences.
      const liveJump = useWorkspaceStore.getState().jumpMode

      // ---- Esc cascade (two presses max from anywhere in a panel) ----
      // 1. focus inside .panel-body (input/URL/webview/xterm/note/editor) → blur everything in body
      //    AND ensure that panel is selected (blue ring shows because no body focus remains).
      // 2. focus outside any panel body but a panel is selected → clear selection (no ring).
      if (e.key === 'Escape' && !liveJump.active) {
        const ae = document.activeElement as HTMLElement | null
        const s = useWorkspaceStore.getState()
        // Which panel is the user working in?
        //   1. DOM focus inside a panel.
        //   2. Otherwise the panel tracked as body-active (mousedown set it).
        let pid: string | null = null
        const panelFromFocus = ae?.closest?.('.panel') as HTMLElement | null
        if (panelFromFocus) pid = panelFromFocus.getAttribute('data-panel-id')
        if (!pid && s.bodyActivePanelId) pid = s.bodyActivePanelId

        const inBodyByFocus = !!(ae?.closest?.('.panel-body')) || ae?.tagName === 'WEBVIEW'
        const inBodyByFlag = !!s.bodyActivePanelId

        if (pid && (inBodyByFocus || inBodyByFlag)) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          try { (ae as HTMLElement | null)?.blur?.() } catch { /* ignore */ }
          if (ae?.tagName === 'WEBVIEW') {
            try { (ae as unknown as { blur?: () => void }).blur?.() } catch { /* ignore */ }
          }
          s.setBodyActivePanel(null)
          s.setHeaderActivePanel(pid)
          if (!s.selectedPanelIds.includes(pid)) s.selectPanel(pid)
          return
        }

        // No body context → clear header-active / selection.
        if (s.headerActivePanelId || s.selectedPanelIds.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          s.setHeaderActivePanel(null)
          if (s.selectedPanelIds.length > 0) s.clearSelection()
          return
        }
      }

      // ---- Enter on a single selected panel (header context) → focus into body ----
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !liveJump.active) {
        const ae = document.activeElement as HTMLElement | null
        const aeInBody = !!(ae?.closest?.('.panel-body')) || ae?.tagName === 'WEBVIEW'
        const aeIsInput =
          ae instanceof HTMLInputElement ||
          ae instanceof HTMLTextAreaElement ||
          ae?.isContentEditable === true
        if (!aeInBody && !aeIsInput) {
          const state = useWorkspaceStore.getState()
          if (state.selectedPanelIds.length === 1) {
            const pid = state.selectedPanelIds[0]
            const panelEl = document.querySelector(`.panel[data-panel-id="${pid}"]`) as HTMLElement | null
            const body = panelEl?.querySelector('.panel-body') as HTMLElement | null
            if (body) {
              const target =
                (body.querySelector('webview') as HTMLElement | null) ||
                (body.querySelector('.xterm-helper-textarea') as HTMLElement | null) ||
                (body.querySelector('.note-content') as HTMLElement | null) ||
                (body.querySelector('textarea, input, [contenteditable]') as HTMLElement | null)
              if (target) {
                e.preventDefault()
                target.focus()
                const s = useWorkspaceStore.getState()
                s.setHeaderActivePanel(null)
                s.setBodyActivePanel(pid)
                return
              }
            }
          }
        }
      }

      // Hard block: any text input OR embedded panel app owns the keyboard.
      // Nothing global fires while typing or while a webview/xterm/monaco has focus.
      if ((isTextInput || isInsidePanelBody) && !liveJump.active) {
        return
      }

      // Jump mode owns the keyboard while active.
      if (liveJump.active) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setJumpMode(false)
          return
        }
        if (e.key.length === 1) {
          const letter = e.key.toUpperCase()
          const pid = liveJump.letters[letter]
          if (pid) {
            e.preventDefault()
            const p = useWorkspaceStore.getState().panels[pid]
            if (p) {
              window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
              const zoom = 1
              setViewport({
                zoom,
                x: window.innerWidth / 2 - (p.x + p.width / 2) * zoom,
                y: window.innerHeight / 2 - (p.y + p.height / 2) * zoom
              })
              selectPanel(pid)
            }
            setJumpMode(false)
            return
          }
        }
        // Block everything else while in jump mode.
        e.preventDefault()
        return
      }

      // Tab → enter jump mode (only when not typing, no modifier, panels exist).
      if (!isTextInput && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const all = Object.values(useWorkspaceStore.getState().panels)
          .filter(p => p.type !== 'region')
          .sort((a, b) => a.y - b.y || a.x - b.x)
        if (all.length > 0) {
          e.preventDefault()
          // Fit first (smooth fly-out). Letters appear after transition settles
          // so they don't desync from panels animating into position.
          fitPanelsToViewport(all)
          const letters: Record<string, string> = {}
          all.slice(0, JUMP_LETTERS.length).forEach((p, i) => {
            letters[JUMP_LETTERS[i]] = p.id
          })
          window.setTimeout(() => {
            const stillThere = useWorkspaceStore.getState()
            if (!stillThere.jumpMode.active) setJumpMode(true, letters)
          }, 280)
          return
        }
      }

      // Alt+Arrow → resize selected panel(s). Alt+Shift+Arrow → shrink instead of grow.
      // Doesn't fire inside webview / textarea (browser keeps Alt+← / Alt+→ for back/forward).
      if (!isTextInput && !isInsidePanelBody && e.altKey && !e.ctrlKey && !e.metaKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const state = useWorkspaceStore.getState()
        const targets = state.selectedPanelIds.map(id => state.panels[id]).filter(Boolean)
        if (targets.length > 0) {
          e.preventDefault()
          const STEP = 20
          const sign = e.shiftKey ? -1 : 1
          targets.forEach(p => {
            let { x, y, width, height } = p
            if (e.key === 'ArrowRight') width += STEP * sign
            else if (e.key === 'ArrowLeft') { width += STEP * sign; x -= STEP * sign }
            else if (e.key === 'ArrowDown') height += STEP * sign
            else if (e.key === 'ArrowUp') { height += STEP * sign; y -= STEP * sign }
            const clampedW = Math.max(200, width)
            const clampedH = Math.max(110, height)
            // If width/height got clamped, undo the corresponding x/y shift so panel
            // doesn't drift sideways when already at minimum size.
            if (clampedW !== width && e.key === 'ArrowLeft') x = p.x
            if (clampedH !== height && e.key === 'ArrowUp') y = p.y
            state.resizePanel(p.id, clampedW, clampedH)
            if (x !== p.x || y !== p.y) state.movePanel(p.id, x, y)
          })
          return
        }
      }

      // Ctrl+Arrow → move selected panel(s); if no selection, pan viewport.
      if (!isTextInput && !isInsidePanelBody && (e.ctrlKey || e.metaKey) && !e.altKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const state = useWorkspaceStore.getState()
        const targets = state.selectedPanelIds.map(id => state.panels[id]).filter(Boolean)
        if (targets.length > 0) {
          const step = e.shiftKey ? 80 : 20
          let dx = 0, dy = 0
          if (e.key === 'ArrowRight') dx = step
          else if (e.key === 'ArrowLeft') dx = -step
          else if (e.key === 'ArrowDown') dy = step
          else if (e.key === 'ArrowUp') dy = -step
          targets.forEach(p => {
            const el = document.querySelector(`.panel[data-panel-id="${p.id}"]`) as HTMLElement | null
            if (el) {
              el.classList.add('kbd-moving')
              window.clearTimeout((el as unknown as { _kmt?: number })._kmt)
              ;(el as unknown as { _kmt?: number })._kmt = window.setTimeout(() => el.classList.remove('kbd-moving'), 160)
            }
            state.movePanel(p.id, p.x + dx, p.y + dy)
          })
        } else {
          const base = e.shiftKey ? 240 : 80
          let dx = 0, dy = 0
          if (e.key === 'ArrowRight') dx = -base
          else if (e.key === 'ArrowLeft') dx = base
          else if (e.key === 'ArrowDown') dy = -base
          else if (e.key === 'ArrowUp') dy = base
          window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
          state.setViewport({ x: state.viewport.x + dx, y: state.viewport.y + dy })
        }
        return
      }

      // Arrow-key spatial navigation: nearest panel in direction.
      if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const state = useWorkspaceStore.getState()
        if (state.selectedPanelIds.length === 1) {
          const current = state.panels[state.selectedPanelIds[0]]
          if (current) {
            e.preventDefault()
            const candidates = Object.values(state.panels).filter(p => p.id !== current.id && p.type !== 'region')
            const cx = current.x + current.width / 2
            const cy = current.y + current.height / 2
            type Scored = { p: typeof current; score: number }
            const dir = e.key
            const scored: Scored[] = []
            candidates.forEach(p => {
              const px = p.x + p.width / 2
              const py = p.y + p.height / 2
              const dx = px - cx
              const dy = py - cy
              let primary = 0, lateral = 0
              if (dir === 'ArrowRight') { primary = dx; lateral = Math.abs(dy) }
              else if (dir === 'ArrowLeft') { primary = -dx; lateral = Math.abs(dy) }
              else if (dir === 'ArrowDown') { primary = dy; lateral = Math.abs(dx) }
              else if (dir === 'ArrowUp') { primary = -dy; lateral = Math.abs(dx) }
              if (primary <= 0) return
              // Penalize lateral offset more than primary distance.
              scored.push({ p, score: primary + lateral * 1.8 })
            })
            if (scored.length > 0) {
              scored.sort((a, b) => a.score - b.score)
              selectPanel(scored[0].p.id)
              // No auto-pan. Press F to focus the new selection.
            }
            return
          }
        }
      }

      // Number 1-9 (no modifier) → switch to tab N.
      if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        const state = useWorkspaceStore.getState()
        if (state.tabs[idx]) {
          e.preventDefault()
          state.switchTab(state.tabs[idx].id)
          return
        }
      }

      // Ctrl+Alt+S → mark tab as saved (clears dirty dot). Avoids OS screenshot keybind.
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        useWorkspaceStore.getState().markTabSaved()
        return
      }

      // Ctrl+S on canvas (not inside panel body) → smart save canvas as preset.
      if (!isInsidePanelBody && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const s = useWorkspaceStore.getState()
        const activeTab = s.tabs.find(t => t.id === s.activeTabId)
        if (activeTab?.linkedPresetId && s.canvasPresets[activeTab.linkedPresetId]) {
          s.overwriteCanvasPreset(activeTab.linkedPresetId)
          s.markTabSaved()
        } else {
          // No linked preset — open the presets menu by dispatching a custom event
          // that StatusBar listens for.
          window.dispatchEvent(new CustomEvent('deck:open-presets-menu'))
        }
        return
      }

      // Home / End → first / last panel (sorted by reading order).
      if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Home' || e.key === 'End')) {
        const state = useWorkspaceStore.getState()
        const all = Object.values(state.panels)
          .filter(p => p.type !== 'region')
          .sort((a, b) => a.y - b.y || a.x - b.x)
        if (all.length > 0) {
          e.preventDefault()
          const target = e.key === 'Home' ? all[0] : all[all.length - 1]
          selectPanel(target.id)
          return
        }
      }

      // Help: ? or F1 (no modifier)
      if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '?' || e.key === 'F1') {
          e.preventDefault()
          toggleHelp()
          return
        }
        if (e.key === 'F2') {
          e.preventDefault()
          if (selectedPanelIds.length === 1) {
            useWorkspaceStore.getState().requestRename(selectedPanelIds[0])
          }
          return
        }
        if (e.key === 'f' || e.key === 'F') {
          if (selectedPanelIds.length > 0) {
            e.preventDefault()
            const state = useWorkspaceStore.getState()
            // Distraction-free: hide top bar + status bar + minimap on F focus.
            state.enterFocusMode()
            const selected = state.selectedPanelIds.map(id => state.panels[id]).filter(Boolean)
            const single = selected.length === 1 ? selected[0] : null
            const bigType = single && (single.type === 'browser' || single.type === 'editor')
            if (bigType && single) {
              // Near-fullscreen focus for browser/editor — tight 32px padding so the IDE/page
              // gets almost the entire screen.
              const padding = 32
              const zoom = Math.min(
                (window.innerWidth - padding * 2) / Math.max(single.width, 1),
                (window.innerHeight - padding * 2) / Math.max(single.height, 1)
              )
              window.dispatchEvent(new CustomEvent('wts-smooth-viewport'))
              state.setViewport({
                zoom,
                x: window.innerWidth / 2 - (single.x + single.width / 2) * zoom,
                y: window.innerHeight / 2 - (single.y + single.height / 2) * zoom
              })
            } else {
              executeWorkspaceCommand('focus-selected')
            }
            return
          }
        }
        if (e.key === 'm' || e.key === 'M') {
          e.preventDefault()
          toggleMinimap()
          return
        }
      }

      if (!(e.metaKey || e.ctrlKey) || e.altKey) return

      const k = e.key.toLowerCase()
      if (k === 'p') {
        e.preventDefault(); toggleCommandPalette()
      } else if (k === ',') {
        e.preventDefault()
        useWorkspaceStore.getState().toggleSettings()
      } else if (k === 'f') {
        e.preventDefault(); togglePanelFinder()
      } else if (k === 'b' && e.shiftKey) {
        e.preventDefault()
        const s = useWorkspaceStore.getState()
        // Hide chrome + status bar when sidebar opens (cleaner workspace). Restore them
        // when sidebar closes.
        const willOpen = !s.sidebarOpen
        s.toggleSidebar()
        if (willOpen) s.setBarsVisible(false)
        else s.setBarsVisible(true)
      } else if (k === 'b' && !e.shiftKey) {
        e.preventDefault(); executeWorkspaceCommand('new-browser')
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault(); undo()
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault(); redo()
      } else if (k === 't' && e.shiftKey) {
        e.preventDefault(); cycleTheme()
      } else if (k === '\\') {
        e.preventDefault(); useWorkspaceStore.getState().toggleBars()
      } else if (k === 'l' && e.shiftKey) {
        e.preventDefault(); useWorkspaceStore.getState().loadPreset('life')
      } else if (k === 'k' && e.shiftKey) {
        e.preventDefault(); useWorkspaceStore.getState().loadPreset('no-life')
      }
    }

    // Capture phase so xterm/webview can't swallow Escape via stopPropagation before us.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleCommandPalette, togglePanelFinder, toggleOutliner, toggleHelp, cycleTheme, undo, redo, panels, selectedPanelIds, updatePanel, toggleMinimap, jumpMode, setJumpMode, selectPanel, setViewport, toggleChrome])

  useEffect(() => {
    const validCommands = new Set<WorkspaceCommand>([
      'new-terminal', 'new-editor', 'new-note', 'new-tab', 'new-browser', 'new-region',
      'clear-selection', 'clear-canvas', 'toggle-minimap', 'toggle-snap',
      'select-all', 'duplicate-selected', 'fit-all', 'reset-viewport', 'zoom-in', 'zoom-out',
      'align-left', 'align-top', 'align-right', 'align-bottom',
      'distribute-horizontal', 'distribute-vertical',
      'group-region', 'ungroup-region',
      'rename-selected', 'toggle-lock', 'toggle-minimize', 'bring-front', 'send-back', 'toggle-pin-front', 'focus-selected'
    ])

    const removeListener = window.electronAPI?.onWorkspaceCommand?.((command) => {
      // Belt + suspenders: ignore IPC commands while typing OR while focus is in an embedded app.
      const active = document.activeElement as HTMLElement | null
      const isTextInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.isContentEditable === true
      const isInsidePanelBody = !!active?.closest?.('.panel-body') || active?.tagName === 'WEBVIEW'
      if (isTextInput || isInsidePanelBody) return
      if (validCommands.has(command as WorkspaceCommand)) {
        executeWorkspaceCommand(command as WorkspaceCommand)
      }
    })

    return () => removeListener?.()
  }, [])

  // Sync panel.detached when popout windows open/close in main process.
  useEffect(() => {
    const offD = window.electronAPI?.window?.onPanelDetached?.((panelId) => {
      useWorkspaceStore.getState().updatePanel(panelId, { detached: true }, { skipHistory: true })
    })
    const offR = window.electronAPI?.window?.onPanelRedocked?.(async (panelId) => {
      // Before re-rendering the panel on main canvas, pull in any updates the
      // pop-out window wrote to localStorage just before closing. Without this
      // step the storage event may arrive after we re-mount, so the panel
      // (browser url, note content, editor file path) renders with stale state.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const persist = (useWorkspaceStore as any).persist
        if (persist?.rehydrate) await persist.rehydrate()
      } catch { /* ignore */ }
      useWorkspaceStore.getState().updatePanel(panelId, { detached: false }, { skipHistory: true })
    })
    return () => { offD?.(); offR?.() }
  }, [])

  const isEmpty = Object.keys(panels).length === 0

  return (
    <div className="app">
      {chromeVisible && <WorkspaceChrome />}
      {!chromeVisible && (
        <button
          className="chrome-peek"
          onClick={toggleChrome}
          title="Show top bar (Ctrl+\)"
        >▾</button>
      )}
      <StatusBarPeek />

      <Sidebar />
      <AppCanvas />
      {isEmpty && <EmptyState />}
      <StatusBar />
      {commandPaletteOpen && <CommandPalette />}
      <PanelFinder />
      <SettingsPane />
      <HelpOverlay />
      <JumpOverlay />
    </div>
  )
}

// Symmetric to the top chrome-peek: tiny upward chevron at the bottom when the status
// bar is hidden, so the user can pop it back without remembering Ctrl+\.
const StatusBarPeek: React.FC = () => {
  const visible = useWorkspaceStore(s => s.statusBarVisible)
  const toggleStatusBar = useWorkspaceStore(s => s.toggleStatusBar)
  if (visible) return null
  return (
    <button
      className="chrome-peek bottom"
      onClick={toggleStatusBar}
      title="Show status bar (Ctrl+\)"
    >▴</button>
  )
}

export default App
export { MainAppShell }
