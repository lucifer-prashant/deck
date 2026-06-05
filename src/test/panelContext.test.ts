import { describe, it, expect } from 'vitest'
import { readPanelContext, explorerRootFor, PROJECT_MARKERS, type PanelContext } from '@/panelContext'
import type { Panel } from '@/store/workspaceStore'

// Helper to create minimal Panel objects for testing
const makePanel = (overrides: Partial<Panel> = {}): Panel => ({
  id: 'test-panel',
  type: 'terminal',
  x: 0, y: 0,
  width: 600, height: 400,
  title: 'Test',
  ...overrides
})

describe('PROJECT_MARKERS', () => {
  it('is an array', () => {
    expect(Array.isArray(PROJECT_MARKERS)).toBe(true)
  })

  it('contains .git', () => {
    expect(PROJECT_MARKERS).toContain('.git')
  })

  it('contains package.json', () => {
    expect(PROJECT_MARKERS).toContain('package.json')
  })

  it('contains Cargo.toml', () => {
    expect(PROJECT_MARKERS).toContain('Cargo.toml')
  })

  it('has at least 5 markers', () => {
    expect(PROJECT_MARKERS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('readPanelContext', () => {
  it('returns panelId and panelType', () => {
    const panel = makePanel({ id: 'my-term', type: 'terminal' })
    const ctx = readPanelContext(panel)
    expect(ctx.panelId).toBe('my-term')
    expect(ctx.panelType).toBe('terminal')
  })

  it('reads cwd from panel directly', () => {
    const panel = makePanel({ cwd: '/home/user' })
    const ctx = readPanelContext(panel)
    expect(ctx.cwd).toBe('/home/user')
  })

  it('reads cwd from settings fallback', () => {
    const panel = makePanel({ settings: { cwd: '/from/settings' } })
    const ctx = readPanelContext(panel)
    expect(ctx.cwd).toBe('/from/settings')
  })

  it('panel.cwd takes priority over settings.cwd', () => {
    const panel = makePanel({ cwd: '/direct', settings: { cwd: '/from/settings' } })
    const ctx = readPanelContext(panel)
    expect(ctx.cwd).toBe('/direct')
  })

  it('reads filePath from panel', () => {
    const panel = makePanel({ type: 'editor', filePath: '/home/user/file.ts' })
    const ctx = readPanelContext(panel)
    expect(ctx.filePath).toBe('/home/user/file.ts')
  })

  it('reads filePath from settings fallback', () => {
    const panel = makePanel({ type: 'editor', settings: { filePath: '/from/settings/file.ts' } })
    const ctx = readPanelContext(panel)
    expect(ctx.filePath).toBe('/from/settings/file.ts')
  })

  it('reads folderPath', () => {
    const panel = makePanel({ folderPath: '/home/user/project' })
    const ctx = readPanelContext(panel)
    expect(ctx.folderPath).toBe('/home/user/project')
  })

  it('reads notePath', () => {
    const panel = makePanel({ notePath: '/home/user/notes.md' })
    const ctx = readPanelContext(panel)
    expect(ctx.notePath).toBe('/home/user/notes.md')
  })

  it('reads projectPath and repoRoot', () => {
    const panel = makePanel({ projectPath: '/home/user/proj', repoRoot: '/home/user/repo' })
    const ctx = readPanelContext(panel)
    expect(ctx.projectPath).toBe('/home/user/proj')
    expect(ctx.repoRoot).toBe('/home/user/repo')
  })

  it('handles panel with no settings or context fields', () => {
    const panel = makePanel()
    const ctx = readPanelContext(panel)
    expect(ctx.cwd).toBeUndefined()
    expect(ctx.folderPath).toBeUndefined()
    expect(ctx.filePath).toBeUndefined()
    expect(ctx.notePath).toBeUndefined()
    expect(ctx.projectPath).toBeUndefined()
    expect(ctx.repoRoot).toBeUndefined()
  })

  it('handles panel with null settings', () => {
    const panel = makePanel({ settings: undefined })
    const ctx = readPanelContext(panel)
    expect(ctx.panelId).toBe('test-panel')
  })
})

describe('explorerRootFor', () => {
  it('returns undefined for null context', () => {
    expect(explorerRootFor(null)).toBeUndefined()
  })

  it('terminal: prefers cwd', () => {
    const ctx: PanelContext = {
      panelId: 't1', panelType: 'terminal',
      cwd: '/home/cwd', folderPath: '/home/folder', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/cwd')
  })

  it('terminal: falls back to folderPath', () => {
    const ctx: PanelContext = {
      panelId: 't1', panelType: 'terminal',
      folderPath: '/home/folder', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/folder')
  })

  it('terminal: falls back to projectPath', () => {
    const ctx: PanelContext = {
      panelId: 't1', panelType: 'terminal',
      projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/proj')
  })

  it('terminal: returns undefined if no paths', () => {
    const ctx: PanelContext = { panelId: 't1', panelType: 'terminal' }
    expect(explorerRootFor(ctx)).toBeUndefined()
  })

  it('editor: prefers folderPath', () => {
    const ctx: PanelContext = {
      panelId: 'e1', panelType: 'editor',
      cwd: '/home/cwd', folderPath: '/home/folder', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/folder')
  })

  it('editor: falls back to projectPath', () => {
    const ctx: PanelContext = {
      panelId: 'e1', panelType: 'editor',
      cwd: '/home/cwd', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/proj')
  })

  it('editor: falls back to cwd', () => {
    const ctx: PanelContext = {
      panelId: 'e1', panelType: 'editor',
      cwd: '/home/cwd'
    }
    expect(explorerRootFor(ctx)).toBe('/home/cwd')
  })

  it('browser: prefers projectPath', () => {
    const ctx: PanelContext = {
      panelId: 'b1', panelType: 'browser',
      projectPath: '/home/proj', folderPath: '/home/folder'
    }
    expect(explorerRootFor(ctx)).toBe('/home/proj')
  })

  it('browser: falls back to folderPath', () => {
    const ctx: PanelContext = {
      panelId: 'b1', panelType: 'browser',
      folderPath: '/home/folder'
    }
    expect(explorerRootFor(ctx)).toBe('/home/folder')
  })

  it('browser: returns undefined with only cwd (no project or folder)', () => {
    const ctx: PanelContext = {
      panelId: 'b1', panelType: 'browser',
      cwd: '/home/cwd'
    }
    expect(explorerRootFor(ctx)).toBeUndefined()
  })

  it('region (default): prefers folderPath', () => {
    const ctx: PanelContext = {
      panelId: 'r1', panelType: 'region',
      cwd: '/home/cwd', folderPath: '/home/folder', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/folder')
  })

  it('region (default): falls back to projectPath', () => {
    const ctx: PanelContext = {
      panelId: 'r1', panelType: 'region',
      cwd: '/home/cwd', projectPath: '/home/proj'
    }
    expect(explorerRootFor(ctx)).toBe('/home/proj')
  })

  it('region (default): falls back to cwd', () => {
    const ctx: PanelContext = {
      panelId: 'r1', panelType: 'region',
      cwd: '/home/cwd'
    }
    expect(explorerRootFor(ctx)).toBe('/home/cwd')
  })
})
