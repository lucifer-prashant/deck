import React, { useEffect } from 'react'
import AppCanvas from './components/Canvas'
import CommandPalette from './components/CommandPalette'
import PanelFinder from './components/PanelFinder'
import SettingsPane from './components/SettingsPane'
import WorkspaceChrome from './components/WorkspaceChrome'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import CodexPanel from './components/CodexPanel'
import EmptyState from './components/EmptyState'
import JumpOverlay from './components/JumpOverlay'
import PopoutWindow from './components/PopoutWindow'
import PanelSwitcher from './components/PanelSwitcher'
import WinTabSwitcher from './components/WinTabSwitcher'
import { WorkspaceWizard } from './components/WorkspaceWizard'
import { useWorkspaceStore } from './store/workspaceStore'
import { executeWorkspaceCommand, WorkspaceCommand } from './workspaceCommands'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import './App.css'

declare global {
  interface Window {
    __updateDynamicTheme?: (color: string) => void;
  }
}

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

  // Detect popout tab mode via URL query: ?popoutTab=<tabId>
  const popoutTabId = new URLSearchParams(window.location.search).get('popoutTab')

  return <MainAppShell popoutTabId={popoutTabId || undefined} />
}

function MainAppShell({ popoutTabId }: { popoutTabId?: string } = {}) {
  useKeyboardShortcuts()

  // Setup/cleanup for popout tab window
  useEffect(() => {
    if (!popoutTabId) return

    const store = useWorkspaceStore.getState()
    if (store.activeTabId !== popoutTabId) {
      store.switchTab(popoutTabId)
    }

    // Force activeTabId to remain locked to popoutTabId in this window
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (state.activeTabId !== popoutTabId) {
        useWorkspaceStore.getState().switchTab(popoutTabId)
      }
    })

    const flush = () => {
      const s = useWorkspaceStore.getState()
      const nextTabs = s.tabs.map(t => t.id === popoutTabId ? { ...t, detached: false } : t)
      useWorkspaceStore.setState({ tabs: nextTabs }, false)
      s.setTabDetached(popoutTabId, false)
    }
    const off = window.electronAPI?.window?.onPopoutFlush?.(flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      unsub()
      off?.()
      window.removeEventListener('beforeunload', flush)
    }
  }, [popoutTabId])

  const initialize = useWorkspaceStore(s => s.initialize)
  const commandPaletteOpen = useWorkspaceStore(s => s.commandPaletteOpen)
  const helpOpen = useWorkspaceStore(s => s.helpOpen)
  const chromeVisible = useWorkspaceStore(s => s.chromeVisible)
  const statusBarVisible = useWorkspaceStore(s => s.statusBarVisible)
  const toggleChrome = useWorkspaceStore(s => s.toggleChrome)
  const prefs = useWorkspaceStore(s => s.prefs)
  const sandboxRestoreViewport = useWorkspaceStore(s => s.sandboxRestoreViewport)
  const exitSandbox = useWorkspaceStore(s => s.exitSandbox)

  const updateAvailable = useWorkspaceStore(s => s.updateAvailable)
  const updateProgress = useWorkspaceStore(s => s.updateProgress)
  const updateStatus = useWorkspaceStore(s => s.updateStatus)
  const setUpdateAvailable = useWorkspaceStore(s => s.setUpdateAvailable)
  const setUpdateProgress = useWorkspaceStore(s => s.setUpdateProgress)
  const startUpdate = useWorkspaceStore(s => s.startUpdate)
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
            asset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.exe') && a.name.includes('Setup')) ||
                    data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.exe'))
          } else if (platform === 'linux') {
            asset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.AppImage')) ||
                    data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.deb')) ||
                    data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.rpm'))
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
      ;(window as unknown as { __flushWorkspaceBackup?: () => void }).__flushWorkspaceBackup?.()
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
      if (command === 'start-onboarding') {
        const s = useWorkspaceStore.getState()
        if (s.helpOpen) s.toggleHelp()
        if (s.settingsOpen) s.toggleSettings()
        s.updatePrefs({
          onboardingComplete: false,
          wizardStep: 0
        })
        return
      }
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
    const offD = window.electronAPI?.window?.onPanelDetached?.(async (panelId) => {
      useWorkspaceStore.getState().updatePanel(panelId, { detached: true }, { skipHistory: true })
    })
    const offR = window.electronAPI?.window?.onPanelRedocked?.(async (panelId) => {
      try {
        // Trigger a synchronous persist load so we see whatever they changed in the pop-out
        const persist = (useWorkspaceStore as any).persist
        if (persist?.rehydrate) await persist.rehydrate()
      } catch { /* ignore */ }
      useWorkspaceStore.getState().updatePanel(panelId, { detached: false }, { skipHistory: true })
    })

    // Sync tab.detached when popout windows open/close
    const offTabD = window.electronAPI?.window?.onTabDetached?.(async (tabId) => {
      useWorkspaceStore.getState().setTabDetached(tabId, true)
    })
    const offTabR = window.electronAPI?.window?.onTabRedocked?.(async (tabId) => {
      try {
        const persist = (useWorkspaceStore as any).persist
        if (persist?.rehydrate) await persist.rehydrate()
      } catch { /* ignore */ }
      useWorkspaceStore.getState().setTabDetached(tabId, false)
    })

    return () => { offD?.(); offR?.(); offTabD?.(); offTabR?.() }
  }, [])

  const isEmpty = useWorkspaceStore(s => {
    const tab = s.tabs.find(t => t.id === s.activeTabId)
    return Object.keys(s.panels).length === 0 && (!tab?.annotations || tab.annotations.length === 0)
  })

  const activeTab = useWorkspaceStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const isDetached = !!activeTab?.detached && popoutTabId !== activeTab.id

  return (
    <div className={`app ${chromeVisible ? 'has-chrome' : ''} ${statusBarVisible ? 'has-statusbar' : ''}`}>
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
      {popoutTabId && activeTab ? (
        chromeVisible && <PopoutHeader tabId={popoutTabId} title={activeTab.title} />
      ) : (
        chromeVisible && <WorkspaceChrome />
      )}
      {!chromeVisible && (
        <button
          className="chrome-peek"
          onClick={toggleChrome}
          title="Show top bar (Ctrl+\)"
        >▾</button>
      )}
      <StatusBarPeek />

      {!popoutTabId && <Sidebar />}
      {isDetached && activeTab ? (
        <DetachedOverlay tabId={activeTab.id} title={activeTab.title} />
      ) : (
        <AppCanvas />
      )}
      {isEmpty && <EmptyState />}
      <StatusBar />
      {commandPaletteOpen && <CommandPalette />}
      <PanelFinder />
      <SettingsPane />
      {helpOpen && <CodexPanel />}
      <JumpOverlay />
      <PanelSwitcher />
      <WinTabSwitcher />
      {!prefs.onboardingComplete && <WorkspaceWizard />}
      {sandboxRestoreViewport && (
        <div className="sandbox-banner">
          <span className="sandbox-banner-text">You are inside the Spatial Sandbox</span>
          <button className="sandbox-banner-btn" onClick={exitSandbox}>
            Return to Workspace
          </button>
        </div>
      )}
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

const PopoutHeader: React.FC<{ tabId: string; title: string }> = ({ tabId, title }) => {
  const redock = () => {
    window.electronAPI?.window?.redockTab(tabId)
  }

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 6000,
      width: 'min(1280px, calc(100vw - 20px))',
      height: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      border: '1px solid var(--chrome-border, rgba(255, 255, 255, 0.08))',
      borderRadius: 12,
      background: 'var(--chrome-bg, rgba(22, 24, 28, 0.78))',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.32), 0 1px 0 rgba(255,255,255,0.04) inset',
      backdropFilter: 'blur(12px) saturate(140%)',
      WebkitBackdropFilter: 'blur(12px) saturate(140%)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#fff'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>🖥️</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'rgba(255, 255, 255, 0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
          {title}
        </span>
        <span style={{
          fontSize: 10,
          background: 'rgba(77, 171, 232, 0.15)',
          color: '#4dabe8',
          border: '1px solid rgba(77, 171, 232, 0.3)',
          borderRadius: 4,
          padding: '1px 6px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap'
        }}>
          Detached Canvas
        </span>
      </div>
      
      <button
        onClick={redock}
        style={{
          background: 'rgba(77, 171, 232, 0.15)',
          color: '#4dabe8',
          border: '1px solid rgba(77, 171, 232, 0.3)',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s',
          fontFamily: 'system-ui, sans-serif'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = '#4dabe8'
          e.currentTarget.style.color = '#000'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'rgba(77, 171, 232, 0.15)'
          e.currentTarget.style.color = '#4dabe8'
        }}
      >
        ↩ Re-dock Tab
      </button>
    </div>
  )
}

const DetachedOverlay: React.FC<{ tabId: string; title: string }> = ({ tabId, title }) => {
  const redock = () => {
    window.electronAPI?.window?.redockTab(tabId)
  }

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(18, 18, 18, 0.45)',
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      zIndex: 900,
      textAlign: 'center',
      color: '#fff',
      padding: 24,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 12,
        padding: '32px 40px',
        maxWidth: 420,
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🖥️</div>
        <h2 style={{ margin: '0 0 12px 0', fontWeight: 600, fontSize: 20 }}>Canvas Detached</h2>
        <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.5 }}>
          The canvas for <strong>{title}</strong> is currently open in a separate window.
        </p>
        <button
          onClick={redock}
          style={{
            background: '#4dabe8',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.2s',
            boxShadow: '0 4px 12px rgba(77, 171, 232, 0.2)'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#64bdfc'}
          onMouseOut={(e) => e.currentTarget.style.background = '#4dabe8'}
        >
          ↩ Re-dock Tab
        </button>
      </div>
    </div>
  )
}

export default App
export { MainAppShell }
