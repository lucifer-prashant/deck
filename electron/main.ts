import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } from 'electron'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import { promises as fsp, existsSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as pty from 'node-pty'

type PtySession = { proc: pty.IPty; panelId: string }
const ptys = new Map<string, PtySession>()
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

// Disable hardware acceleration on Linux to avoid GPU crashes
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
}

let mainWindow: BrowserWindow | null = null
// panelId → BrowserWindow for popped-out panels.
const popoutWindows = new Map<string, BrowserWindow>()

const allWindows = (): BrowserWindow[] => {
  const out: BrowserWindow[] = []
  if (mainWindow && !mainWindow.isDestroyed()) out.push(mainWindow)
  popoutWindows.forEach(w => { if (!w.isDestroyed()) out.push(w) })
  return out
}
const broadcast = (channel: string, payload: unknown) => {
  allWindows().forEach(w => { try { w.webContents.send(channel, payload) } catch { /* */ } })
}

const isDev = !app.isPackaged

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
        { label: 'Send to Back',                                    click: () => send('send-back') }
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
        { label: 'Toggle Snap to Grid',                                  click: () => send('toggle-snap') },
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
        { label: 'About Worktree Studio' },
        { label: 'Keyboard Shortcuts', accelerator: 'F1' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

buildMenu()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      webviewTag: true
    },
    frame: true,
    title: 'Worktree Studio'
  })

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

// Spoof a vanilla Chrome user agent on every webview. WhatsApp Web, some Google flows,
// and a handful of other sites block Electron's default UA (which contains "Electron"
// and our app name). Pretending to be plain Chrome 131 on Linux works everywhere.
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Wire permissions + downloads + zoom + window-open for every webview that gets created.
app.on('web-contents-created', (_evt, contents) => {
  if (contents.getType() !== 'webview') return
  const sess = contents.session
  try { contents.setUserAgent(CHROME_UA) } catch { /* ignore */ }
  try { sess.setUserAgent(CHROME_UA) } catch { /* ignore */ }

  // Permissions: allow everything common a normal browser would. Lets sites
  // request mic/camera/clipboard/geo/notifications/MIDI without silent denial.
  sess.setPermissionRequestHandler((_wc, _perm, cb) => cb(true))
  sess.setPermissionCheckHandler(() => true)
  // Screen-share / window-pick (Discord call screen-share, Google Meet present, etc.)
  // needs an explicit handler since Electron 31+. We auto-pick the entire primary screen
  // — keeps Discord's start-screenshare flow one click without an OS picker.
  try {
    sess.setDisplayMediaRequestHandler((_req, callback) => {
      // Picking the first screen source; for app-window picking we'd need to enumerate.
      // dynamic import so dev builds without the screen API don't break.
      import('electron').then(({ desktopCapturer }) => {
        desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
          callback({ video: sources[0], audio: 'loopback' })
        }).catch(() => callback({}))
      }).catch(() => callback({}))
    })
  } catch { /* older electron — falls back to default */ }

  // Downloads: prompt the user where to save, no auto-download, let Chromium handle the rest.
  sess.removeAllListeners('will-download')
  sess.on('will-download', (_e, item) => {
    const filename = item.getFilename()
    const suggested = filename || 'download'
    const chosen = dialog.showSaveDialogSync(mainWindow!, {
      title: 'Save file',
      defaultPath: suggested
    })
    if (!chosen) {
      item.cancel()
      return
    }
    item.setSavePath(chosen)
    item.once('done', (_done, state) => {
      if (state === 'completed') {
        mainWindow?.webContents.send('download-finished', { path: chosen, filename: basename(chosen) })
      }
    })
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

app.whenReady().then(async () => {
  // Clear stale service workers for the code-server partition on every launch.
  // The Service Worker DB gets a stale LOCK file when the app exits ungracefully,
  // causing "Failed to delete the database: Database IO error" on next start and a
  // blank editor webview. Clearing service workers forces a fresh registration.
  try {
    await session.fromPartition('persist:wts-code-server').clearStorageData({ storages: ['serviceworkers'] })
  } catch { /* non-fatal */ }
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

// ---- pty ----
ipcMain.handle('pty:spawn', (_e, args: { panelId: string; cwd?: string; cols?: number; rows?: number; shell?: string }) => {
  const { panelId } = args
  if (ptys.has(panelId)) return { ok: true, panelId }
  const shellPath = args.shell || process.env.SHELL || '/bin/bash'
  const cwd = args.cwd && args.cwd.length ? args.cwd : homedir()
  // Spawn as a LOGIN + INTERACTIVE shell so the user's full environment loads:
  //   bash: ~/.bash_profile (which typically sources ~/.bashrc) → aliases, functions
  //         like z/zoxide, fzf, PATH additions
  //   zsh:  ~/.zprofile + ~/.zshrc → same idea
  //   fish: --login → ~/.config/fish/config.fish
  // Without -l, .bash_profile/.zprofile aren't read and user-defined commands miss.
  const shellArgs: string[] = ['-l']
  const proc = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: args.cols || 80,
    rows: args.rows || 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  })
  proc.onData(data => {
    appendPtyBuffer(panelId, data)
    broadcast('pty:data', { panelId, data })
  })
  proc.onExit(({ exitCode, signal }) => {
    broadcast('pty:exit', { panelId, exitCode, signal })
    ptys.delete(panelId)
    ptyBuffers.delete(panelId)
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

// Read current cwd of a pty's foreground process by following /proc/<pid>/cwd.
// Linux only — that's the only platform we target right now. Returns null if unreadable.
ipcMain.handle('pty:cwd', async (_e, panelId: string) => {
  const s = ptys.get(panelId)
  if (!s) return { ok: false, error: 'no pty' }
  try {
    const cwd = await fsp.readlink(`/proc/${s.proc.pid}/cwd`)
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

// ---- token usage scanner ----
// Walks local agent log dirs, parses JSONL, aggregates by tool/model/project/day.
// Dedupes by message id so resuming/replaying a session doesn't double-count.
// Pricing is approximate (per 1M tokens, USD); update as providers change rates.
const PRICING: Record<string, { in: number; out: number; cacheIn?: number; cacheRead?: number }> = {
  'claude-opus-4-7': { in: 15, out: 75, cacheIn: 18.75, cacheRead: 1.5 },
  'claude-opus-4-5': { in: 15, out: 75, cacheIn: 18.75, cacheRead: 1.5 },
  'claude-opus-4-6': { in: 15, out: 75, cacheIn: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheIn: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { in: 3, out: 15, cacheIn: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheIn: 1.25, cacheRead: 0.1 },
  'claude-3-5-sonnet-20241022': { in: 3, out: 15, cacheIn: 3.75, cacheRead: 0.3 },
  'claude-3-7-sonnet-20250219': { in: 3, out: 15, cacheIn: 3.75, cacheRead: 0.3 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4-turbo': { in: 10, out: 30 },
  'o1': { in: 15, out: 60 },
  'o1-mini': { in: 3, out: 12 }
}

interface UsageRow {
  tool: string
  project: string
  model: string
  day: string // YYYY-MM-DD UTC
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  messages: number
  costUsd: number
}

const estimateCost = (model: string, u: { input: number; output: number; cacheCreate: number; cacheRead: number }): number => {
  // Strip provider/date suffix variations to look up.
  const key = model.toLowerCase()
  let p = PRICING[key]
  if (!p) {
    for (const k of Object.keys(PRICING)) {
      if (key.includes(k)) { p = PRICING[k]; break }
    }
  }
  if (!p) return 0
  return (
    (u.input * p.in) +
    (u.output * p.out) +
    (u.cacheCreate * (p.cacheIn ?? p.in)) +
    (u.cacheRead * (p.cacheRead ?? p.in * 0.1))
  ) / 1_000_000
}

const tokenScanDirs = [
  { dir: join(homedir(), '.claude', 'projects'), tool: 'claude' },
  { dir: join(homedir(), '.codex', 'sessions'), tool: 'codex' }
]

const OPENCODE_DBS = [
  join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  join(homedir(), '.local', 'share', 'opencode', 'opencode-dev.db')
]

const walkJsonlFiles = async (root: string): Promise<string[]> => {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch { continue }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  return out
}

// Best-effort project path inference from a JSONL file path. Claude encodes the project
// as a directory name with slashes flattened to dashes (e.g. -home-lucifer-myproject).
const inferProject = (jsonlPath: string, tool: string): string => {
  if (tool === 'claude') {
    const m = jsonlPath.match(/\/\.claude\/projects\/([^/]+)/)
    if (m) return '/' + m[1].replace(/^-/, '').replace(/-/g, '/')
  }
  return jsonlPath.split('/').slice(0, -1).join('/')
}

// Read opencode's SQLite db by spawning the sqlite3 CLI (avoids native module rebuild).
// Returns parsed message JSON objects.
const readOpencodeMessages = async (dbPath: string): Promise<Array<Record<string, unknown>>> => {
  try { await fsp.access(dbPath) } catch { return [] }
  // Use a unique separator so we can split lines reliably even if data contains newlines.
  const SEP = ''
  const sql = `SELECT data FROM message;`
  return new Promise(resolve => {
    const proc = spawn('sqlite3', ['-separator', SEP, '-readonly', dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    const timer = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 10000)
    proc.on('close', () => {
      clearTimeout(timer)
      if (err && !out) { resolve([]); return }
      const rows: Array<Record<string, unknown>> = []
      // sqlite3 CLI prints each row's data on its own line by default. Data is JSON which
      // may contain newlines; .mode line is too verbose. Best path: assume each row's data
      // is a single line (opencode writes compact JSON).
      for (const line of out.split('\n')) {
        const s = line.trim()
        if (!s) continue
        try { rows.push(JSON.parse(s)) } catch { /* skip malformed */ }
      }
      resolve(rows)
    })
    proc.on('error', () => { clearTimeout(timer); resolve([]) })
  })
}

ipcMain.handle('tokens:scan', async () => {
  const rows: UsageRow[] = []
  const seenIds = new Set<string>()

  // --- opencode (SQLite) ---
  for (const dbPath of OPENCODE_DBS) {
    const messages = await readOpencodeMessages(dbPath)
    // opencode message JSON shape:
    //  { role: 'assistant', tokens: { input, output, reasoning, cache: { write, read } },
    //    cost, modelID, providerID, path: { cwd }, time: { created } }
    const byDayModel = new Map<string, UsageRow>()
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const tokens = m.tokens as Record<string, number | Record<string, number>> | undefined
      if (!tokens) continue
      const cache = (tokens.cache as Record<string, number>) || {}
      const input = (tokens.input as number) || 0
      const output = (tokens.output as number) || 0
      const cacheCreate = cache.write || 0
      const cacheRead = cache.read || 0
      if (input + output + cacheCreate + cacheRead === 0) continue
      const model = ((m.modelID as string) || 'unknown').toLowerCase()
      const project = ((m.path as Record<string, string> | undefined)?.cwd) || 'unknown'
      const created = (m.time as Record<string, number> | undefined)?.created
      const date = created ? new Date(created) : new Date()
      const day = isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10)
      const k = `${day}|${model}|${project}`
      const existing = byDayModel.get(k)
      if (existing) {
        existing.input += input
        existing.output += output
        existing.cacheCreate += cacheCreate
        existing.cacheRead += cacheRead
        existing.messages += 1
      } else {
        byDayModel.set(k, {
          tool: 'opencode', project, model, day,
          input, output, cacheCreate, cacheRead,
          messages: 1, costUsd: 0
        })
      }
    }
    for (const row of byDayModel.values()) {
      row.costUsd = estimateCost(row.model, row)
      rows.push(row)
    }
  }

  // --- claude + codex (JSONL) ---
  for (const { dir, tool } of tokenScanDirs) {
    let files: string[] = []
    try { files = await walkJsonlFiles(dir) } catch { /* dir missing */ }
    for (const file of files) {
      const project = inferProject(file, tool)
      let raw: string
      try { raw = await fsp.readFile(file, 'utf8') } catch { continue }
      const lines = raw.split('\n')
      const byDayModel = new Map<string, UsageRow>()
      for (const line of lines) {
        if (!line.trim()) continue
        let obj: Record<string, unknown>
        try { obj = JSON.parse(line) } catch { continue }
        const message = (obj.message ?? obj) as Record<string, unknown> | undefined
        if (!message) continue
        const id = (message.id ?? obj.id ?? obj.uuid) as string | undefined
        const usage = (message.usage ?? obj.usage) as Record<string, number> | undefined
        if (!usage) continue
        const dedupeKey = id ? `${tool}:${id}` : undefined
        if (dedupeKey) {
          if (seenIds.has(dedupeKey)) continue
          seenIds.add(dedupeKey)
        }
        const model = ((message.model ?? obj.model ?? 'unknown') as string).toLowerCase()
        const ts = (obj.timestamp ?? obj.created_at ?? obj.ts ?? message.created_at) as string | number | undefined
        const date = ts ? new Date(ts) : new Date()
        const day = isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10)
        const input = usage.input_tokens ?? usage.prompt_tokens ?? 0
        const output = usage.output_tokens ?? usage.completion_tokens ?? 0
        const cacheCreate = usage.cache_creation_input_tokens ?? 0
        const cacheRead = usage.cache_read_input_tokens ?? 0
        if (input + output + cacheCreate + cacheRead === 0) continue
        const k = `${day}|${model}`
        const existing = byDayModel.get(k)
        if (existing) {
          existing.input += input
          existing.output += output
          existing.cacheCreate += cacheCreate
          existing.cacheRead += cacheRead
          existing.messages += 1
        } else {
          byDayModel.set(k, {
            tool, project, model, day,
            input, output, cacheCreate, cacheRead,
            messages: 1, costUsd: 0
          })
        }
      }
      for (const row of byDayModel.values()) {
        row.costUsd = estimateCost(row.model, row)
        rows.push(row)
      }
    }
  }
  return { ok: true, rows, scannedAt: Date.now() }
})

// ---- git status ----
const runGit = (cwd: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> =>
  new Promise(resolve => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
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

// ---- ripgrep / grep wrapper for global search ----
const hasRg = (() => {
  const PATH = (process.env.PATH || '').split(':')
  for (const dir of PATH) {
    if (existsSync(join(dir, 'rg'))) return true
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
    const cmd = hasRg ? 'rg' : 'grep'
    const cmdArgs = hasRg
      ? ['--line-number', '--no-heading', '--color=never', '--max-count=20', '--max-filesize=2M', '-S', '--', q, root]
      : ['-rn', '-I', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=.next', '--', q, root]
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    const timeout = setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 15000)
    proc.stdout.on('data', d => {
      buf += d.toString()
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (results.length >= cap) {
          try { proc.kill() } catch { /* */ }
          break
        }
        // format: <file>:<line>:<text>
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
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      webviewTag: true
    },
    title: 'Worktree Studio — Panel'
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

ipcMain.handle('window:is-popout', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return { popout: false }
  for (const [panelId, w] of popoutWindows.entries()) {
    if (w === win) return { popout: true, panelId }
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
  const r = await runGit(repoRoot, ['fetch', '--all', '--prune'], 30000)
  return { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() }
})

ipcMain.handle('git:pull', async (_e, repoRoot: string) => {
  const r = await runGit(repoRoot, ['pull', '--ff-only'], 60000)
  return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()), output: r.stdout.trim() }
})

ipcMain.handle('git:push', async (_e, args: { repoRoot: string; setUpstream?: boolean }) => {
  const gitArgs = args.setUpstream
    ? ['push', '-u', 'origin', 'HEAD']
    : ['push']
  const r = await runGit(args.repoRoot, gitArgs, 60000)
  return { ok: r.ok, error: r.ok ? undefined : (r.stderr.trim() || r.stdout.trim()), output: r.stdout.trim() }
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
  const lim = args.limit || 30
  const r = await runGit(args.repoRoot, ['log', `--max-count=${lim}`, '--pretty=format:%h%x1f%s%x1f%an%x1f%ar%x1f%d'], 10000)
  if (!r.ok) return { ok: false, error: r.stderr.trim() }
  const commits = r.stdout.split('\n').filter(Boolean).map(line => {
    const [sha, subject, author, date, refs] = line.split('\x1f')
    return { sha, subject, author, date, refs: (refs || '').trim() }
  })
  return { ok: true, commits }
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
    runGit(repoRoot, ['status', '--porcelain=v1']),
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

const CODE_SERVER_CANDIDATES = [
  'code-server',
  join(homedir(), '.local', 'bin', 'code-server'),
  '/usr/bin/code-server',
  '/usr/local/bin/code-server'
]

const findCodeServerBin = (): string | null => {
  for (const c of CODE_SERVER_CANDIDATES) {
    if (c.includes('/') && existsSync(c)) return c
  }
  // PATH lookup via `which`-like
  const PATH = (process.env.PATH || '').split(':')
  for (const dir of PATH) {
    const candidate = join(dir, 'code-server')
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
  if (codeServerProc && codeServerPort) {
    return { ok: true, port: codeServerPort, url: `http://127.0.0.1:${codeServerPort}` }
  }
  if (codeServerStarting) return codeServerStarting
  const bin = findCodeServerBin()
  if (!bin) return { ok: false, error: 'code-server binary not found. Install with: curl -fsSL https://code-server.dev/install.sh | sh' }
  codeServerStarting = (async () => {
    try {
      const userDataDir = join(app.getPath('userData'), 'code-server-data')
      const extDir = join(app.getPath('userData'), 'code-server-extensions')
      await fsp.mkdir(userDataDir, { recursive: true })
      await fsp.mkdir(extDir, { recursive: true })
      // Seed default settings so Ctrl+Wheel zooms editor font (VSCode's
      // editor.mouseWheelZoom). Only seed on first run — never clobber user edits.
      const userDir = join(userDataDir, 'User')
      const settingsPath = join(userDir, 'settings.json')
      try {
        await fsp.access(settingsPath)
      } catch {
        try {
          await fsp.mkdir(userDir, { recursive: true })
          await fsp.writeFile(settingsPath, JSON.stringify({
            'editor.mouseWheelZoom': true,
            'workbench.startupEditor': 'none'
          }, null, 2), 'utf8')
        } catch { /* non-fatal */ }
      }
      // Stable port across restarts — cookies and OAuth callbacks are tied to origin,
      // so a random port every launch wipes login sessions.
      const port = await getStablePort(userDataDir)
      const args = [
        '--bind-addr', `127.0.0.1:${port}`,
        '--auth', 'none',
        '--disable-telemetry',
        '--disable-update-check',
        '--user-data-dir', userDataDir,
        '--extensions-dir', extDir
      ]
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } })
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
      codeServerPort = port
      return { ok: true, port, url: `http://127.0.0.1:${port}` }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      codeServerStarting = null
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

app.on('before-quit', () => {
  if (codeServerProc) {
    try { codeServerProc.kill() } catch { /* ignore */ }
    codeServerProc = null
    codeServerPort = null
  }
})

export {}
