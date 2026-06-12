import { useEffect } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { executeWorkspaceCommand, fitItemsToViewport, WorkspaceCommand } from '../workspaceCommands'
import { serializeKeyEvent } from '../App'

const JUMP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function useKeyboardShortcuts() {
  const toggleCommandPalette = useWorkspaceStore(s => s.toggleCommandPalette)
  const togglePanelFinder = useWorkspaceStore(s => s.togglePanelFinder)
  const toggleHelp = useWorkspaceStore(s => s.toggleHelp)
  const undo = useWorkspaceStore(s => s.undo)
  const redo = useWorkspaceStore(s => s.redo)
  const undoAnnotation = useWorkspaceStore(s => s.undoAnnotation)
  const redoAnnotation = useWorkspaceStore(s => s.redoAnnotation)
  const toggleMinimap = useWorkspaceStore(s => s.toggleMinimap)
  const setJumpMode = useWorkspaceStore(s => s.setJumpMode)
  const selectPanel = useWorkspaceStore(s => s.selectPanel)
  const toggleChrome = useWorkspaceStore(s => s.toggleChrome)
  const toggleAnnotateMode = useWorkspaceStore(s => s.toggleAnnotateMode)
  const togglePanelSwitcher = useWorkspaceStore(s => s.togglePanelSwitcher)
  const openWinTabSwitcher = useWorkspaceStore(s => s.openWinTabSwitcher)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const stateForOverlay = useWorkspaceStore.getState()
      const isOverlayOpen =
        stateForOverlay.settingsOpen ||
        stateForOverlay.commandPaletteOpen ||
        stateForOverlay.panelFinderOpen ||
        stateForOverlay.helpOpen ||
        stateForOverlay.globalSearchOpen ||
        stateForOverlay.winTabOpen ||
        stateForOverlay.panelSwitcherOpen
      if (isOverlayOpen) {
        return
      }

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
        target?.tagName?.toLowerCase() === 'webview' ||
        active?.tagName?.toLowerCase() === 'webview'

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

        // Nothing else to clear — clear annotation selection, or exit annotate mode.
        if (s.selectedAnnotationIds.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          s.clearAnnotationSelection()
          return
        }
        if (s.annotateMode) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          s.toggleAnnotateMode()
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

      // Zen Focus Toggles: Ctrl+\ and Ctrl+/
      const isCtrlSlash = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '/'
      const isCtrlBackslash = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '\\'
      
      if (isCtrlSlash || isCtrlBackslash) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        useWorkspaceStore.getState().toggleBars()
        return
      }

      // Viewport Bookmarks: Ctrl+Alt+[1-9] to Save, Alt+[1-9] to Load
      const numMatch = e.key.match(/^[1-9]$/)
      if (numMatch) {
        const num = parseInt(e.key, 10)
        if ((e.ctrlKey || e.metaKey) && e.altKey) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          useWorkspaceStore.getState().saveViewportBookmark(num)
          return
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          useWorkspaceStore.getState().loadViewportBookmark(num)
          return
        }
      }

      // Jump mode owns the keyboard while active.
      if (liveJump.active) {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          setJumpMode(false)
          return
        }
        if (e.key.length === 1) {
          const letter = e.key.toUpperCase()
          const pid = liveJump.letters[letter]
          if (pid) {
            e.preventDefault()
            const s = useWorkspaceStore.getState()
            const p = s.panels[pid]
            if (p) {
              selectPanel(pid)
              s.enterFocusMode()
              executeWorkspaceCommand('focus-selected')
            }
            setJumpMode(false)
            return
          }
        }
        // Block everything else while in jump mode.
        e.preventDefault()
        return
      }

      // Tab → enter jump mode (only when not typing, no modifier, items exist, and no switcher is open).
      const state = useWorkspaceStore.getState()
      if (!isTextInput && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
          !state.winTabOpen && !state.panelSwitcherOpen) {
        const panels = Object.values(state.panels).filter(p => p.type !== 'region')
          .sort((a, b) => a.y - b.y || a.x - b.x)

        if (panels.length > 0) {
          e.preventDefault()
          fitItemsToViewport(panels)
          const letters: Record<string, string> = {}
          panels.slice(0, JUMP_LETTERS.length).forEach((p, i) => {
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
      // Block when a switcher is open.
      const live = useWorkspaceStore.getState()
      if (live.panelSwitcherOpen || live.winTabOpen) {
        // Let the switcher handle all keys.
      } else if (!isTextInput && !isInsidePanelBody && e.altKey && !e.ctrlKey && !e.metaKey &&
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
      // Block when a switcher is open.
      if (live.panelSwitcherOpen || live.winTabOpen) {
        // Let the switcher handle all keys.
      } else if (!isTextInput && !isInsidePanelBody && (e.ctrlKey || e.metaKey) && !e.altKey &&
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
      // Block when a switcher is open.
      if (live.panelSwitcherOpen || live.winTabOpen) {
        // Let the switcher handle all keys.
      } else if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey &&
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
            }
            return
          }
        }
      }

      // Number 1-9 (no modifier) → switch to tab N. 1-6 in annotate mode → switch tool.
      if (!isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        const state = useWorkspaceStore.getState()
        if (state.annotateMode && idx < 5) {
          const tools = ['freehand', 'arrow', 'rectangle', 'highlight', 'eraser'] as const
          e.preventDefault()
          state.setAnnotateTool(tools[idx])
          return
        }
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
        if (activeTab?.kind === 'preset:life' || activeTab?.kind === 'preset:no-life') {
          s.saveBuiltinPreset(activeTab.kind)
        } else if (activeTab?.linkedPresetId && s.canvasPresets[activeTab.linkedPresetId]) {
          s.overwriteCanvasPreset(activeTab.linkedPresetId)
          s.markTabSaved()
        } else {
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

      // Dynamic Keybinding Routing
      const keyCombo = serializeKeyEvent(e)
      if (keyCombo) {
        const state = useWorkspaceStore.getState()
        const commandId = Object.entries(state.keybindings).find(([, combo]) => combo === keyCombo)?.[0]

        if (commandId) {
          const trap = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() }

          switch (commandId) {
            case 'toggle-help':
              trap(); toggleHelp(); return
            case 'rename-selected': {
              trap()
              const _sel = state.selectedPanelIds
              if (_sel.length === 1) state.requestRename(_sel[0])
              return
            }
            case 'focus-selected':
              if (state.selectedPanelIds.length > 0) {
                trap()
                state.enterFocusMode()
                executeWorkspaceCommand(commandId as WorkspaceCommand)
              }
              return
            case 'toggle-minimap':
              trap(); toggleMinimap(); return
            case 'toggle-annotate-mode':
              trap(); toggleAnnotateMode(); return
            case 'toggle-command-palette':
              trap(); toggleCommandPalette(); return
            case 'toggle-settings':
              trap(); state.toggleSettings(); return
            case 'toggle-panel-finder':
              trap(); togglePanelFinder(); return
            case 'toggle-sidebar': {
              trap()
              const willOpen = !state.sidebarOpen
              state.toggleSidebar()
              if (willOpen) state.setBarsVisible(false)
              else state.setBarsVisible(true)
              return
            }
            case 'new-browser':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'undo':
              trap()
              if (state.annotateMode && state.annotationPast.length > 0) state.undoAnnotation()
              else undo()
              return
            case 'redo':
              trap()
              if (state.annotateMode && state.annotationFuture.length > 0) state.redoAnnotation()
              else redo()
              return

            case 'toggle-bars':
              trap(); state.toggleBars(); return
            case 'load-preset-life':
              trap(); state.loadPreset('life'); return
            case 'load-preset-nolife':
              trap(); state.loadPreset('no-life'); return
            case 'arrange-selected':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'find-scratchpad':
              trap(); state.findOrCreateScratchpad(); return
            case 'open-wintab-switcher':
              if (!state.winTabOpen) {
                trap()
                openWinTabSwitcher()
              }
              return
            case 'toggle-panel-switcher':
              trap(); togglePanelSwitcher(); return
            case 'new-terminal':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'new-editor':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'new-region':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'zoom-in':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'zoom-out':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'reset-viewport':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'fit-all':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'toggle-lock':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'toggle-minimize':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'toggle-pin-front':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'bring-front':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
            case 'send-back':
              trap(); executeWorkspaceCommand(commandId as WorkspaceCommand); return
          }
        }
      }
    }

    // Capture phase so xterm/webview can't swallow Escape via stopPropagation before us.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleCommandPalette, togglePanelFinder, toggleHelp, undo, redo, undoAnnotation, redoAnnotation, toggleMinimap, setJumpMode, selectPanel, toggleChrome, toggleAnnotateMode, togglePanelSwitcher, openWinTabSwitcher])
}
