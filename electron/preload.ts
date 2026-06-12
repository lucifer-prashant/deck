import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  envShell: process.env.SHELL || process.env.COMSPEC || '',
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  detectShells: () => ipcRenderer.invoke('shell:detect-available'),
  onWorkspaceCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command)
    ipcRenderer.on('workspace-command', listener)
    return () => ipcRenderer.removeListener('workspace-command', listener)
  },
  onCanvasZoomCommand: (callback: (direction: 'in' | 'out' | 'reset') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') => callback(direction)
    ipcRenderer.on('canvas-zoom-command', listener)
    return () => ipcRenderer.removeListener('canvas-zoom-command', listener)
  },
  onTouchpadPinch: (callback: (data: { scale: number; velocity: number; centerX: number; centerY: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { scale: number; velocity: number; centerX: number; centerY: number }) => callback(data)
    ipcRenderer.on('touchpad-pinch', listener)
    return () => { ipcRenderer.removeListener('touchpad-pinch', listener) }
  },
  pty: {
    spawn: (args: { panelId: string; cwd?: string; cols?: number; rows?: number; shell?: string }) =>
      ipcRenderer.invoke('pty:spawn', args),
    write: (panelId: string, data: string) => ipcRenderer.send('pty:input', { panelId, data }),
    resize: (panelId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { panelId, cols, rows }),
    kill: (panelId: string) => ipcRenderer.send('pty:kill', { panelId }),
    cwd: (panelId: string) => ipcRenderer.invoke('pty:cwd', panelId),
    scrollback: (panelId: string) => ipcRenderer.invoke('pty:scrollback', panelId),
    onData: (cb: (panelId: string, data: string) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { panelId: string; data: string }) => cb(p.panelId, p.data)
      ipcRenderer.on('pty:data', l)
      return () => ipcRenderer.removeListener('pty:data', l)
    },
    onExit: (cb: (panelId: string, info: { exitCode: number; signal?: number }) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { panelId: string; exitCode: number; signal?: number }) =>
        cb(p.panelId, { exitCode: p.exitCode, signal: p.signal })
      ipcRenderer.on('pty:exit', l)
      return () => ipcRenderer.removeListener('pty:exit', l)
    }
  },
  file: {
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', { path, content }),
    openDialog: (defaultDir?: string) => ipcRenderer.invoke('file:open-dialog', defaultDir),
    saveDialog: (args: { suggestedName?: string; defaultDir?: string }) => ipcRenderer.invoke('file:save-dialog', args),
    dirname: (p: string) => ipcRenderer.invoke('file:dirname', p),
    basename: (p: string) => ipcRenderer.invoke('file:basename', p)
  },
  fs: {
    listDir: (path: string) => ipcRenderer.invoke('fs:list-dir', path),
    walkUp: (start: string, markers: string[]) => ipcRenderer.invoke('fs:walk-up', { start, markers }),
    home: () => ipcRenderer.invoke('fs:home'),
    rename: (from: string, to: string) => ipcRenderer.invoke('fs:rename', { from, to }),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
    touch: (path: string) => ipcRenderer.invoke('fs:touch', path),
    reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
    trash: (path: string) => ipcRenderer.invoke('shell:trash', path),
    writeAsset: (data: string, filename?: string) => ipcRenderer.invoke('fs:write-asset', { data, filename }),
    assetDir: () => ipcRenderer.invoke('fs:asset-dir'),
    searchPaths: (root: string, query: string) => ipcRenderer.invoke('fs:search-paths', { root, query }),
    welcomePath: () => ipcRenderer.invoke('fs:welcome-path'),
    importAsAsset: (path: string) => ipcRenderer.invoke('fs:import-as-asset', path)
  },
  search: {
    files: (root: string, query: string, maxResults?: number) => ipcRenderer.invoke('search:files', { root, query, maxResults })
  },
  git: {
    status: (repoRoot: string) => ipcRenderer.invoke('git:status', repoRoot),
    stage: (repoRoot: string, paths: string[]) => ipcRenderer.invoke('git:stage', { repoRoot, paths }),
    unstage: (repoRoot: string, paths: string[]) => ipcRenderer.invoke('git:unstage', { repoRoot, paths }),
    commit: (repoRoot: string, message: string, amend?: boolean) => ipcRenderer.invoke('git:commit', { repoRoot, message, amend }),
    branches: (repoRoot: string) => ipcRenderer.invoke('git:branches', repoRoot),
    worktreeAdd: (repoRoot: string, path: string, branch: string, newBranch?: boolean) => ipcRenderer.invoke('git:worktree-add', { repoRoot, path, branch, newBranch }),
    worktreeRemove: (repoRoot: string, path: string, force?: boolean) => ipcRenderer.invoke('git:worktree-remove', { repoRoot, path, force }),
    pickWorktreeDir: (defaultDir?: string) => ipcRenderer.invoke('git:pick-worktree-dir', defaultDir),
    fetch: (repoRoot: string) => ipcRenderer.invoke('git:fetch', repoRoot),
    pull: (repoRoot: string) => ipcRenderer.invoke('git:pull', repoRoot),
    push: (repoRoot: string, setUpstream?: boolean) => ipcRenderer.invoke('git:push', { repoRoot, setUpstream }),
    checkout: (repoRoot: string, branch: string, create?: boolean) => ipcRenderer.invoke('git:checkout', { repoRoot, branch, create }),
    diff: (repoRoot: string, path?: string, staged?: boolean) => ipcRenderer.invoke('git:diff', { repoRoot, path, staged }),
    log: (repoRoot: string, limit?: number) => ipcRenderer.invoke('git:log', { repoRoot, limit }),
    stashList: (repoRoot: string) => ipcRenderer.invoke('git:stash-list', repoRoot),
    stashSave: (repoRoot: string, message?: string) => ipcRenderer.invoke('git:stash-save', { repoRoot, message }),
    stashPop: (repoRoot: string, ref: string) => ipcRenderer.invoke('git:stash-pop', { repoRoot, ref }),
    stashDrop: (repoRoot: string, ref: string) => ipcRenderer.invoke('git:stash-drop', { repoRoot, ref })
  },
  window: {
    popoutPanel: (panelId: string) => ipcRenderer.invoke('window:popout-panel', panelId),
    redockPanel: (panelId: string) => ipcRenderer.invoke('window:redock-panel', panelId),
    isPopout: () => ipcRenderer.invoke('window:is-popout'),
    onPanelDetached: (cb: (panelId: string) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { panelId: string }) => cb(p.panelId)
      ipcRenderer.on('panel:detached', l)
      return () => ipcRenderer.removeListener('panel:detached', l)
    },
    onPanelRedocked: (cb: (panelId: string) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { panelId: string }) => cb(p.panelId)
      ipcRenderer.on('panel:redocked', l)
      return () => ipcRenderer.removeListener('panel:redocked', l)
    },
    onPopoutFlush: (cb: () => void) => {
      const l = () => cb()
      ipcRenderer.on('popout:flush', l)
      return () => ipcRenderer.removeListener('popout:flush', l)
    }
  },
  appClose: {
    onSaveThenClose: (cb: () => void) => {
      const l = () => cb()
      ipcRenderer.on('app:save-then-close', l)
      return () => ipcRenderer.removeListener('app:save-then-close', l)
    },
    forceClose: () => ipcRenderer.invoke('app:force-close')
  },
  codeServer: {
    start: () => ipcRenderer.invoke('codeserver:start'),
    status: () => ipcRenderer.invoke('codeserver:status'),
    stop: () => ipcRenderer.invoke('codeserver:stop'),
    authenticatePartition: (partitionName: string) => ipcRenderer.invoke('codeserver:authenticate-partition', partitionName),
    onExit: (cb: (info: { code: number | null; signal: NodeJS.Signals | null }) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: { code: number | null; signal: NodeJS.Signals | null }) => cb(p)
      ipcRenderer.on('codeserver:exit', l)
      return () => ipcRenderer.removeListener('codeserver:exit', l)
    }
  },
  triggerUpdate: (url: string, filename: string) => ipcRenderer.invoke('app:trigger-update', { url, filename }),
  onUpdateProgress: (cb: (percent: number) => void) => {
    const l = (_event: Electron.IpcRendererEvent, percent: number) => cb(percent)
    ipcRenderer.on('app:update-progress', l)
    return () => ipcRenderer.removeListener('app:update-progress', l)
  }
})

declare global {
  interface Window {
    electronAPI: {
      platform: string
      envShell: string
      getAppVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      getWebviewPreloadPath: () => Promise<string>
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
      detectShells: () => Promise<Array<{ type: string; label: string; path: string }>>
      onWorkspaceCommand: (callback: (command: string) => void) => () => void
      onCanvasZoomCommand: (callback: (direction: 'in' | 'out' | 'reset') => void) => () => void
      onTouchpadPinch: (callback: (data: { scale: number; velocity: number; centerX: number; centerY: number }) => void) => () => void
      pty: {
        spawn: (args: { panelId: string; cwd?: string; cols?: number; rows?: number; shell?: string }) => Promise<{ ok: boolean; panelId: string; pid?: number; cwd?: string; shell?: string }>
        write: (panelId: string, data: string) => void
        resize: (panelId: string, cols: number, rows: number) => void
        kill: (panelId: string) => void
        cwd: (panelId: string) => Promise<{ ok: boolean; cwd?: string; error?: string }>
        scrollback: (panelId: string) => Promise<{ ok: boolean; data: string }>
        onData: (cb: (panelId: string, data: string) => void) => () => void
        onExit: (cb: (panelId: string, info: { exitCode: number; signal?: number }) => void) => () => void
      }
      file: {
        read: (path: string) => Promise<{ ok: boolean; content?: string; path?: string; size?: number; mtimeMs?: number; error?: string }>
        write: (path: string, content: string) => Promise<{ ok: boolean; path?: string; size?: number; mtimeMs?: number; error?: string }>
        openDialog: (defaultDir?: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
        saveDialog: (args: { suggestedName?: string; defaultDir?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
        dirname: (p: string) => Promise<string>
        basename: (p: string) => Promise<string>
      }
      fs: {
        listDir: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDir: boolean; isSymlink: boolean }>; error?: string }>
        walkUp: (start: string, markers: string[]) => Promise<{ ok: boolean; found: string | null; marker?: string }>
        home: () => Promise<string>
        rename: (from: string, to: string) => Promise<{ ok: boolean; error?: string }>
        delete: (path: string) => Promise<{ ok: boolean; error?: string }>
        mkdir: (path: string) => Promise<{ ok: boolean; error?: string }>
        touch: (path: string) => Promise<{ ok: boolean; error?: string }>
        reveal: (path: string) => Promise<{ ok: boolean; error?: string }>
        trash: (path: string) => Promise<{ ok: boolean; error?: string }>
        searchPaths: (root: string, query: string) => Promise<{ ok: boolean; results?: string[]; error?: string }>
        welcomePath: () => Promise<string>
        importAsAsset: (path: string) => Promise<{ ok: boolean; filename?: string; path?: string; error?: string }>
        writeAsset: (data: string, filename?: string) => Promise<{ ok: boolean; filename?: string; path?: string; error?: string }>
        assetDir: () => Promise<string>
      }
      search: {
        files: (root: string, query: string, maxResults?: number) => Promise<{ ok: boolean; results: Array<{ file: string; line: number; text: string }>; tool: string }>
      }
      git: {
        status: (repoRoot: string) => Promise<{ ok: boolean; branch?: string; ahead?: number; behind?: number; hasUpstream?: boolean; files?: Array<{ path: string; staged: string; unstaged: string }>; worktrees?: Array<{ path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }>; error?: string }>
        stage: (repoRoot: string, paths: string[]) => Promise<{ ok: boolean; error?: string }>
        unstage: (repoRoot: string, paths: string[]) => Promise<{ ok: boolean; error?: string }>
        commit: (repoRoot: string, message: string, amend?: boolean) => Promise<{ ok: boolean; error?: string }>
        branches: (repoRoot: string) => Promise<{ ok: boolean; branches?: string[]; error?: string }>
        worktreeAdd: (repoRoot: string, path: string, branch: string, newBranch?: boolean) => Promise<{ ok: boolean; error?: string }>
        worktreeRemove: (repoRoot: string, path: string, force?: boolean) => Promise<{ ok: boolean; error?: string }>
        pickWorktreeDir: (defaultDir?: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
        fetch: (repoRoot: string) => Promise<{ ok: boolean; error?: string }>
        pull: (repoRoot: string) => Promise<{ ok: boolean; error?: string; output?: string }>
        push: (repoRoot: string, setUpstream?: boolean) => Promise<{ ok: boolean; error?: string; output?: string }>
        checkout: (repoRoot: string, branch: string, create?: boolean) => Promise<{ ok: boolean; error?: string }>
        diff: (repoRoot: string, path?: string, staged?: boolean) => Promise<{ ok: boolean; diff?: string; error?: string }>
        log: (repoRoot: string, limit?: number) => Promise<{ ok: boolean; commits?: Array<{ sha: string; subject: string; author: string; date: string; refs: string }>; error?: string }>
        stashList: (repoRoot: string) => Promise<{ ok: boolean; stashes?: Array<{ ref: string; message: string }>; error?: string }>
        stashSave: (repoRoot: string, message?: string) => Promise<{ ok: boolean; error?: string }>
        stashPop: (repoRoot: string, ref: string) => Promise<{ ok: boolean; error?: string }>
        stashDrop: (repoRoot: string, ref: string) => Promise<{ ok: boolean; error?: string }>
      }
      window: {
        popoutPanel: (panelId: string) => Promise<{ ok: boolean; error?: string }>
        redockPanel: (panelId: string) => Promise<{ ok: boolean }>
        isPopout: () => Promise<{ popout: boolean; panelId?: string }>
        onPanelDetached: (cb: (panelId: string) => void) => () => void
        onPanelRedocked: (cb: (panelId: string) => void) => () => void
        onPopoutFlush: (cb: () => void) => () => void
      }
      appClose: {
        onSaveThenClose: (cb: () => void) => () => void
        forceClose: () => Promise<void>
      }
      codeServer: {
        start: () => Promise<{ ok: boolean; port?: number; url?: string; error?: string }>
        status: () => Promise<{ ok: boolean; running?: boolean; port?: number; url?: string; available?: boolean }>
        stop: () => Promise<{ ok: boolean }>
        authenticatePartition: (partitionName: string) => Promise<{ ok: boolean; error?: string }>
        onExit: (cb: (info: { code: number | null; signal: NodeJS.Signals | null }) => void) => () => void
      }
      triggerUpdate: (url: string, filename: string) => Promise<{ ok: boolean; error?: string; downloadedTo?: string }>
      onUpdateProgress: (cb: (percent: number) => void) => () => void
    }
  }
}
