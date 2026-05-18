import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../../store/workspaceStore'

interface Props {
  rootPath?: string
  pinned: boolean
  onTogglePin: () => void
}

interface Entry { name: string; path: string; isDir: boolean; isSymlink: boolean }

const FILE_ICONS: Record<string, string> = {
  ts: '𝐓', tsx: '𝐓', js: 'J', jsx: 'J', mjs: 'J', cjs: 'J',
  py: '🐍', rb: '◆', go: '◇', rs: '◉', java: '☕', kt: '◔',
  c: 'C', h: 'H', cpp: '+', cc: '+', cs: '#', php: 'P', lua: 'L',
  json: '{ }', yaml: '⌘', yml: '⌘', toml: '⌘', ini: '⚙',
  md: '✎', mdx: '✎', html: '◐', xml: '◐', css: '◊', scss: '◊', less: '◊',
  sh: '$', bash: '$', zsh: '$', sql: '⛁',
  png: '◖', jpg: '◖', jpeg: '◖', gif: '◖', svg: '◖', webp: '◖',
  pdf: '◧', zip: '⊟', tar: '⊟', gz: '⊟',
  lock: '🔒', env: '∗', gitignore: '⊘'
}
const fileIcon = (name: string): string => {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return '🐳'
  if (lower === 'makefile') return '⚒'
  if (lower === 'readme' || lower.startsWith('readme.')) return '★'
  if (lower === 'license' || lower === 'license.md' || lower === 'license.txt') return '§'
  const m = lower.match(/\.([a-z0-9]+)$/)
  if (!m) return '·'
  return FILE_ICONS[m[1]] || '·'
}

type CtxAction =
  | { kind: 'open-editor' }
  | { kind: 'open-new-editor' }
  | { kind: 'open-terminal' }
  | { kind: 'open-new-terminal' }
  | { kind: 'reveal' }
  | { kind: 'copy-path' }
  | { kind: 'rename' }
  | { kind: 'delete' }
  | { kind: 'new-file' }
  | { kind: 'new-folder' }

interface CtxState {
  x: number; y: number
  path: string
  isDir: boolean
  parentDir: string
  onChange?: () => void
}

const FileCtxMenu: React.FC<{ state: CtxState; onClose: () => void }> = ({ state, onClose }) => {
  const ref = React.useRef<HTMLDivElement>(null)
  const addPanel = useWorkspaceStore(s => s.addPanel)
  const viewport = useWorkspaceStore(s => s.viewport)

  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', h, true)
    window.addEventListener('contextmenu', h, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', h, true)
      window.removeEventListener('contextmenu', h, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const spawnTerminal = (cwd: string) => {
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom
    addPanel({
      id, type: 'terminal',
      x: cx - 300, y: cy - 200, width: 600, height: 400,
      title: cwd.split('/').filter(Boolean).pop() || 'terminal',
      settings: { cwd }, createdAt: Date.now()
    })
  }

  const spawnEditor = (filePath: string) => {
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom
    addPanel({
      id, type: 'editor',
      x: cx - 400, y: cy - 250, width: 800, height: 500,
      title: filePath.split('/').pop() || 'editor',
      settings: { filePath, folderPath: state.parentDir }, createdAt: Date.now()
    })
  }

  const run = async (a: CtxAction) => {
    const api = window.electronAPI?.fs
    switch (a.kind) {
      case 'open-editor':
        spawnEditor(state.path); break
      case 'open-new-editor':
        spawnEditor(state.path); break
      case 'open-terminal':
        spawnTerminal(state.isDir ? state.path : state.parentDir); break
      case 'open-new-terminal':
        spawnTerminal(state.isDir ? state.path : state.parentDir); break
      case 'reveal':
        api?.reveal?.(state.path); break
      case 'copy-path':
        navigator.clipboard?.writeText(state.path); break
      case 'rename': {
        const cur = state.path.split('/').pop() || ''
        const next = window.prompt('Rename to:', cur)
        if (next && next.trim() && next !== cur && api?.rename) {
          const target = state.parentDir + '/' + next.trim()
          const r = await api.rename(state.path, target)
          if (!r.ok) window.alert('Rename failed: ' + r.error)
          else state.onChange?.()
        }
        break
      }
      case 'delete': {
        if (window.confirm(`Move "${state.path}" to trash?`)) {
          const r = await api?.trash?.(state.path)
          if (r && !r.ok) {
            if (window.confirm('Trash failed. Delete permanently?')) {
              await api?.delete?.(state.path)
            }
          }
          state.onChange?.()
        }
        break
      }
      case 'new-file': {
        const name = window.prompt('New file name:')
        if (name && name.trim() && api?.touch) {
          const target = (state.isDir ? state.path : state.parentDir) + '/' + name.trim()
          const r = await api.touch(target)
          if (!r.ok) window.alert('Create failed: ' + r.error)
          else state.onChange?.()
        }
        break
      }
      case 'new-folder': {
        const name = window.prompt('New folder name:')
        if (name && name.trim() && api?.mkdir) {
          const target = (state.isDir ? state.path : state.parentDir) + '/' + name.trim()
          const r = await api.mkdir(target)
          if (!r.ok) window.alert('Create failed: ' + r.error)
          else state.onChange?.()
        }
        break
      }
    }
    onClose()
  }

  const left = Math.max(6, Math.min(state.x, window.innerWidth - 240))
  const top = Math.max(6, Math.min(state.y, window.innerHeight - 380))

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left, top, minWidth: 224 }} onContextMenu={(e) => e.preventDefault()}>
      {!state.isDir && (
        <>
          <button className="ctx-item" onClick={() => run({ kind: 'open-editor' })}><span>Open in Editor</span></button>
          <button className="ctx-item" onClick={() => run({ kind: 'open-new-editor' })}><span>Open in New Editor</span></button>
          <div className="ctx-sep" />
        </>
      )}
      <button className="ctx-item" onClick={() => run({ kind: 'open-terminal' })}><span>Open Terminal Here</span></button>
      <button className="ctx-item" onClick={() => run({ kind: 'open-new-terminal' })}><span>Open New Terminal Here</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => run({ kind: 'reveal' })}><span>Reveal in File Manager</span></button>
      <button className="ctx-item" onClick={() => run({ kind: 'copy-path' })}><span>Copy Path</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => run({ kind: 'new-file' })}><span>New File…</span></button>
      <button className="ctx-item" onClick={() => run({ kind: 'new-folder' })}><span>New Folder…</span></button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => run({ kind: 'rename' })}><span>Rename…</span><span className="ctx-kbd">F2</span></button>
      <button className="ctx-item danger" onClick={() => run({ kind: 'delete' })}><span>Move to Trash</span><span className="ctx-kbd">Del</span></button>
    </div>,
    document.body
  )
}

const ExplorerSection: React.FC<Props> = ({ rootPath, pinned, onTogglePin }) => {
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), [])

  if (!rootPath) {
    return (
      <div className="sidebar-section">
        <div className="sidebar-section-head">
          <span className="sidebar-section-title">Explorer</span>
        </div>
        <div className="sidebar-section-body" style={{ opacity: 0.55 }}>
          No folder in active context. Open a folder in an editor or set a terminal cwd.
        </div>
      </div>
    )
  }
  return (
    <div className="sidebar-section explorer-section">
      <div className="sidebar-section-head">
        <span className="sidebar-section-title" title={rootPath}>
          {rootPath.split('/').filter(Boolean).pop() || rootPath}
        </span>
        <button className={`sidebar-pin ${pinned ? 'on' : ''}`} onClick={onTogglePin} title={pinned ? 'Unpin (follow active panel)' : 'Pin to this folder'}>
          📌
        </button>
      </div>
      <div className="sidebar-section-body" style={{ padding: 0 }}>
        {/* Key by rootPath so the tree remounts cleanly when the active panel's
            folder/cwd changes — no stale entries from the previous root. */}
        <TreeNode
          key={`${rootPath}:${refreshKey}`}
          path={rootPath}
          name={rootPath.split('/').filter(Boolean).pop() || rootPath}
          depth={0}
          defaultOpen
          onCtx={(x, y, p, isDir) => setCtxMenu({
            x, y, path: p, isDir,
            parentDir: isDir ? p.replace(/\/[^/]*$/, '') : p.replace(/\/[^/]*$/, ''),
            onChange: triggerRefresh
          })}
        />
      </div>
      {ctxMenu && <FileCtxMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
    </div>
  )
}

type OnCtx = (x: number, y: number, path: string, isDir: boolean) => void

const TreeNode: React.FC<{ path: string; name: string; depth: number; defaultOpen?: boolean; onCtx?: OnCtx }> = ({ path, name, depth, defaultOpen, onCtx }) => {
  const [open, setOpen] = useState(!!defaultOpen)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string>('')

  const load = useCallback(async () => {
    const api = window.electronAPI?.fs
    if (!api) return
    const r = await api.listDir(path)
    if (r.ok && r.entries) {
      setEntries(r.entries.filter(e => !e.name.startsWith('.') || e.name === '.gitignore' || e.name === '.env.example'))
      setError('')
    } else {
      setError(r.error || 'read failed')
    }
  }, [path])

  useEffect(() => {
    if (open && entries === null) load()
  }, [open, entries, load])

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyLink'
    e.dataTransfer.setData('application/x-wts-path', JSON.stringify({ path, isDir: true }))
    e.dataTransfer.setData('text/plain', path)
    e.stopPropagation()
  }

  return (
    <div className="tree-node">
      <div
        className="tree-row"
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => setOpen(o => !o)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtx?.(e.clientX, e.clientY, path, true) }}
        draggable
        onDragStart={onDragStart}
        title={path}
      >
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-icon">📁</span>
        <span className="tree-name">{name}</span>
      </div>
      {open && (
        <div className="tree-children">
          {error && <div className="tree-err">{error}</div>}
          {entries === null && !error && <div className="tree-loading" style={{ paddingLeft: 4 + (depth + 1) * 12 }}>…</div>}
          {entries && entries.length === 0 && <div className="tree-empty" style={{ paddingLeft: 4 + (depth + 1) * 12 }}>empty</div>}
          {entries?.map(e => e.isDir
            ? <TreeNode key={e.path} path={e.path} name={e.name} depth={depth + 1} onCtx={onCtx} />
            : <FileRow key={e.path} entry={e} depth={depth + 1} onCtx={onCtx} />
          )}
        </div>
      )}
    </div>
  )
}

const FileRow: React.FC<{ entry: Entry; depth: number; onCtx?: OnCtx }> = ({ entry, depth, onCtx }) => {
  const addPanel = useWorkspaceStore(s => s.addPanel)
  const viewport = useWorkspaceStore(s => s.viewport)

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyLink'
    e.dataTransfer.setData('application/x-wts-path', JSON.stringify({ path: entry.path, isDir: false }))
    e.dataTransfer.setData('text/plain', entry.path)
  }
  const openInEditor = () => {
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.zoom
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.zoom
    addPanel({
      id, type: 'editor',
      x: cx - 400, y: cy - 250, width: 800, height: 500,
      title: entry.name,
      settings: { filePath: entry.path, folderPath: entry.path.replace(/\/[^/]*$/, '') },
      createdAt: Date.now()
    })
  }
  return (
    <div
      className="tree-row file"
      style={{ paddingLeft: 4 + depth * 12 }}
      draggable
      onDragStart={onDragStart}
      onDoubleClick={openInEditor}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtx?.(e.clientX, e.clientY, entry.path, false) }}
      title={entry.path}
    >
      <span className="tree-caret invisible">·</span>
      <span className="tree-icon">{fileIcon(entry.name)}</span>
      <span className="tree-name">{entry.name}</span>
    </div>
  )
}

export default ExplorerSection
