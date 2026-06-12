import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, protocol, net as electronNet } from 'electron'
import { join, basename, dirname, relative, normalize, isAbsolute } from 'path'
import { homedir } from 'os'
import { promises as fsp, existsSync, readFileSync, writeFileSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as pty from 'node-pty'
import * as crypto from 'crypto'
import * as http from 'http'
import { SHELL_CONFIGS, TerminalShellType } from '../src/types/terminalShells'

protocol.registerSchemesAsPrivileged([
  { scheme: 'deck-asset', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'local-file', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relation = relative(parentPath, childPath)
  return !!relation && !relation.startsWith('..') && !isAbsolute(relation)
}

// ─── Single Instance Lock ───────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ─── Window State Persistence ────────────────────────────────────────────────
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

const getWindowStatePath = () => join(app.getPath('userData'), 'window-state.json')

const loadWindowState = (): WindowState => {
  const defaultState = { width: 1400, height: 900 }
  try {
    const path = getWindowStatePath()
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      return { ...defaultState, ...data }
    }
  } catch { /* ignore */ }
  return defaultState
}

const saveWindowState = async (state: WindowState) => {
  try {
    await fsp.writeFile(getWindowStatePath(), JSON.stringify(state), 'utf8')
  } catch { /* ignore */ }
}

const debouncedSaveWindowState = debounce(saveWindowState, 500)


// ─── Platform helpers ────────────────────────────────────────────────────────
// IS_WIN / PATH_SEP are used throughout to gate Windows-specific behaviour.
// Every branch falls through to Linux/macOS behaviour by default so the app
// keeps working exactly as before on non-Windows platforms.
const IS_WIN = process.platform === 'win32'
const PATH_SEP = IS_WIN ? ';' : ':'

type PtySession = { proc: pty.IPty; panelId: string }
const ptys = new Map<string, PtySession>()
// Track which BrowserWindow owns each panel's pty so we send data only there.
const ptyOwners = new Map<string, BrowserWindow>()
// Store the initial cwd used when spawning each pty. On Windows we use this
// as a best-effort answer to pty:cwd (no /proc equivalent exists there).
const ptyCwds = new Map<string, string>()
// Per-pty scrollback ring buffer (raw ANSI bytes). New windows subscribing to
// an existing pty replay this buffer to populate their xterm with prior context.
const ptyBuffers = new Map<string, string>()
const PTY_BUFFER_CAP = 256 * 1024  // 256 KB per pty — generous, won't blow memory at typical use
const appendPtyBuffer = (panelId: string, data: string) => {
  const cur = ptyBuffers.get(panelId) || ''
  const next = (cur + data)
  if (next.length > PTY_BUFFER_CAP) {
    ptyBuffers.set(panelId, next.slice(next.length - PTY_BUFFER_CAP))
  } else {
    ptyBuffers.set(panelId, next)
  }
}

// On Linux, force-enable GPU rasterization instead of disabling HW accel entirely.
// Full disableHardwareAcceleration() kills xterm's WebGL renderer and makes terminals
// crawl. These switches keep acceleration on while bypassing the blocklist that
// triggers GPU crashes on some Intel/AMD setups.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
}

let mainWindow: BrowserWindow | null = null
// panelId → BrowserWindow for popped-out panels.
const popoutWindows = new Map<string, BrowserWindow>()
// tabId → BrowserWindow for popped-out tabs.
const popoutTabs = new Map<string, BrowserWindow>()

const allWindows = (): BrowserWindow[] => {
  const out: BrowserWindow[] = []
  if (mainWindow && !mainWindow.isDestroyed()) out.push(mainWindow)
  popoutWindows.forEach(w => { if (!w.isDestroyed()) out.push(w) })
  popoutTabs.forEach(w => { if (!w.isDestroyed()) out.push(w) })
  return out
}
const broadcast = (channel: string, payload: unknown) => {
  allWindows().forEach(w => { try { w.webContents.send(channel, payload) } catch { /* */ } })
}

const isDev = !app.isPackaged
const enableDevTools = isDev || process.env.DECK_DEVTOOLS === '1'

function buildMenu() {
  const send = (command: string) => {
    mainWindow?.webContents.send('workspace-command', command)
  }
  const zoom = (dir: 'in' | 'out' | 'reset') => {
    mainWindow?.webContents.send('canvas-zoom-command', dir)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Canvas',
      submenu: [
        { label: 'New Note',           accelerator: 'CmdOrCtrl+N',       click: () => send('new-note') },
        { label: 'New Terminal',       accelerator: 'CmdOrCtrl+T',       click: () => send('new-terminal') },
        { label: 'New Editor',         accelerator: 'CmdOrCtrl+E',       click: () => send('new-editor') },
        { label: 'New Browser',                                            click: () => send('new-browser') },
        { label: 'New Region',                                             click: () => send('new-region') },
        { type: 'separator' },
        { label: 'New Canvas Tab',     accelerator: 'CmdOrCtrl+Shift+N', click: () => send('new-tab') },
        { type: 'separator' },
        { label: 'Clear Canvas',                                           click: () => send('clear-canvas') },
        { type: 'separator' },
        { label: 'Quit',               accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { label: 'Duplicate Selected', accelerator: 'CmdOrCtrl+D', click: () => send('duplicate-selected') },
        { label: 'Select All',         accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
        { label: 'Clear Selection',                                 click: () => send('clear-selection') },
        { type: 'separator' },
        { label: 'Rename Selected',    accelerator: 'F2',          click: () => send('rename-selected') },
        { label: 'Toggle Lock',                                     click: () => send('toggle-lock') },
        { label: 'Toggle Minimize',                                 click: () => send('toggle-minimize') },
        { label: 'Pin to Front',                                    click: () => send('toggle-pin-front') },
        { label: 'Bring to Front',                                  click: () => send('bring-front') },
        { label: 'Send to Back',                                    click: () => send('send-back') },
        { type: 'separator' },
        { label: 'Preferences...',                                  accelerator: 'CmdOrCtrl+,', click: () => send('toggle-settings') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Fit All Panels',     accelerator: 'CmdOrCtrl+1',      click: () => send('fit-all') },
        { label: 'Reset Viewport',     accelerator: 'CmdOrCtrl+0',      click: () => send('reset-viewport') },
        { label: 'Focus Selected',                                       click: () => send('focus-selected') },
        { type: 'separator' },
        { label: 'Zoom In',            accelerator: 'CmdOrCtrl+=',      click: () => zoom('in') },
        { label: 'Zoom Out',           accelerator: 'CmdOrCtrl+-',      click: () => zoom('out') },
        { label: 'Reset Zoom',         accelerator: 'CmdOrCtrl+Alt+0',  click: () => zoom('reset') },
        { type: 'separator' },
        { label: 'Toggle Minimap',                                       click: () => send('toggle-minimap') },
        { type: 'separator' },
        { label: 'Reload',             accelerator: 'CmdOrCtrl+R',      role: 'reload' },
        { label: 'Toggle DevTools',    accelerator: 'F12',              role: 'toggleDevTools' },
        { label: 'Toggle Fullscreen',  accelerator: 'F11',              role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Arrange',
      submenu: [
        { label: 'Align Left',          click: () => send('align-left') },
        { label: 'Align Right',         click: () => send('align-right') },
        { label: 'Align Top',           click: () => send('align-top') },
        { label: 'Align Bottom',        click: () => send('align-bottom') },
        { type: 'separator' },
        { label: 'Distribute Horizontal', click: () => send('distribute-horizontal') },
        { label: 'Distribute Vertical',   click: () => send('distribute-vertical') },
        { type: 'separator' },
        { label: 'Group into Region',   accelerator: 'CmdOrCtrl+G',       click: () => send('group-region') },
        { label: 'Ungroup Region',      accelerator: 'CmdOrCtrl+Shift+G', click: () => send('ungroup-region') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Deck',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About Deck',
              message: `Deck v${app.getVersion()}`,
              detail: 'Spatial workspace for code — infinite canvas with terminals, editors, browsers, notes, git, and docking.\n\nGitHub: https://github.com/lucifer-prashant/deck\nContact: prashantverma1357@gmail.com',
              buttons: ['OK']
            })
          }
        },
        {
          label: 'Deck Codex Manual',
          accelerator: 'F1',
          click: () => send('toggle-help')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

buildMenu()

function createWindow() {
  const state = loadWindowState()
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#1f2024',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: enableDevTools,
      webviewTag: true
    },
    frame: true,
    title: 'Deck',
    icon: join(__dirname, '../build/icons/512x512.png')
  })

  if (state.isMaximized) {
    mainWindow.maximize()
  }

  const updateState = () => {
    if (!mainWindow) return
    try {
      const bounds = mainWindow.getBounds()
      const isMax = mainWindow.isMaximized()
      debouncedSaveWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: isMax
      })
    } catch { /* ignore */ }
  }

  mainWindow.on('resize', updateState)
  mainWindow.on('move', updateState)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Intercept native close button. Ask renderer if dirty, show native dialog.
  let forceClose = false
  mainWindow.on('close', async (e) => {
    if (forceClose) return  // already confirmed — let it through
    e.preventDefault()
    const win = mainWindow
    if (!win) return

    let isDirty = false
    try {
      isDirty = await win.webContents.executeJavaScript(
        'typeof window.__deck_isDirty === "function" ? window.__deck_isDirty() : false'
      )
    } catch { isDirty = false }

    if (!isDirty) {
      forceClose = true
      win.close()
      return
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Save & Close', "Close Anyway", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved Changes',
      message: 'You have unsaved changes.',
      detail: 'Save your canvas as a preset before closing?'
    })

    if (response === 0) {
      // Save — renderer saves then sends 'app:force-close' when done
      win.webContents.send('app:save-then-close')
    } else if (response === 1) {
      forceClose = true
      win.close()
    }
    // response === 2 (Cancel): do nothing, window stays open
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Forward touchpad pinch gesture to renderer
  mainWindow?.on('touchpad-pinch', (event, scale, velocity) => {
    // Prevent default page zoom
    event.preventDefault()
    // Access center coordinates from the event (Electron types may not include them)
    const anyEvent = event as any
    const centerX = anyEvent.centerX ?? 0
    const centerY = anyEvent.centerY ?? 0
    if (isDev) {
      console.log('Touchpad pinch event received:', { scale, velocity, centerX, centerY });
    }
    mainWindow?.webContents.send('touchpad-pinch', { scale, velocity, centerX, centerY })
  })
}

// Helper handlers for custom protocols
async function handleLocalFileRequest(req: Request): Promise<Response> {
  try {
    const referrer = req.referrer || req.headers.get('referer') || ''
    if (!referrer) {
      return new Response('Forbidden', { status: 403 })
    }
    const parsedRef = new URL(referrer)
    const isRefLocal = parsedRef.hostname === 'localhost' || parsedRef.hostname === '127.0.0.1' || parsedRef.protocol === 'file:' || parsedRef.protocol === 'local-file:'
    if (!isRefLocal) {
      return new Response('Forbidden', { status: 403 })
    }
    
    let filepath = decodeURIComponent(req.url.replace('local-file://', ''))
    if (process.platform === 'win32') {
      if (filepath.startsWith('/')) {
        filepath = filepath.slice(1)
      }
    } else {
      if (!filepath.startsWith('/')) {
        filepath = '/' + filepath
      }
    }
    return await electronNet.fetch(`file://${filepath}`)
  } catch {
    return new Response('', { status: 404 })
  }
}

async function handleDeckAssetRequest(req: Request): Promise<Response> {
  try {
    const filename = decodeURIComponent(req.url.replace('deck-asset://', ''))
    const assetsDir = join(app.getPath('userData'), 'assets')
    const filepath = join(assetsDir, filename)
    const normalized = normalize(filepath)
    
    if (!isPathInside(normalized, assetsDir)) {
      return new Response('Forbidden', { status: 403 })
    }
    
    return await electronNet.fetch(`file://${normalized}`)
  } catch {
    return new Response('', { status: 404 })
  }
}

// Spoof a vanilla Chrome user agent on every webview. WhatsApp Web, some Google flows,
// and a handful of other sites block Electron's default UA (which contains "Electron"
// and our app name). Use the correct platform string so sites don't serve wrong content.
const chromeVersion = process.versions.chrome
const CHROME_UA = IS_WIN
  ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  : `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`

// Wire permissions + downloads + zoom + window-open for every webview that gets created.
app.on('web-contents-created', (_evt, contents) => {
  if (contents.getType() !== 'webview') return
  const sess = contents.session
  try { contents.setUserAgent(CHROME_UA) } catch { /* ignore */ }
  try { sess.setUserAgent(CHROME_UA) } catch { /* ignore */ }

  // Register custom protocols on the custom webview session if not already registered.
  if (sess !== session.defaultSession) {
    try {
      sess.protocol.handle('local-file', handleLocalFileRequest)
    } catch { /* ignore */ }

    try {
      sess.protocol.handle('deck-asset', handleDeckAssetRequest)
    } catch { /* ignore */ }
  }

  // Permissions: allow everything common a normal browser would on local origins (localhost, 127.0.0.1, file:).
  // For external websites, restrict to safe defaults (clipboard-write, fullscreen, pointerLock, notifications).
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    try {
      const url = wc.getURL()
      const parsed = new URL(url)
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.protocol === 'file:'

      if (isLocal) {
        const storagePath = sess.getStoragePath()
        const isCodeServerSession = !!(storagePath && storagePath.includes('wts-code-server'))
        if (isCodeServerSession || permission === 'clipboard-write' || permission === 'fullscreen' || permission === 'pointerLock' || permission === 'notifications') {
          return callback(true)
        }
      }

      const allowedPermissions = ['clipboard-write', 'fullscreen', 'pointerLock', 'notifications']
      if (allowedPermissions.includes(permission)) {
        return callback(true)
      }
    } catch {
      // fallback to reject on error
    }
    callback(false)
  })
  sess.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    try {
      const origin = requestingOrigin || (wc ? wc.getURL() : '')
      if (!origin) return false
      const parsed = new URL(origin)
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.protocol === 'file:'

      if (isLocal) {
        const storagePath = sess.getStoragePath()
        const isCodeServerSession = !!(storagePath && storagePath.includes('wts-code-server'))
        if (isCodeServerSession || permission === 'clipboard-write' || permission === 'fullscreen' || permission === 'pointerLock' || permission === 'notifications') {
          return true
        }
      }

      const allowedPermissions = ['clipboard-write', 'fullscreen', 'pointerLock', 'notifications']
      return allowedPermissions.includes(permission)
    } catch {
      return false
    }
  })
  // Screen-share / window-pick (Discord call screen-share, Google Meet present, etc.)
  // needs an explicit handler since Electron 31+. We auto-pick the entire primary screen
  // — keeps Discord's start-screenshare flow one click without an OS picker.
  try {
    sess.setDisplayMediaRequestHandler((_req, callback) => {
      const parentWin = BrowserWindow.fromWebContents(contents) || mainWindow
      dialog.showMessageBox(parentWin!, {
        type: 'question',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        title: 'Screen Sharing Request',
        message: 'An application is requesting to share your screen. Do you want to allow screen sharing?',
        cancelId: 1
      }).then(({ response }) => {
        if (response !== 0) {
          callback({}) // Denied
          return
        }
        import('electron').then(({ desktopCapturer }) => {
          desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
            if (sources && sources.length > 0) {
              callback({ video: sources[0], audio: 'loopback' })
            } else {
              callback({})
            }
          }).catch(() => callback({}))
        }).catch(() => callback({}))
      })
    })
  } catch { /* older electron — falls back to default */ }

  // Downloads: prompt the user where to save, no auto-download, let Chromium handle the rest.
  sess.removeAllListeners('will-download')
  sess.on('will-download', async (event, item, webContents) => {
    item.pause()
    const filename = item.getFilename()
    const suggested = filename || 'download'
    const parentWin = BrowserWindow.fromWebContents(webContents) || mainWindow
    
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(parentWin!, {
        title: 'Save file',
        defaultPath: suggested
      })
      if (canceled || !filePath) {
        item.cancel()
        return
      }
      item.setSavePath(filePath)
      item.resume()
      
      item.once('done', (_done, state) => {
        if (state === 'completed') {
          const payload = { path: filePath, filename: basename(filePath) }
          parentWin?.webContents.send('download-finished', payload)
          if (parentWin !== mainWindow) {
            mainWindow?.webContents.send('download-finished', payload)
          }
        }
      })
    } catch {
      item.cancel()
    }
  })

  // Block embedded auto-opening external apps; we want user control.
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:|^about:blank$/i.test(url)) {
      shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
})

async function ensureOnboardingWelcomeFile() {
  const onboardingDir = join(app.getPath('userData'), 'onboarding')
  const welcomeFilePath = join(onboardingDir, 'WELCOME.md')

  try {
    if (!existsSync(onboardingDir)) {
      await fsp.mkdir(onboardingDir, { recursive: true })
    }

    if (!existsSync(welcomeFilePath)) {
      const welcomeContent = `# Welcome to Deck! 🚀

Welcome to your new spatial developer workspace. Here are a few tips to get you started:

### 🎯 Canvas Control Keys
* **Hold Middle-Click (or Space + Drag):** Pan around the infinite canvas.
* **Scroll Wheel (or Ctrl + / -):** Zoom in and out. Zoom follows your mouse cursor!
* **Ctrl + E:** Create a new code editor panel.
* **Double-Click Canvas:** Create your default terminal (configurable in Settings).

### 📦 Stacking & Decks
* **Docking:** Drag one panel's header on top of another panel's header to group them into tabs.
* **Unstacking:** Drag a tab out of the stack back onto the canvas.
* **Pop-out:** Click the pop-out button on a panel to detach it into a separate native window while maintaining its live running process.

### 📁 File Tree Drag & Drop
* Drag a **file** onto the canvas to open it in an editor.
* Drag a **folder** to spawn a terminal at that directory.
* Drag an **image or PDF** to create a specialized media card.

*For more tips and documentation, click the **Codex** icon in the status bar or press the **?** key.*
`
      await fsp.writeFile(welcomeFilePath, welcomeContent, 'utf8')
    }
  } catch (err) {
    console.error('Failed to create onboarding WELCOME.md file:', err)
  }
}

ipcMain.handle('fs:welcome-path', () => {
  return join(app.getPath('userData'), 'onboarding', 'WELCOME.md')
})

app.whenReady().then(async () => {
  await ensureOnboardingWelcomeFile()
  // Clear stale service workers for the code-server partition on every launch.
  // The Service Worker DB gets a stale LOCK file when the app exits ungracefully,
  // causing "Failed to delete the database: Database IO error" on next start and a
  // blank editor webview. Clearing service workers forces a fresh registration.
  try {
    await session.fromPartition('persist:wts-code-server').clearStorageData({ storages: ['serviceworkers', 'cookies'] })
  } catch { /* non-fatal */ }
  protocol.handle('deck-asset', handleDeckAssetRequest)
  protocol.handle('local-file', handleLocalFileRequest)
  // Set process icon for taskbar/app-switcher on Linux (BrowserWindow icon option
  // only affects the window chrome; app.setIcon covers the taskbar tile).
  if (process.platform === 'linux') {
    try {
      const { nativeImage } = await import('electron')
      const img = nativeImage.createFromPath(join(__dirname, '../build/icons/512x512.png'))
      if (!img.isEmpty()) app.setIcon(img)
    } catch { /* non-fatal — icon just won't show */ }

    // Clean up old AppImage if we recently updated
    if (process.env.APPIMAGE) {
      const oldPath = process.env.APPIMAGE + '.old'
      if (existsSync(oldPath)) {
        fsp.unlink(oldPath).catch(() => {})
      }
    }
  }
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported protocol' }
    }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('get-platform', () => {
  return process.platform
})

ipcMain.handle('get-webview-preload-path', () => {
  return join(__dirname, 'webview-preload.js')
})

ipcMain.handle('shell:detect-available', async () => {
  const available: Array<{ type: TerminalShellType; label: string; path: string }> = []

  if (IS_WIN) {
    // Windows shells
    available.push({ type: 'powershell', label: 'PowerShell', path: 'powershell.exe' })
    available.push({ type: 'cmd', label: 'Command Prompt', path: 'cmd.exe' })

    // Check WSL
    const wslPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32\\wsl.exe')
    if (existsSync(wslPath)) {
      available.push({ type: 'wsl', label: 'WSL', path: 'wsl.exe' })
    }

    // Check Git Bash using standard resolutions
    let gitBashPath: string | null = null
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      join(process.env.USERPROFILE || '', 'AppData\\Local\\Programs\\Git\\bin\\bash.exe'),
      join(process.env.USERPROFILE || '', 'AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe'),
    ]
    for (const p of gitBashPaths) {
      if (existsSync(p)) {
        gitBashPath = p
        break
      }
    }
    if (gitBashPath) {
      available.push({ type: 'gitbash', label: 'Git Bash', path: gitBashPath })
    }
  } else {
    // Unix shells (Linux/macOS)
    const commonShells = [
      { name: 'Zsh', path: '/bin/zsh' },
      { name: 'Zsh', path: '/usr/bin/zsh' },
      { name: 'Bash', path: '/bin/bash' },
      { name: 'Bash', path: '/usr/bin/bash' },
      { name: 'Fish', path: '/usr/bin/fish' },
      { name: 'Fish', path: '/bin/fish' },
      { name: 'Ksh', path: '/bin/ksh' },
      { name: 'Sh', path: '/bin/sh' },
    ]

    const checked = new Set<string>()

    // Add default $SHELL if it exists
    if (process.env.SHELL && existsSync(process.env.SHELL)) {
      const path = process.env.SHELL
      const name = path.split('/').pop() || 'Shell'
      const label = name.charAt(0).toUpperCase() + name.slice(1)
      available.push({ type: 'custom', label, path })
      checked.add(path)
    }

    for (const shell of commonShells) {
      if (!checked.has(shell.path) && existsSync(shell.path)) {
        available.push({ type: 'custom', label: shell.name, path: shell.path })
        checked.add(shell.path)
      }
    }
  }

  // Always append Custom Path fallback
  available.push({ type: 'custom', label: 'Custom Path...', path: '' })

  return available
})

function resolveShellPath(shellType: TerminalShellType | null, customPath: string): string {
  if (!shellType || shellType === 'custom') {
    return customPath || (IS_WIN ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash'))
  }

  // For gitbash, check if defaultPath exists (Windows only)
  if (shellType === 'gitbash' && IS_WIN) {
    const hint = SHELL_CONFIGS.gitbash.defaultPath
    if (hint && existsSync(hint)) {
      return hint
    }
    // Check other common paths for Git Bash
    const paths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      join(process.env.USERPROFILE || '', 'AppData\\Local\\Programs\\Git\\bin\\bash.exe'),
      join(process.env.USERPROFILE || '', 'AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\bin\\bash.exe'),
    ]
    for (const p of paths) {
      if (p && existsSync(p)) {
        return p
      }
    }
    // Fallback if not found
    return customPath || 'bash.exe'
  }

  const hint = SHELL_CONFIGS[shellType]?.defaultPath
  return hint || (IS_WIN ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash'))
}

// ---- pty ----
ipcMain.handle('pty:spawn', (e, args: { panelId: string; cwd?: string; cols?: number; rows?: number; shell?: string; shellType?: TerminalShellType; customPath?: string }) => {
  const { panelId } = args
  if (ptys.has(panelId)) {
    const ownerWin = BrowserWindow.fromWebContents(e.sender)
    if (ownerWin) ptyOwners.set(panelId, ownerWin)
    return { ok: true, panelId }
  }

  let shellType = args.shellType || null
  let customPath = args.customPath || ''

  if (!shellType && args.shell) {
    if (['powershell', 'cmd', 'wsl', 'gitbash', 'custom'].includes(args.shell)) {
      shellType = args.shell as TerminalShellType
    } else {
      shellType = 'custom'
      customPath = args.shell
    }
  }

  const shellPath = resolveShellPath(shellType, customPath)

  const cwd = args.cwd && args.cwd.length ? args.cwd : homedir()

  // Spawn args:
  //   Unix    — '-l' gives a login shell so ~/.bash_profile / ~/.zshrc load.
  //   Windows — no equivalent; cmd/powershell need no special args here.
  const shellArgs: string[] = IS_WIN ? [] : ['-l']

  // TERM / COLORTERM are Unix-only; injecting them on Windows causes issues
  // with cmd.exe and some PowerShell modules.
  const ptyEnv = IS_WIN
    ? { ...process.env }
    : { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }

  const proc = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: args.cols || 80,
    rows: args.rows || 24,
    cwd,
    env: ptyEnv
  })

  // Store initial cwd so pty:cwd can return it on Windows (no /proc there).
  ptyCwds.set(panelId, cwd)

  // Record which window owns this pty so data goes only there, not to all windows.
  const ownerWin = BrowserWindow.fromWebContents(e.sender)
  if (ownerWin) ptyOwners.set(panelId, ownerWin)
  const sendPtyData = (channel: string, payload: unknown) => {
    const owner = ptyOwners.get(panelId)
    if (owner && !owner.isDestroyed()) {
      try { owner.webContents.send(channel, payload) } catch { /* ignore */ }
    } else {
      broadcast(channel, payload)
    }
  }
  proc.onData(data => {
    appendPtyBuffer(panelId, data)
    sendPtyData('pty:data', { panelId, data })
  })
  proc.onExit(({ exitCode, signal }) => {
    sendPtyData('pty:exit', { panelId, exitCode, signal })
    ptys.delete(panelId)
    ptyBuffers.delete(panelId)
    ptyOwners.delete(panelId)
    ptyCwds.delete(panelId)
  })
  ptys.set(panelId, { proc, panelId })
  return { ok: true, panelId, pid: proc.pid, cwd, shell: shellPath }
})

ipcMain.handle('pty:scrollback', (_e, panelId: string) => {
  return { ok: true, data: ptyBuffers.get(panelId) || '' }
})

ipcMain.on('pty:input', (_e, args: { panelId: string; data: string }) => {
  ptys.get(args.panelId)?.proc.write(args.data)
})

ipcMain.on('pty:resize', (_e, args: { panelId: string; cols: number; rows: number }) => {
  const s = ptys.get(args.panelId)
  if (!s) return
  try { s.proc.resize(Math.max(1, args.cols), Math.max(1, args.rows)) } catch { /* ignore */ }
})

ipcMain.on('pty:kill', (_e, args: { panelId: string }) => {
  const s = ptys.get(args.panelId)
  if (!s) return
  try { s.proc.kill() } catch { /* ignore */ }
  ptys.delete(args.panelId)
})

// Windows CWD Tracking using a persistent background PowerShell process
// that compiles a C# PEB reader to query ReadProcessMemory asynchronously.
let winCwdPowerShell: ChildProcess | null = null
let winCwdPromiseQueue: Array<{ resolve: (val: string | null) => void }> = []

function initWinCwdPowerShell() {
  if (winCwdPowerShell) return

  winCwdPowerShell = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', '-'
  ], {
    stdio: ['pipe', 'pipe', 'ignore']
  })

  const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ProcessProperties {
    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, ref PROCESS_BASIC_INFORMATION processInformation, int processInformationLength, out int returnLength);
    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(int dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll")]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int dwSize, out int lpNumberOfBytesRead);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_BASIC_INFORMATION {
        public IntPtr ExitStatus;
        public IntPtr PebBaseAddress;
        public IntPtr AffinityMask;
        public IntPtr BasePriority;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }
    public static string GetCwd(int pid) {
        IntPtr hProcess = OpenProcess(0x1010, false, pid);
        if (hProcess == IntPtr.Zero) return null;
        try {
            PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();
            int temp;
            int status = NtQueryInformationProcess(hProcess, 0, ref pbi, Marshal.SizeOf(pbi), out temp);
            if (status != 0) return null;
            byte[] peb = new byte[64];
            if (!ReadProcessMemory(hProcess, pbi.PebBaseAddress, peb, peb.Length, out temp)) return null;
            int is64 = IntPtr.Size;
            int procParamsOffset = is64 == 8 ? 0x20 : 0x10;
            IntPtr procParamsAddr = (IntPtr)BitConverter.ToInt64(peb, procParamsOffset);
            byte[] procParams = new byte[256];
            if (!ReadProcessMemory(hProcess, procParamsAddr, procParams, procParams.Length, out temp)) return null;
            int cwdOffset = is64 == 8 ? 0x38 : 0x24;
            long cwdBufferAddr = BitConverter.ToInt64(procParams, cwdOffset + 8);
            int cwdLength = BitConverter.ToInt16(procParams, cwdOffset);
            byte[] cwdBytes = new byte[cwdLength];
            if (!ReadProcessMemory(hProcess, (IntPtr)cwdBufferAddr, cwdBytes, cwdBytes.Length, out temp)) return null;
            return Encoding.Unicode.GetString(cwdBytes);
        } catch {
            return null;
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@
Add-Type -TypeDefinition $code

function Get-LeafPid($parentPid) {
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $parentPid" | Select-Object -ExpandProperty ProcessId
        if ($null -eq $children -or $children.Count -eq 0) {
            return $parentPid
        }
        $latestChild = $children | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum
        if ($null -eq $latestChild) {
            return $parentPid
        }
        return Get-LeafPid $latestChild
    } catch {
        return $parentPid
    }
}

while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    $pidVal = 0
    if ([int]::TryParse($line, [ref]$pidVal)) {
        $leafPid = Get-LeafPid $pidVal
        $cwd = [ProcessProperties]::GetCwd($leafPid)
        if ($null -eq $cwd) {
            [Console]::WriteLine("ERROR")
        } else {
            [Console]::WriteLine($cwd)
        }
    } else {
        [Console]::WriteLine("ERROR")
    }
}
`
  winCwdPowerShell.stdin.write(psScript + "\n")

  let buffer = ''
  winCwdPowerShell.stdout.on('data', (data: Buffer) => {
    buffer += data.toString()
    let newlineIdx = buffer.indexOf('\n')
    while (newlineIdx !== -1) {
      const line = buffer.substring(0, newlineIdx).trim()
      buffer = buffer.substring(newlineIdx + 1)
      const nextPromise = winCwdPromiseQueue.shift()
      if (nextPromise) {
        if (line === 'ERROR' || line === 'INVALID') {
          nextPromise.resolve(null)
        } else {
          nextPromise.resolve(line)
        }
      }
      newlineIdx = buffer.indexOf('\n')
    }
  })

  winCwdPowerShell.on('exit', () => {
    winCwdPowerShell = null
    const pending = winCwdPromiseQueue
    winCwdPromiseQueue = []
    pending.forEach(p => p.resolve(null))
  })
}

function queryWinCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve(null)
      return
    }
    try {
      initWinCwdPowerShell()
      if (!winCwdPowerShell || !winCwdPowerShell.stdin) {
        resolve(null)
        return
      }
      winCwdPromiseQueue.push({ resolve })
      winCwdPowerShell.stdin.write(pid.toString() + "\n")
    } catch {
      resolve(null)
    }
  })
}

// Linux/macOS leaf child PID resolution
async function getLeafPidUnix(parentPid: number): Promise<number> {
  try {
    const files = await fsp.readdir('/proc')
    const pids = files.filter(f => /^\d+$/.test(f)).map(Number)

    const statResults = await Promise.all(
      pids.map(async (pid) => {
        try {
          const statStr = await fsp.readFile(`/proc/${pid}/stat`, 'utf8')
          const lastParen = statStr.lastIndexOf(')')
          if (lastParen === -1) return null
          const rest = statStr.substring(lastParen + 2).trim().split(/\s+/)
          const ppid = Number(rest[1]) // PPID is the second field after the command name
          return { pid, ppid }
        } catch {
          return null
        }
      })
    )

    const parentToChildren: Record<number, number[]> = {}
    for (const res of statResults) {
      if (res) {
        if (!parentToChildren[res.ppid]) parentToChildren[res.ppid] = []
        parentToChildren[res.ppid].push(res.pid)
      }
    }

    let currentPid = parentPid
    while (true) {
      const children = parentToChildren[currentPid]
      if (!children || children.length === 0) {
        break
      }
      currentPid = Math.max(...children)
    }

    return currentPid
  } catch {
    return parentPid
  }
}

// Read the current working directory of a pty's foreground process.
//
// Linux:   walk process tree to find deepest child, read /proc/<leaf>/cwd
// Windows: query persistent PowerShell process reading PEB memory of leaf process
ipcMain.handle('pty:cwd', async (_e, panelId: string) => {
  const s = ptys.get(panelId)
  if (!s) return { ok: false, error: 'no pty' }
  if (IS_WIN) {
    const cwd = await queryWinCwd(s.proc.pid)
    if (cwd) {
      ptyCwds.set(panelId, cwd)
      return { ok: true, cwd }
    }
    const fallback = ptyCwds.get(panelId)
    return fallback ? { ok: true, cwd: fallback } : { ok: false, error: 'cwd unknown' }
  }
  try {
    const leafPid = await getLeafPidUnix(s.proc.pid)
    const cwd = await fsp.readlink(`/proc/${leafPid}/cwd`)
    return { ok: true, cwd }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('app:force-close', () => {
  mainWindow?.destroy()
})

app.on('before-quit', () => {
  ptys.forEach(s => { try { s.proc.kill() } catch { /* ignore */ } })
  ptys.clear()
})

// ---- file IO for editor ----
ipcMain.handle('file:read', async (_e, filePath: string) => {
  try {
    const data = await fsp.readFile(filePath, 'utf8')
    const stat = await fsp.stat(filePath)
    return { ok: true, content: data, path: filePath, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('file:write', async (_e, args: { path: string; content: string }) => {
  try {
    await fsp.writeFile(args.path, args.content, 'utf8')
    const stat = await fsp.stat(args.path)
    return { ok: true, path: args.path, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('file:open-dialog', async (_e, defaultDir?: string) => {
  if (!mainWindow) return { ok: false, error: 'no window' }
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: defaultDir || homedir()
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
  return { ok: true, path: res.filePaths[0] }
})

ipcMain.handle('file:save-dialog', async (_e, args: { suggestedName?: string; defaultDir?: string }) => {
  if (!mainWindow) return { ok: false, error: 'no window' }
  const defaultPath = args.defaultDir
    ? join(args.defaultDir, args.suggestedName || 'untitled.txt')
    : join(homedir(), args.suggestedName || 'untitled.txt')
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  return { ok: true, path: res.filePath }
})

ipcMain.handle('file:dirname', (_e, p: string) => dirname(p))
ipcMain.handle('file:basename', (_e, p: string) => basename(p))

// ---- fs explorer ----
ipcMain.handle('fs:list-dir', async (_e, dirPath: string) => {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const out = entries.map(d => ({
      name: d.name,
      path: join(dirPath, d.name),
      isDir: d.isDirectory(),
      isSymlink: d.isSymbolicLink()
    }))
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    return { ok: true, entries: out }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('fs:walk-up', async (_e, args: { start: string; markers: string[] }) => {
  let cur = args.start
  // Bail when we hit the filesystem root.
  for (let i = 0; i < 64; i++) {
    for (const marker of args.markers) {
      try {
        await fsp.access(join(cur, marker))
        return { ok: true, found: cur, marker }
      } catch { /* not here */ }
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return { ok: true, found: null }
})

ipcMain.handle('fs:home', () => homedir())

ipcMain.handle('fs:write-asset', async (_e, args: { data: string; filename?: string }) => {
  try {
    const assetsDir = join(app.getPath('userData'), 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })
    const ext = args.filename ? '.' + (args.filename.split('.').pop() || 'png') : 'png'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filepath = join(assetsDir, name)
    const buffer = Buffer.from(args.data, 'base64')
    await fsp.writeFile(filepath, buffer)
    return { ok: true, filename: name, path: filepath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('fs:asset-dir', () => join(app.getPath('userData'), 'assets'))

ipcMain.handle('fs:import-as-asset', async (_e, filepath: string) => {
  try {
    const assetsDir = join(app.getPath('userData'), 'assets')
    await fsp.mkdir(assetsDir, { recursive: true })
    const ext = filepath.split('.').pop() || 'png'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const dest = join(assetsDir, name)
    await fsp.copyFile(filepath, dest)
    return { ok: true, filename: name, path: dest }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

// ---- git status ----
const runGit = (cwd: string, args: string[], timeoutMs = 5000, stdin?: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> =>
  new Promise(resolve => {
    const proc = spawn('git', args, { cwd, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    if (stdin && proc.stdin) {
      proc.stdin.write(stdin)
      proc.stdin.end()
    }
    const t = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, timeoutMs)
    proc.on('close', code => {
      clearTimeout(t)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
    proc.on('error', () => {
      clearTimeout(t)
      resolve({ ok: false, stdout, stderr, code: null })
    })
  })

interface GitFile { path: string; staged: string; unstaged: string }
interface GitWorktree { path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }

ipcMain.handle('git:stage', async (_e, args: { repoRoot: string; paths: string[] }) => {
  if (!args.repoRoot || !args.paths?.length) return { ok: false, error: 'missing args' }
  const r = await runGit(args.repoRoot, ['add', '--', ...args.paths])
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:unstage', async (_e, args: { repoRoot: string; paths: string[] }) => {
  if (!args.repoRoot || !args.paths?.length) return { ok: false, error: 'missing args' }
  const r = await runGit(args.repoRoot, ['restore', '--staged', '--', ...args.paths])
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:commit', async (_e, args: { repoRoot: string; message: string; amend?: boolean }) => {
  if (!args.repoRoot || !args.message?.trim()) return { ok: false, error: 'missing args' }
  const gitArgs = ['commit', '-m', args.message]
  if (args.amend) gitArgs.push('--amend')
  const r = await runGit(args.repoRoot, gitArgs, 15000)
  return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()) }
})

// ---- fs mutations for explorer right-click actions ----
ipcMain.handle('fs:rename', async (_e, args: { from: string; to: string }) => {
  try { await fsp.rename(args.from, args.to); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('fs:delete', async (_e, path: string) => {
  try { await fsp.rm(path, { recursive: true, force: true }); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('fs:mkdir', async (_e, path: string) => {
  try { await fsp.mkdir(path, { recursive: false }); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('fs:touch', async (_e, path: string) => {
  try {
    const fh = await fsp.open(path, 'wx')
    await fh.close()
    return { ok: true }
  } catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('shell:reveal', async (_e, path: string) => {
  try { shell.showItemInFolder(path); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('shell:trash', async (_e, path: string) => {
  try { await shell.trashItem(path); return { ok: true } }
  catch (err) { return { ok: false, error: (err as Error).message } }
})
ipcMain.handle('fs:search-paths', async (_e, args: { root: string; query: string }) => {
  const results: string[] = []
  const q = args.query.toLowerCase()
  if (!args.root || !q) return { ok: true, results }
  const visited = new Set<string>()
  const MAX_DEPTH = 20

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env.example') continue
        if (entry.name === 'node_modules' || entry.name === '.git') continue

        const fullPath = join(dir, entry.name)
        if (entry.name.toLowerCase().includes(q)) {
          results.push(fullPath)
        }
        if (results.length >= 1000) return

        if (entry.isDirectory()) {
          let real: string
          try {
            real = await fsp.realpath(fullPath)
          } catch {
            real = fullPath
          }
          if (!visited.has(real)) {
            visited.add(real)
            await walk(fullPath, depth + 1)
          }
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const rootReal = await fsp.realpath(args.root)
    visited.add(rootReal)
  } catch {
    visited.add(args.root)
  }

  await walk(args.root, 0)
  return { ok: true, results }
})

// ---- ripgrep / grep wrapper for global search ----
const hasRg = (() => {
  // Use PATH_SEP so this works on both Windows (';') and Unix (':').
  const rgBin = IS_WIN ? 'rg.exe' : 'rg'
  const paths = (process.env.PATH || '').split(PATH_SEP)
  for (const dir of paths) {
    if (existsSync(join(dir, rgBin))) return true
  }
  return false
})()

ipcMain.handle('search:files', async (_e, args: { root: string; query: string; maxResults?: number }) => {
  const q = args.query?.trim()
  const root = args.root
  const cap = args.maxResults || 200
  if (!q || !root) return { ok: true, results: [] }

  return new Promise<{ ok: boolean; results: Array<{ file: string; line: number; text: string }>; tool: string }>(resolve => {
    const results: Array<{ file: string; line: number; text: string }> = []

    // Tool selection:
    //   rg (ripgrep)  — fast, cross-platform; preferred when installed.
    //   grep          — Unix fallback.
    //   findstr       — Windows built-in fallback (slower, less capable than grep).
    const cmd = hasRg ? (IS_WIN ? 'rg.exe' : 'rg') : (IS_WIN ? 'findstr' : 'grep')

    const cmdArgs = hasRg
      ? ['--line-number', '--no-heading', '--color=never', '--max-count=20', '--max-filesize=2M', '-S', '--', q, root]
      : IS_WIN
        // findstr: /s=recursive, /n=line numbers, /i=case-insensitive, /p=skip binary
        ? ['/s', '/n', '/i', '/p', q, join(root, '*')]
        : ['-rn', '-I', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=.next', '--', q, root]

    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    const timeout = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 15000)
    proc.stdout.on('data', d => {
      buf += d.toString()
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (results.length >= cap) {
          try { proc.kill() } catch { /* */ }
          break
        }
        // rg / grep format: <file>:<line>:<text>
        // findstr format:   <file>:<line>:<text>  (same, conveniently)
        const m = line.match(/^([^:]+):(\d+):(.*)$/)
        if (m) results.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] })
      }
    })
    proc.on('close', () => { clearTimeout(timeout); resolve({ ok: true, results, tool: cmd }) })
    proc.on('error', () => { clearTimeout(timeout); resolve({ ok: false, results: [], tool: cmd }) })
  })
})

// ---- multi-window pop-out ----
const createPopoutWindow = (panelId: string) => {
  if (popoutWindows.has(panelId)) {
    const existing = popoutWindows.get(panelId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }
  }
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 400,
    minHeight: 300,
    show: false,
    backgroundColor: '#1f2024',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: enableDevTools,
      webviewTag: true
    },
    title: 'Deck — Panel',
    icon: join(__dirname, '../build/icons/512x512.png')
  })
  const query = `?popout=${encodeURIComponent(panelId)}`
  if (isDev) win.loadURL('http://localhost:5173/' + query)
  else win.loadFile(join(__dirname, '../dist/index.html'), { search: query.slice(1) })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    popoutWindows.delete(panelId)
    // Notify all remaining windows so canvas re-shows the panel.
    broadcast('panel:redocked', { panelId })
  })
  popoutWindows.set(panelId, win)
  return win
}

ipcMain.handle('window:popout-panel', async (_e, panelId: string) => {
  if (!panelId) return { ok: false, error: 'no panelId' }
  createPopoutWindow(panelId)
  broadcast('panel:detached', { panelId })
  return { ok: true }
})

ipcMain.handle('window:redock-panel', async (_e, panelId: string) => {
  const w = popoutWindows.get(panelId)
  if (w && !w.isDestroyed()) {
    // Ask the pop-out renderer to flush any pending state writes to localStorage
    // before we destroy the window. Main window's rehydrate-on-redock relies on
    // these writes being visible.
    try {
      w.webContents.send('popout:flush')
      await new Promise(res => setTimeout(res, 80))  // small grace period
    } catch { /* ignore */ }
    w.close()
  }
  return { ok: true }
})

const createPopoutTabWindow = (tabId: string) => {
  if (popoutTabs.has(tabId)) {
    const existing = popoutTabs.get(tabId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    show: false,
    backgroundColor: '#1f2024',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: enableDevTools,
      webviewTag: true
    },
    title: 'Deck — Canvas',
    icon: join(__dirname, '../build/icons/512x512.png')
  })
  const query = `?popoutTab=${encodeURIComponent(tabId)}`
  if (isDev) win.loadURL('http://localhost:5173/' + query)
  else win.loadFile(join(__dirname, '../dist/index.html'), { search: query.slice(1) })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    popoutTabs.delete(tabId)
    // Notify all remaining windows so canvas re-shows/redocks.
    broadcast('tab:redocked', { tabId })
  })
  popoutTabs.set(tabId, win)
  return win
}

ipcMain.handle('window:popout-tab', async (_e, tabId: string) => {
  if (!tabId) return { ok: false, error: 'no tabId' }
  createPopoutTabWindow(tabId)
  broadcast('tab:detached', { tabId })
  return { ok: true }
})

ipcMain.handle('window:redock-tab', async (_e, tabId: string) => {
  const w = popoutTabs.get(tabId)
  if (w && !w.isDestroyed()) {
    try {
      w.webContents.send('popout:flush')
      await new Promise(res => setTimeout(res, 80))  // grace period
    } catch { /* ignore */ }
    w.close()
  }
  return { ok: true }
})

ipcMain.handle('window:is-popout', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return { popout: false }
  for (const [panelId, w] of popoutWindows.entries()) {
    if (w === win) return { popout: true, panelId }
  }
  for (const [tabId, w] of popoutTabs.entries()) {
    if (w === win) return { popout: true, tabId }
  }
  return { popout: false }
})

ipcMain.handle('git:worktree-add', async (_e, args: { repoRoot: string; path: string; branch: string; newBranch?: boolean }) => {
  if (!args.repoRoot || !args.path || !args.branch) return { ok: false, error: 'missing args' }
  const gitArgs = ['worktree', 'add']
  if (args.newBranch) gitArgs.push('-b', args.branch, args.path)
  else gitArgs.push(args.path, args.branch)
  const r = await runGit(args.repoRoot, gitArgs, 30000)
  return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()) }
})

ipcMain.handle('git:worktree-remove', async (_e, args: { repoRoot: string; path: string; force?: boolean }) => {
  if (!args.repoRoot || !args.path) return { ok: false, error: 'missing args' }
  const gitArgs = ['worktree', 'remove']
  if (args.force) gitArgs.push('--force')
  gitArgs.push(args.path)
  const r = await runGit(args.repoRoot, gitArgs, 10000)
  return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()) }
})

ipcMain.handle('git:branches', async (_e, repoRoot: string) => {
  if (!repoRoot) return { ok: false, error: 'no repoRoot' }
  const r = await runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
  if (!r.ok) return { ok: false, error: r.stderr.trim() }
  const branches = r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  return { ok: true, branches }
})

ipcMain.handle('git:pick-worktree-dir', async (_e, defaultDir?: string) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return { ok: false, canceled: true }
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose worktree location',
    defaultPath: defaultDir,
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
  return { ok: true, path: res.filePaths[0] }
})

ipcMain.handle('git:fetch', async (_e, repoRoot: string) => {
  mainWindow?.setProgressBar(2)
  try {
    const r = await runGit(repoRoot, ['fetch', '--all', '--prune'], 30000)
    return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
  } finally {
    mainWindow?.setProgressBar(-1)
  }
})

ipcMain.handle('git:pull', async (_e, repoRoot: string) => {
  mainWindow?.setProgressBar(2)
  try {
    const r = await runGit(repoRoot, ['pull', '--ff-only'], 60000)
    return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()), output: r.stdout.trim() }
  } finally {
    mainWindow?.setProgressBar(-1)
  }
})

ipcMain.handle('git:push', async (_e, args: { repoRoot: string; setUpstream?: boolean }) => {
  mainWindow?.setProgressBar(2)
  try {
    const gitArgs = args.setUpstream
      ? ['push', '-u', 'origin', 'HEAD']
      : ['push']
    const r = await runGit(args.repoRoot, gitArgs, 60000)
    return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()), output: r.stdout.trim() }
  } finally {
    mainWindow?.setProgressBar(-1)
  }
})

ipcMain.handle('git:checkout', async (_e, args: { repoRoot: string; branch: string; create?: boolean }) => {
  const gitArgs = args.create ? ['checkout', '-b', args.branch] : ['checkout', args.branch]
  const r = await runGit(args.repoRoot, gitArgs, 15000)
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:diff', async (_e, args: { repoRoot: string; path?: string; staged?: boolean }) => {
  const gitArgs = ['diff', '--no-color']
  if (args.staged) gitArgs.push('--cached')
  if (args.path) gitArgs.push('--', args.path)
  const r = await runGit(args.repoRoot, gitArgs, 15000)
  return { ok: r.ok, diff: r.stdout, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:log', async (_e, args: { repoRoot: string; limit?: number }) => {
  const lim = args.limit || 100
  const r = await runGit(args.repoRoot, ['log', '--graph', `--max-count=${lim}`, '--pretty=format:%h%x1f%an%x1f%ar%x1f%s%x1f%d'], 10000)
  if (!r.ok) return { ok: false, error: r.stderr.trim() }
  const lines = r.stdout.split('\n')
  const commits = lines.map(line => {
    const parts = line.split('\x1f')
    if (parts.length < 5) {
      return { isGraphOnly: true, graph: line }
    }
    const graphAndHash = parts[0]
    const lastSpaceIdx = graphAndHash.lastIndexOf(' ')
    const hash = graphAndHash.slice(lastSpaceIdx + 1).trim()
    const graph = graphAndHash.slice(0, lastSpaceIdx + 1)
    
    return {
      isGraphOnly: false,
      graph,
      sha: hash,
      author: parts[1],
      date: parts[2],
      subject: parts[3],
      refs: (parts[4] || '').trim()
    }
  })
  return { ok: true, commits }
})

ipcMain.handle('git:apply-patch', async (_e, args: { repoRoot: string; patch: string; reverse?: boolean }) => {
  if (!args.repoRoot || !args.patch) return { ok: false, error: 'missing args' }
  const gitArgs = ['apply', '--cached']
  if (args.reverse) {
    gitArgs.push('--reverse')
  }
  gitArgs.push('-')
  const r = await runGit(args.repoRoot, gitArgs, 5000, args.patch)
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:blame', async (_e, args: { repoRoot: string; path: string }) => {
  if (!args.repoRoot || !args.path) return { ok: false, error: 'missing args' }
  const r = await runGit(args.repoRoot, ['blame', '--porcelain', args.path], 10000)
  if (!r.ok) return { ok: false, error: r.stderr.trim() }
  
  const lines = r.stdout.split('\n')
  const commits: Record<string, { author: string; summary: string; date: string }> = {}
  const result: Record<number, { commit: string; author: string; summary: string; date: string }> = {}
  
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line) {
      i++
      continue
    }
    
    const parts = line.split(' ')
    if (parts.length >= 3 && parts[0].length === 40) {
      const sha = parts[0]
      const finalLine = parseInt(parts[2], 10)
      
      if (!commits[sha]) {
        commits[sha] = { author: 'Unknown', summary: 'No commit message', date: '' }
        i++
        while (i < lines.length) {
          const sub = lines[i]
          if (sub.startsWith('\t')) {
            break
          }
          if (sub.startsWith('author ')) {
            commits[sha].author = sub.slice(7)
          } else if (sub.startsWith('author-time ')) {
            const epoch = parseInt(sub.slice(12), 10)
            if (!isNaN(epoch)) {
              commits[sha].date = new Date(epoch * 1000).toLocaleDateString()
            }
          } else if (sub.startsWith('summary ')) {
            commits[sha].summary = sub.slice(8)
          }
          i++
        }
      } else {
        i++
        while (i < lines.length && !lines[i].startsWith('\t')) {
          i++
        }
      }
      result[finalLine] = {
        commit: sha.slice(0, 8),
        author: commits[sha].author,
        summary: commits[sha].summary,
        date: commits[sha].date
      }
    } else {
      i++
    }
  }
  return { ok: true, blame: result }
})

ipcMain.handle('git:show', async (_e, args: { repoRoot: string; sha: string }) => {
  if (!args.repoRoot || !args.sha) return { ok: false, error: 'missing args' }
  const r = await runGit(args.repoRoot, ['show', '--no-color', '--stat', '-p', args.sha], 15000)
  return { ok: r.ok, stdout: r.stdout, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:stash-list', async (_e, repoRoot: string) => {
  const r = await runGit(repoRoot, ['stash', 'list', '--pretty=format:%gd%x1f%s'])
  if (!r.ok) return { ok: false, error: r.stderr.trim() }
  const stashes = r.stdout.split('\n').filter(Boolean).map(line => {
    const [ref, message] = line.split('\x1f')
    return { ref, message }
  })
  return { ok: true, stashes }
})

ipcMain.handle('git:stash-save', async (_e, args: { repoRoot: string; message?: string }) => {
  const gitArgs = ['stash', 'push']
  if (args.message?.trim()) { gitArgs.push('-m', args.message.trim()) }
  const r = await runGit(args.repoRoot, gitArgs)
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:stash-pop', async (_e, args: { repoRoot: string; ref: string }) => {
  const r = await runGit(args.repoRoot, ['stash', 'pop', args.ref])
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:stash-drop', async (_e, args: { repoRoot: string; ref: string }) => {
  const r = await runGit(args.repoRoot, ['stash', 'drop', args.ref])
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:status', async (_e, repoRoot: string) => {
  if (!repoRoot) return { ok: false, error: 'no repoRoot' }
  const [branchRes, upstreamRes, statusRes, worktreeRes] = await Promise.all([
    runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']),
    runGit(repoRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    runGit(repoRoot, ['status', '--porcelain=v1', '--ignored']),
    runGit(repoRoot, ['worktree', 'list', '--porcelain'])
  ])

  const branch = branchRes.ok ? branchRes.stdout.trim() : '(detached)'
  let ahead = 0, behind = 0
  if (upstreamRes.ok) {
    const m = upstreamRes.stdout.trim().split(/\s+/).map(n => parseInt(n, 10))
    if (m.length === 2 && !isNaN(m[0]) && !isNaN(m[1])) { ahead = m[0]; behind = m[1] }
  }

  const files: GitFile[] = []
  if (statusRes.ok) {
    for (const line of statusRes.stdout.split('\n')) {
      if (line.length < 3) continue
      const staged = line[0]
      const unstaged = line[1]
      const path = line.slice(3)
      files.push({ path, staged, unstaged })
    }
  }

  const worktrees: GitWorktree[] = []
  if (worktreeRes.ok) {
    let cur: Partial<GitWorktree> = {}
    for (const line of worktreeRes.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur.path) worktrees.push(cur as GitWorktree)
        cur = { path: line.slice('worktree '.length) }
      } else if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      else if (line === 'bare') cur.bare = true
      else if (line === 'detached') cur.detached = true
    }
    if (cur.path) worktrees.push(cur as GitWorktree)
  }

  return { ok: true, branch, ahead, behind, files, worktrees, hasUpstream: upstreamRes.ok }
})

// ---- code-server singleton ----
let codeServerProc: ChildProcess | null = null
let codeServerPort: number | null = null
let codeServerStarting: Promise<{ ok: boolean; port?: number; url?: string; error?: string }> | null = null
let codeServerSessionToken = ''

// code-server candidate paths — platform-specific.
// On Windows, code-server is typically installed as a .cmd wrapper in
// %LOCALAPPDATA%\Programs\code-server\bin\  (official installer) or
// the Scoop/Chocolatey variants put it somewhere on PATH.
const CODE_SERVER_CANDIDATES: string[] = IS_WIN
  ? [
      join(homedir(), 'AppData', 'Local', 'Programs', 'code-server', 'bin', 'code-server.cmd'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'code-server', 'code-server.cmd'),
      join(homedir(), 'scoop', 'shims', 'code-server.cmd'),
      join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'code-server.cmd'),
      join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '.bin', 'code-server.cmd'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'code-server', 'bin', 'code-server.cmd'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'code-server', 'code-server.cmd'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'code-server', 'bin', 'code-server.cmd'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'code-server', 'code-server.cmd'),
      'code-server.cmd'
    ]
  : [
      'code-server',
      join(homedir(), '.local', 'bin', 'code-server'),
      '/usr/bin/code-server',
      '/usr/local/bin/code-server'
    ]

const findCodeServerBin = (): string | null => {
  // Check explicit candidate paths first.
  for (const c of CODE_SERVER_CANDIDATES) {
    if ((c.includes('/') || c.includes('\\')) && existsSync(c)) return c
  }
  // PATH lookup — use platform-correct separator.
  const paths = (process.env.PATH || '').split(PATH_SEP)
  const exe = IS_WIN ? 'code-server.cmd' : 'code-server'
  for (const dir of paths) {
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const findFreePort = (): Promise<number> => new Promise((resolve, reject) => {
  const srv = net.createServer()
  srv.unref()
  srv.on('error', reject)
  srv.listen(0, '127.0.0.1', () => {
    const addr = srv.address()
    if (typeof addr === 'object' && addr) {
      const port = addr.port
      srv.close(() => resolve(port))
    } else {
      reject(new Error('no address'))
    }
  })
})

const waitForPort = (port: number, host = '127.0.0.1', timeoutMs = 20000): Promise<boolean> => {
  const start = Date.now()
  return new Promise(resolve => {
    const tryConnect = () => {
      const sock = net.connect({ port, host })
      sock.once('connect', () => { sock.destroy(); resolve(true) })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) return resolve(false)
        setTimeout(tryConnect, 200)
      })
    }
    tryConnect()
  })
}

const isPortFree = (port: number, host = '127.0.0.1'): Promise<boolean> => new Promise(resolve => {
  const srv = net.createServer()
  srv.once('error', () => resolve(false))
  srv.once('listening', () => srv.close(() => resolve(true)))
  srv.listen(port, host)
})

const getStablePort = async (userDataDir: string): Promise<number> => {
  const portFile = join(userDataDir, 'codeserver-port.txt')
  try {
    const saved = parseInt((await fsp.readFile(portFile, 'utf8')).trim(), 10)
    if (saved > 1024 && saved < 65535 && (await isPortFree(saved))) return saved
  } catch { /* first run or file missing */ }
  // Pick a fresh free port and persist it.
  const port = await findFreePort()
  try { await fsp.writeFile(portFile, String(port), 'utf8') } catch { /* ignore */ }
  return port
}

const startCodeServer = async (): Promise<{ ok: boolean; port?: number; url?: string; error?: string }> => {
  if (codeServerProc) {
    if (codeServerPort) {
      return { ok: true, port: codeServerPort, url: `http://127.0.0.1:${codeServerPort}` }
    }
    if (codeServerStarting) return codeServerStarting
    return { ok: false, error: 'code-server is already starting or running' }
  }
  if (codeServerStarting) return codeServerStarting
  const bin = findCodeServerBin()
  if (!bin) return { ok: false, error: 'code-server binary not found. Install with: curl -fsSL https://code-server.dev/install.sh | sh' }
  
  mainWindow?.setProgressBar(2) // Set indeterminate progress on taskbar

  codeServerStarting = (async () => {
    try {
      const userDataDir = join(app.getPath('userData'), 'code-server-data')
      const extDir = join(app.getPath('userData'), 'code-server-extensions')
      await fsp.mkdir(userDataDir, { recursive: true })
      await fsp.mkdir(extDir, { recursive: true })
      // Seed default settings so Ctrl+Wheel zooms editor font (VSCode's
      // editor.mouseWheelZoom) and ensure new windows open fresh without the welcome screen.
      const userDir = join(userDataDir, 'User')
      const settingsPath = join(userDir, 'settings.json')
      try {
        await fsp.mkdir(userDir, { recursive: true })
        let currentSettings: Record<string, any> = {
          'editor.mouseWheelZoom': true,
          'workbench.startupEditor': 'none',
          'window.restoreWindows': 'none'
        }
        try {
          const raw = await fsp.readFile(settingsPath, 'utf8')
          currentSettings = { ...currentSettings, ...JSON.parse(raw) }
        } catch { /* ignore if missing/malformed */ }
        
        // Force session settings to prevent reopening the last active folder
        currentSettings['window.restoreWindows'] = 'none'
        currentSettings['workbench.startupEditor'] = 'none'
        
        await fsp.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2), 'utf8')
      } catch { /* non-fatal */ }
      // Stable port across restarts — cookies and OAuth callbacks are tied to origin,
      // so a random port every launch wipes login sessions.
      const port = await getStablePort(userDataDir)
      
      const password = crypto.randomBytes(24).toString('hex')
      const args = [
        '--bind-addr', `127.0.0.1:${port}`,
        '--auth', 'password',
        '--disable-telemetry',
        '--disable-update-check',
        '--user-data-dir', userDataDir,
        '--extensions-dir', extDir,
        '--ignore-last-opened'
      ]
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PASSWORD: password } })
      codeServerProc = proc
      // Log code-server output verbosely while we're debugging IDE issues (profile
      // create / wheel zoom etc). Filter only the most repetitive lines.
      const noisyRe = /i18next|GL Driver Message|RequestStore#acceptReply|terminator_CreateInstance|reconnection-grace-time/
      proc.stdout?.on('data', d => {
        const s = d.toString().trim()
        if (s && !noisyRe.test(s)) console.log('[code-server]', s)
      })
      proc.stderr?.on('data', d => {
        const s = d.toString().trim()
        if (s && !noisyRe.test(s)) console.error('[code-server]', s)
      })
      proc.on('exit', (code, signal) => {
        console.log('[code-server] exited', { code, signal })
        codeServerProc = null
        codeServerPort = null
        mainWindow?.webContents.send('codeserver:exit', { code, signal })
      })
      const ready = await waitForPort(port)
      if (!ready) {
        try { proc.kill() } catch { /* ignore */ }
        codeServerProc = null
        return { ok: false, error: 'code-server failed to start within 20s' }
      }

      // Inject the authentication cookie into the partition's session so the webview bypasses the password screen
      const csSession = session.fromPartition('persist:wts-code-server')
      try {
        const allCookies = await csSession.cookies.get({})
        for (const c of allCookies) {
          const url = `${c.secure ? 'https' : 'http'}://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path}`
          await csSession.cookies.remove(url, c.name)
        }
      } catch { /* ignore */ }

      // Programmatically login to retrieve the official session cookie
      let sessionToken = ''
      try {
        sessionToken = await new Promise<string>((resolve, reject) => {
          const postData = `password=${encodeURIComponent(password)}`
          const req = http.request({
            host: '127.0.0.1',
            port: port,
            path: '/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(postData)
            }
          }, res => {
            const setCookie = res.headers['set-cookie']
            if (setCookie && setCookie.length > 0) {
              const match = setCookie[0].match(/^code-server-session=([^;]+)/)
              if (match) {
                resolve(decodeURIComponent(match[1]))
                return
              }
            }
            reject(new Error('No code-server-session cookie in login response'))
          })
          req.on('error', err => reject(err))
          req.write(postData)
          req.end()
        })
      } catch (cookieErr) {
        console.error('[code-server] Programmatic login failed:', cookieErr)
      }

      if (sessionToken) {
        codeServerSessionToken = sessionToken
        await csSession.cookies.set({
          url: `http://127.0.0.1:${port}`,
          name: 'code-server-session',
          value: sessionToken,
          path: '/'
        })
        await csSession.cookies.set({
          url: `http://localhost:${port}`,
          name: 'code-server-session',
          value: sessionToken,
          path: '/'
        })
      }

      codeServerPort = port
      return { ok: true, port, url: `http://127.0.0.1:${port}` }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      codeServerStarting = null
      mainWindow?.setProgressBar(-1) // Clear taskbar progress
    }
  })()
  return codeServerStarting
}

ipcMain.handle('codeserver:start', () => startCodeServer())

ipcMain.handle('codeserver:status', () => {
  if (codeServerProc && codeServerPort) {
    return { ok: true, running: true, port: codeServerPort, url: `http://127.0.0.1:${codeServerPort}` }
  }
  return { ok: true, running: false, available: !!findCodeServerBin() }
})

ipcMain.handle('codeserver:stop', () => {
  if (codeServerProc) {
    try { codeServerProc.kill() } catch { /* ignore */ }
  }
  codeServerProc = null
  codeServerPort = null
  return { ok: true }
})

ipcMain.handle('codeserver:authenticate-partition', async (_e, partitionName) => {
  if (!codeServerPort || !codeServerSessionToken) {
    return { ok: false, error: 'code-server not running or session token not available' }
  }
  const csSession = session.fromPartition(partitionName)
  try {
    const allCookies = await csSession.cookies.get({})
    for (const c of allCookies) {
      const url = `${c.secure ? 'https' : 'http'}://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path}`
      await csSession.cookies.remove(url, c.name)
    }
    await csSession.cookies.set({
      url: `http://127.0.0.1:${codeServerPort}`,
      name: 'code-server-session',
      value: codeServerSessionToken,
      path: '/'
    })
    await csSession.cookies.set({
      url: `http://localhost:${codeServerPort}`,
      name: 'code-server-session',
      value: codeServerSessionToken,
      path: '/'
    })
    return { ok: true }
  } catch (err) {
    console.error(`Failed to authenticate partition ${partitionName}:`, err)
    return { ok: false, error: (err as Error).message }
  }
})



app.on('before-quit', () => {
  if (codeServerProc) {
    try { codeServerProc.kill() } catch { /* ignore */ }
    codeServerProc = null
    codeServerPort = null
  }
})

// ─── Auto-Updater Helpers & Handler ──────────────────────────────────────────
import * as https from 'https'
import { createWriteStream } from 'fs'

function downloadFile(url: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)
    
    const requestUrl = (targetUrl: string) => {
      https.get(targetUrl, {
        headers: { 'User-Agent': 'Deck-Updater' }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          requestUrl(res.headers.location!)
          return
        }
        
        if (res.statusCode !== 200) {
          file.close()
          reject(new Error(`Server returned HTTP ${res.statusCode}`))
          return
        }
        
        const totalSize = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        
        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (totalSize > 0) {
            onProgress(downloaded / totalSize)
          }
        })
        
        res.pipe(file)
        
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        file.close()
        reject(err)
      })
    }
    
    requestUrl(url)
  })
}

ipcMain.handle('app:trigger-update', async (_e, { url, filename }) => {
  if (!mainWindow) return { ok: false, error: 'No active window' }
  
  mainWindow.setProgressBar(0)
  
  const onProgress = (percent: number) => {
    mainWindow?.setProgressBar(percent)
    mainWindow?.webContents.send('app:update-progress', percent)
  }
  
  try {
    if (IS_WIN) {
      const tempPath = join(app.getPath('temp'), filename)
      await downloadFile(url, tempPath, onProgress)
      
      // Spawn installer detached and exit app
      const child = spawn(tempPath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      app.quit()
      return { ok: true }
    } else if (process.platform === 'linux' && process.env.APPIMAGE) {
      const activePath = process.env.APPIMAGE
      const tempPath = join(dirname(activePath), 'Deck-Update.AppImage')
      
      await downloadFile(url, tempPath, onProgress)
      
      // Make it executable
      await fsp.chmod(tempPath, 0o755)
      
      // Rename current to current.old
      const oldPath = activePath + '.old'
      if (existsSync(oldPath)) {
        try { await fsp.unlink(oldPath) } catch {}
      }
      await fsp.rename(activePath, oldPath)
      
      // Rename temp to current
      await fsp.rename(tempPath, activePath)
      
      // Relaunch the new AppImage
      const child = spawn(activePath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      app.quit()
      return { ok: true }
    } else {
      // General download for dev / package manager installs
      const destPath = join(app.getPath('downloads'), filename)
      await downloadFile(url, destPath, onProgress)
      
      // Show file in file manager
      shell.showItemInFolder(destPath)
      return { ok: true, downloadedTo: destPath }
    }
  } catch (err) {
    console.error('Update failed:', err)
    mainWindow.setProgressBar(-1)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

export {}
