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
import PanelSwitcher from './components/PanelSwitcher'
import WinTabSwitcher from './components/WinTabSwitcher'
import { useWorkspaceStore } from './store/workspaceStore'
import { executeWorkspaceCommand, WorkspaceCommand, fitItemsToViewport } from './workspaceCommands'
import './App.css'

declare global {
  interface Window {
    __updateDynamicTheme?: (color: string) => void;
  }
}

const JUMP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'super'])

export function serializeKeyEvent(e: KeyboardEvent): string {
  const key = e.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return ''

  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) {
    const isLetter = /^[a-z]$/.test(key)
    const isSpecial = key.length > 1
    if (isLetter || isSpecial) {
      parts.push('shift')
    }
  }
  if (e.metaKey) parts.push('meta')
  parts.push(key)
  return parts.join('+')
}

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
    toggleHelp,
    undo,
    redo,
    undoAnnotation,
    redoAnnotation,
    panels,
    tabs,
    activeTabId,
    toggleMinimap,
    setJumpMode,
    selectPanel,
    chromeVisible,
    toggleChrome,
    toggleAnnotateMode,
    togglePanelSwitcher,
    openWinTabSwitcher,
    prefs,
  } = useWorkspaceStore()

  const {
    updateAvailable,
    updateProgress,
    updateStatus,
    setUpdateAvailable,
    setUpdateProgress,
    startUpdate
  } = useWorkspaceStore()
  const [dismissedUpdate, setDismissedUpdate] = React.useState(false)

  // Check for updates on mount
  useEffect(() => {
    if (!window.electronAPI) return
    const checkForUpdates = async () => {
      try {
        const currentVersion = await window.electronAPI.getAppVersion()
        const response = await fetch(`https://api.github.com/repos/lucifer-prashant/deck/releases/latest?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, '') : ''
        
        if (latestVersion && latestVersion !== currentVersion) {
          const platform = await window.electronAPI.getPlatform()
          let asset = null
          if (platform === 'win32') {
            asset = data.assets.find((a: any) => a.name.endsWith('.exe') && a.name.includes('Setup')) ||
                    data.assets.find((a: any) => a.name.endsWith('.exe'))
          } else if (platform === 'linux') {
            asset = data.assets.find((a: any) => a.name.endsWith('.AppImage')) ||
                    data.assets.find((a: any) => a.name.endsWith('.deb')) ||
                    data.assets.find((a: any) => a.name.endsWith('.rpm'))
          }
          if (asset) {
            setUpdateAvailable({
              version: latestVersion,
              url: asset.browser_download_url,
              filename: asset.name
            })
          }
        }
      } catch (err) {
        console.error('Update check failed:', err)
      }
    }
    checkForUpdates()
  }, [setUpdateAvailable])

  // Listen for update download progress
  useEffect(() => {
    if (!window.electronAPI?.onUpdateProgress) return
    const unsub = window.electronAPI.onUpdateProgress((percent) => {
      setUpdateProgress(percent)
    })
    return () => unsub()
  }, [setUpdateProgress])

  useEffect(() => { initialize() }, [initialize])

  // Handle main-process "Save & Close" request: auto-save then force-close.
  useEffect(() => {
    const unsub = window.electronAPI?.appClose?.onSaveThenClose(() => {
      const s = useWorkspaceStore.getState()
      // Save all dirty tabs.
      s.tabs.forEach(t => {
        if (!t.lastEditedAt || t.lastEditedAt <= (t.lastSavedAt || 0)) return
        if (Object.keys(t.panels).length === 0) return
        if (t.kind === 'preset:life' || t.kind === 'preset:no-life') {
          s.saveBuiltinPreset(t.kind)
        } else if (t.linkedPresetId && s.canvasPresets[t.linkedPresetId]) {
          s.overwriteCanvasPreset(t.linkedPresetId)
        } else {
          // Normal tab: do not silently create a new preset. Just mark it clean.
          useWorkspaceStore.setState(state => ({
            tabs: state.tabs.map(tab => tab.id === t.id ? { ...tab, lastSavedAt: Date.now() } : tab)
          }))
        }
      })
      s.markTabSaved()
      ;(window as any).__flushWorkspaceBackup?.()
      window.electronAPI?.appClose?.forceClose()
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const getGridFallbacks = (isSystemLight: boolean) => ({
      none: isSystemLight ? '#f5f6f8' : '#1f2024',
      grid: isSystemLight ? '#f5f6f8' : '#1f2024',
      dot: isSystemLight ? '#f5f6f8' : '#1f2024',
      blueprint: '#182848',
      neon: '#0d0e15'
    })

    const updateDynamicTheme = (baseColor: string) => {
      const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches
      const color = baseColor || getGridFallbacks(isSystemLight)[useWorkspaceStore.getState().prefs.canvasGridStyle ?? 'none'] || (isSystemLight ? '#f5f6f8' : '#1f2024')
      
      if (color.toLowerCase() === '#1f2024' || color.toLowerCase() === '#0d1117') {
        const vars = [
          '--fg', '--fg-muted', '--panel-bg', '--panel-header-bg', '--panel-border',
          '--panel-title', '--chrome-bg', '--chrome-border', '--status-bg',
          '--selection-color', '--menu-bg', '--menu-fg', '--menu-border',
          '--menu-hover', '--btn-text', '--error-fg', '--error-border',
          '--modal-bg', '--modal-border', '--input-bg'
        ]
        const root = document.documentElement
        root.style.setProperty('--bg', color)
        vars.forEach(v => root.style.removeProperty(v))
        root.setAttribute('data-theme', 'midnight')
        return
      }

      const cleanHex = color.replace('#', '')
      let r = 31, g = 32, b = 36
      if (cleanHex.length === 6) {
        const num = parseInt(cleanHex, 16)
        r = (num >> 16) & 255
        g = (num >> 8) & 255
        b = num & 255
      } else if (cleanHex.length === 3) {
        r = parseInt(cleanHex[0] + cleanHex[0], 16)
        g = parseInt(cleanHex[1] + cleanHex[1], 16)
        b = parseInt(cleanHex[2] + cleanHex[2], 16)
      }

      const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
      const isLight = hsp > 155

      const root = document.documentElement
      root.style.setProperty('--bg', color)

      if (isLight) {
        root.style.setProperty('--fg', '#1a1d22')
        root.style.setProperty('--fg-muted', '#5b6470')
        root.style.setProperty('--panel-bg', 'rgba(255, 255, 255, 0.75)')
        root.style.setProperty('--panel-header-bg', 'rgba(238, 240, 243, 0.85)')
        root.style.setProperty('--panel-border', 'rgba(0, 0, 0, 0.12)')
        root.style.setProperty('--panel-title', '#1f2329')
        root.style.setProperty('--chrome-bg', 'rgba(248, 249, 251, 0.92)')
        root.style.setProperty('--chrome-border', 'rgba(0, 0, 0, 0.08)')
        root.style.setProperty('--status-bg', 'rgba(238, 240, 243, 0.92)')
        root.style.setProperty('--selection-color', '#2563eb')
        root.style.setProperty('--menu-bg', 'rgba(255, 255, 255, 0.98)')
        root.style.setProperty('--menu-fg', '#1a1d22')
        root.style.setProperty('--menu-border', 'rgba(0, 0, 0, 0.1)')
        root.style.setProperty('--menu-hover', 'rgba(37, 99, 235, 0.12)')
        root.style.setProperty('--btn-text', '#ffffff')
        root.style.setProperty('--error-fg', '#dc2626')
        root.style.setProperty('--error-border', 'rgba(220, 38, 38, 0.35)')
        root.style.setProperty('--modal-bg', 'rgba(255, 255, 255, 0.98)')
        root.style.setProperty('--modal-border', 'rgba(0, 0, 0, 0.08)')
        root.style.setProperty('--input-bg', '#ffffff')
        root.style.setProperty('--align-guide-color', '#ff3366')
        root.setAttribute('data-theme', 'light')
      } else {
        root.style.setProperty('--fg', '#e6e8ec')
        root.style.setProperty('--fg-muted', '#bfc4cb')
        
        const lighten = (c: number, amt: number) => Math.min(255, Math.floor(c + (255 - c) * amt))
        const pr = lighten(r, 0.08)
        const pg = lighten(g, 0.08)
        const pb = lighten(b, 0.08)
        root.style.setProperty('--panel-bg', `rgba(${pr}, ${pg}, ${pb}, 0.75)`)
         
        const phr = lighten(r, 0.14)
        const phg = lighten(g, 0.14)
        const phb = lighten(b, 0.14)
        root.style.setProperty('--panel-header-bg', `rgba(${phr}, ${phg}, ${phb}, 0.85)`)
        
        const maxVal = Math.max(r, g, b)
        const minVal = Math.min(r, g, b)
        const chroma = maxVal - minVal
        const isSaturated = chroma > 80

        const panelBorderOpacity = isSaturated ? 0.32 : 0.2
        const panelBorderLighten = isSaturated ? 0.28 : 0.2
        root.style.setProperty('--panel-border', `rgba(${lighten(r, panelBorderLighten)}, ${lighten(g, panelBorderLighten)}, ${lighten(b, panelBorderLighten)}, ${panelBorderOpacity})`)
        root.style.setProperty('--panel-title', '#d4d7dc')
        
        const cr = Math.max(0, r - 10)
        const cg = Math.max(0, g - 10)
        const cb = Math.max(0, b - 10)
        root.style.setProperty('--chrome-bg', `rgba(${cr}, ${cg}, ${cb}, 0.92)`)
        
        const chromeBorderOpacity = isSaturated ? 0.38 : 0.16
        const chromeBorderLighten = isSaturated ? 0.35 : 0.25
        root.style.setProperty('--chrome-border', `rgba(${lighten(r, chromeBorderLighten)}, ${lighten(g, chromeBorderLighten)}, ${lighten(b, chromeBorderLighten)}, ${chromeBorderOpacity})`)
        root.style.setProperty('--status-bg', `rgba(${Math.max(0, r - 15)}, ${Math.max(0, g - 15)}, ${Math.max(0, b - 15)}, 0.92)`)
        root.style.setProperty('--selection-color', '#4dabe8')
        root.style.setProperty('--menu-bg', `rgba(${cr}, ${cg}, ${cb}, 0.98)`)
        root.style.setProperty('--menu-fg', '#e6e8ec')
        root.style.setProperty('--menu-border', 'rgba(255, 255, 255, 0.12)')
        root.style.setProperty('--menu-hover', 'rgba(77, 171, 232, 0.22)')
        root.style.setProperty('--btn-text', '#000000')
        root.style.setProperty('--error-fg', '#ff8585')
        root.style.setProperty('--error-border', 'rgba(235, 94, 85, 0.3)')
        
        const mr = Math.floor(18 + r * 0.08)
        const mg = Math.floor(18 + g * 0.08)
        const mb = Math.floor(18 + b * 0.08)
        root.style.setProperty('--modal-bg', `rgba(${mr}, ${mg}, ${mb}, 0.98)`)
        root.style.setProperty('--modal-border', `rgba(${lighten(r, 0.25)}, ${lighten(g, 0.25)}, ${lighten(b, 0.25)}, 0.15)`)
        root.style.setProperty('--input-bg', 'rgba(0, 0, 0, 0.28)')
        root.style.setProperty('--align-guide-color', '#ff66cc')
        root.setAttribute('data-theme', 'dark')
      }
    }

    const baseColor = prefs.canvasBgColor || getGridFallbacks(mq.matches)[prefs.canvasGridStyle ?? 'none'] || (mq.matches ? '#f5f6f8' : '#1f2024')
    updateDynamicTheme(baseColor)

    const handler = () => {
      const freshColor = prefs.canvasBgColor || getGridFallbacks(mq.matches)[prefs.canvasGridStyle ?? 'none'] || (mq.matches ? '#f5f6f8' : '#1f2024')
      updateDynamicTheme(freshColor)
    }

    mq.addEventListener('change', handler)
    window.__updateDynamicTheme = updateDynamicTheme
    return () => {
      mq.removeEventListener('change', handler)
      delete window.__updateDynamicTheme
    }
  }, [prefs.canvasBgColor, prefs.canvasGridStyle])

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
              // No auto-pan. Press F to focus the new selection.
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
                executeWorkspaceCommand('focus-selected')
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
              trap(); executeWorkspaceCommand('new-browser'); return
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
              trap(); executeWorkspaceCommand('arrange-selected'); return
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
              trap(); executeWorkspaceCommand('new-terminal'); return
            case 'new-editor':
              trap(); executeWorkspaceCommand('new-editor'); return
            case 'new-region':
              trap(); executeWorkspaceCommand('new-region'); return
            case 'zoom-in':
              trap(); executeWorkspaceCommand('zoom-in'); return
            case 'zoom-out':
              trap(); executeWorkspaceCommand('zoom-out'); return
            case 'reset-viewport':
              trap(); executeWorkspaceCommand('reset-viewport'); return
            case 'fit-all':
              trap(); executeWorkspaceCommand('fit-all'); return
            case 'toggle-lock':
              trap(); executeWorkspaceCommand('toggle-lock'); return
            case 'toggle-minimize':
              trap(); executeWorkspaceCommand('toggle-minimize'); return
            case 'toggle-pin-front':
              trap(); executeWorkspaceCommand('toggle-pin-front'); return
            case 'bring-front':
              trap(); executeWorkspaceCommand('bring-front'); return
            case 'send-back':
              trap(); executeWorkspaceCommand('send-back'); return
          }
        }
      }
    }

    // Capture phase so xterm/webview can't swallow Escape via stopPropagation before us.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleCommandPalette, togglePanelFinder, toggleHelp, undo, redo, undoAnnotation, redoAnnotation, toggleMinimap, setJumpMode, selectPanel, toggleChrome, toggleAnnotateMode, togglePanelSwitcher, openWinTabSwitcher])

  useEffect(() => {
    const validCommands = new Set<WorkspaceCommand>([
      'new-terminal', 'new-editor', 'new-tab', 'new-browser', 'new-region',
      'clear-selection', 'clear-canvas', 'toggle-minimap',
      'select-all', 'duplicate-selected', 'fit-all', 'reset-viewport', 'zoom-in', 'zoom-out',
      'align-left', 'align-top', 'align-right', 'align-bottom',
      'distribute-horizontal', 'distribute-vertical',
      'group-region', 'ungroup-region',
      'rename-selected', 'toggle-lock', 'toggle-minimize', 'bring-front', 'send-back', 'toggle-pin-front', 'focus-selected',
      'toggle-help', 'arrange-selected'
    ])

    const removeListener = window.electronAPI?.onWorkspaceCommand?.((command) => {
      // toggle-help fires from the menu and must work even when focus is inside a panel.
      if (command === 'toggle-help') { executeWorkspaceCommand('toggle-help'); return }
      if (command === 'toggle-settings') { useWorkspaceStore.getState().toggleSettings(); return }
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

  const tab = tabs.find(t => t.id === activeTabId)
  const isEmpty = Object.keys(panels).length === 0 && (!tab?.annotations || tab.annotations.length === 0)

  return (
    <div className="app">
      {updateAvailable && !dismissedUpdate && (
        <div className="update-banner">
          <div className="update-banner-content">
            <span className="update-banner-text">
              🚀 A new version of Deck is available: <strong>v{updateAvailable.version}</strong>
              {updateStatus ? ` — ${updateStatus}` : ''}
              {updateProgress !== null && ` (${Math.round(updateProgress * 100)}%)`}
            </span>
            {updateProgress !== null && (
              <div className="update-banner-progress-bg">
                <div className="update-banner-progress-bar" style={{ width: `${updateProgress * 100}%` }} />
              </div>
            )}
            <div className="update-banner-actions">
              {!updateStatus && (
                <>
                  <button className="update-btn" onClick={startUpdate}>Update Now</button>
                  <button className="update-btn dismiss" onClick={() => setDismissedUpdate(true)}>Dismiss</button>
                </>
              )}
              {updateStatus.includes('Downloaded!') && (
                <button className="update-btn dismiss" onClick={() => setDismissedUpdate(true)}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}
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
      <PanelSwitcher />
      <WinTabSwitcher />
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
