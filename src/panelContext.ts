import { Panel, useWorkspaceStore } from './store/workspaceStore'

// Markers used to detect the "project root" for a given path. Order matters loosely —
// .git almost always wins because that's what users mean by "repo I'm working in."
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'requirements.txt'
]

export interface PanelContext {
  panelId: string
  panelType: Panel['type']
  cwd?: string
  folderPath?: string
  filePath?: string
  projectPath?: string
  repoRoot?: string
  notePath?: string
}

// Read context already attached to a panel. No filesystem walks here — that runs in main
// and the resolved values are cached back onto the panel via updatePanel({ projectPath, ... }).
export const readPanelContext = (p: Panel): PanelContext => {
  const settings = (p.settings || {}) as Record<string, unknown>
  const cwd = (p.cwd as string | undefined) ?? (settings.cwd as string | undefined)
  const folderPath = (p.folderPath as string | undefined) ?? (settings.folderPath as string | undefined)
  const filePath = (p.filePath as string | undefined) ?? (settings.filePath as string | undefined)
  const notePath = (p.notePath as string | undefined) ?? (settings.notePath as string | undefined)
  return {
    panelId: p.id,
    panelType: p.type,
    cwd,
    folderPath,
    filePath,
    notePath,
    projectPath: p.projectPath,
    repoRoot: p.repoRoot
  }
}

// Which panel does the sidebar follow right now?
//   1. single selection → that panel (if editor or terminal)
//   2. last-focused editor/terminal panel from MRU/history (sticky)
//   3. fallback → first editor/terminal panel
export const getActiveContextPanel = (): Panel | null => {
  const s = useWorkspaceStore.getState()
  
  // 1. Single selection if it's an editor or terminal
  if (s.selectedPanelIds.length === 1) {
    const p = s.panels[s.selectedPanelIds[0]]
    if (p && (p.type === 'editor' || p.type === 'terminal')) return p
  }

  // 2. Check MRU order for the most recently active editor or terminal
  const mruOrder = s.panelMruOrder || []
  for (const id of mruOrder) {
    const p = s.panels[id]
    if (p && (p.type === 'editor' || p.type === 'terminal')) return p
  }

  // 3. Last focused panel if it is an editor or terminal
  if (s.lastFocusedPanelId) {
    const p = s.panels[s.lastFocusedPanelId]
    if (p && (p.type === 'editor' || p.type === 'terminal')) return p
  }

  // 4. Fallback: Find any editor or terminal panel in the store
  const any = Object.values(s.panels).find(p => p.type === 'editor' || p.type === 'terminal')
  return any || null
}

// Best-effort starting path for the explorer/git sections.
// Priority depends on panel type:
//   terminal → cwd wins (follows cd / z / pushd in real time)
//   editor   → folderPath (the workspace user opened in code-server)
//   browser  → projectPath if associated, else nothing
//   note     → notePath dirname
//   else     → folderPath || projectPath || cwd
export const explorerRootFor = (ctx: PanelContext | null): string | undefined => {
  if (!ctx) return undefined
  switch (ctx.panelType) {
    case 'terminal':
      return ctx.cwd || ctx.folderPath || ctx.projectPath
    case 'editor':
      return ctx.folderPath || ctx.projectPath || ctx.cwd
    case 'browser':
      return ctx.projectPath || ctx.folderPath
    default:
      return ctx.folderPath || ctx.projectPath || ctx.cwd
  }
}

// Resolve project + repo roots for a panel using main-process fs walks.
// Caches results back onto the panel as projectPath / repoRoot.
export const resolvePanelRoots = async (panelId: string): Promise<void> => {
  const fs = window.electronAPI?.fs
  if (!fs) return
  const s = useWorkspaceStore.getState()
  const p = s.panels[panelId]
  if (!p) return
  const ctx = readPanelContext(p)
  const start = ctx.folderPath || ctx.cwd || (ctx.filePath ? await window.electronAPI?.file?.dirname?.(ctx.filePath) : undefined)
  if (!start) return
  const [projectRes, repoRes] = await Promise.all([
    fs.walkUp(start, PROJECT_MARKERS),
    fs.walkUp(start, ['.git'])
  ])
  // ALWAYS reconcile — if the walk returns no result, clear the old cached value so
  // moving from a git folder into a non-git folder doesn't leave stale repoRoot/projectPath
  // on the panel (sidebar would then keep showing the old repo's git status).
  const next: Partial<Panel> = {}
  const newProject = projectRes.ok ? projectRes.found || undefined : undefined
  const newRepo = repoRes.ok ? repoRes.found || undefined : undefined
  if (newProject !== p.projectPath) next.projectPath = newProject
  if (newRepo !== p.repoRoot) next.repoRoot = newRepo
  if (Object.keys(next).length > 0) {
    useWorkspaceStore.getState().updatePanel(panelId, next, { skipHistory: true })
  }
}
