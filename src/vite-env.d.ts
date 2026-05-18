/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getAppVersion: () => Promise<string>
    getPlatform: () => Promise<string>
    getWebviewPreloadPath?: () => Promise<string>
    openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>
    onWorkspaceCommand?: (callback: (command: string) => void) => () => void
    onCanvasZoomCommand?: (callback: (direction: 'in' | 'out' | 'reset') => void) => () => void
    onTouchpadPinch?: (callback: (data: { scale: number; velocity: number; centerX: number; centerY: number }) => void) => void
    pty?: {
      spawn: (args: { panelId: string; cwd?: string; cols?: number; rows?: number; shell?: string }) => Promise<{ ok: boolean; panelId: string; pid?: number; cwd?: string; shell?: string }>
      write: (panelId: string, data: string) => void
      resize: (panelId: string, cols: number, rows: number) => void
      kill: (panelId: string) => void
      cwd: (panelId: string) => Promise<{ ok: boolean; cwd?: string; error?: string }>
      scrollback?: (panelId: string) => Promise<{ ok: boolean; data: string }>
      onData: (cb: (panelId: string, data: string) => void) => () => void
      onExit: (cb: (panelId: string, info: { exitCode: number; signal?: number }) => void) => () => void
    }
    file?: {
      read: (path: string) => Promise<{ ok: boolean; content?: string; path?: string; size?: number; mtimeMs?: number; error?: string }>
      write: (path: string, content: string) => Promise<{ ok: boolean; path?: string; size?: number; mtimeMs?: number; error?: string }>
      openDialog: (defaultDir?: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
      saveDialog: (args: { suggestedName?: string; defaultDir?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
      dirname: (p: string) => Promise<string>
      basename: (p: string) => Promise<string>
    }
    fs?: {
      listDir: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string; path: string; isDir: boolean; isSymlink: boolean }>; error?: string }>
      walkUp: (start: string, markers: string[]) => Promise<{ ok: boolean; found: string | null; marker?: string }>
      home: () => Promise<string>
      rename?: (from: string, to: string) => Promise<{ ok: boolean; error?: string }>
      delete?: (path: string) => Promise<{ ok: boolean; error?: string }>
      mkdir?: (path: string) => Promise<{ ok: boolean; error?: string }>
      touch?: (path: string) => Promise<{ ok: boolean; error?: string }>
      reveal?: (path: string) => Promise<{ ok: boolean; error?: string }>
      trash?: (path: string) => Promise<{ ok: boolean; error?: string }>
    }
    tokens?: {
      scan: () => Promise<{ ok: boolean; rows?: Array<{ tool: string; project: string; model: string; day: string; input: number; output: number; cacheCreate: number; cacheRead: number; messages: number; costUsd: number }>; scannedAt?: number; error?: string }>
    }
    search?: {
      files: (root: string, query: string, maxResults?: number) => Promise<{ ok: boolean; results: Array<{ file: string; line: number; text: string }>; tool: string }>
    }
    git?: {
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
    window?: {
      popoutPanel: (panelId: string) => Promise<{ ok: boolean; error?: string }>
      redockPanel: (panelId: string) => Promise<{ ok: boolean }>
      isPopout: () => Promise<{ popout: boolean; panelId?: string }>
      onPanelDetached: (cb: (panelId: string) => void) => () => void
      onPanelRedocked: (cb: (panelId: string) => void) => () => void
      onPopoutFlush: (cb: () => void) => () => void
    }
    appClose?: {
      onSaveThenClose: (cb: () => void) => () => void
      forceClose: () => Promise<void>
    }
    codeServer?: {
      start: () => Promise<{ ok: boolean; port?: number; url?: string; error?: string }>
      status: () => Promise<{ ok: boolean; running?: boolean; port?: number; url?: string; available?: boolean }>
      stop: () => Promise<{ ok: boolean }>
      onExit: (cb: (info: { code: number | null; signal: string | null }) => void) => () => void
    }
  }
}
