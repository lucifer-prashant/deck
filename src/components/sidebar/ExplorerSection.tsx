import React, { useCallback, useEffect, useState, useRef } from 'react'
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
  onDone?: () => void
}

interface InlineAction {
  path: string
  type: 'rename' | 'new-file' | 'new-folder'
}

interface ExplorerContextType {
  rootPath: string
  selection: Map<string, boolean>
  onSelect: (path: string, isDir: boolean, e: React.MouseEvent) => void
  visiblePathsRef: React.MutableRefObject<Array<{ path: string; isDir: boolean }>>
  inlineAction: InlineAction | null
  setInlineAction: (action: InlineAction | null) => void
  searchQuery: string
  matchingPaths: Set<string>
  visiblePaths: Set<string>
  gitStatus: Map<string, 'added' | 'modified' | 'ignored'>
  triggerRefresh: () => void
}

const ExplorerContext = React.createContext<ExplorerContextType | null>(null)

const useExplorer = () => {
  const ctx = React.useContext(ExplorerContext)
  if (!ctx) throw new Error('useExplorer must be used within an ExplorerContext')
  return ctx
}

const HighlightedName: React.FC<{ name: string; query: string; highlight: boolean }> = ({ name, query, highlight }) => {
  if (!highlight || !query) return <span>{name}</span>
  const idx = name.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span>{name}</span>
  const before = name.slice(0, idx)
  const match = name.slice(idx, idx + query.length)
  const after = name.slice(idx + query.length)
  return (
    <span>
      {before}
      <mark className="tree-match-highlight">{match}</mark>
      {after}
    </span>
  )
}

const FileCtxMenu: React.FC<{ state: CtxState; onClose: () => void }> = ({ state, onClose }) => {
  const ref = React.useRef<HTMLDivElement>(null)
  const addPanel = useWorkspaceStore(s => s.addPanel)
  const viewport = useWorkspaceStore(s => s.viewport)
  const { rootPath, setInlineAction } = useExplorer()

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
      case 'rename':
        setInlineAction({ path: state.path, type: 'rename' })
        break
      case 'delete': {
        if (window.confirm(`Move "${state.path}" to trash?`)) {
          const r = await api?.trash?.(state.path)
          if (r && !r.ok) {
            if (window.confirm('Trash failed. Delete permanently?')) {
              await api?.delete?.(state.path)
            }
          }
          state.onDone?.()
        }
        break
      }
      case 'new-file':
        setInlineAction({ path: state.isDir ? state.path : state.parentDir, type: 'new-file' })
        break
      case 'new-folder':
        setInlineAction({ path: state.isDir ? state.path : state.parentDir, type: 'new-folder' })
        break
    }
    onClose()
  }

  const left = Math.max(6, Math.min(state.x, window.innerWidth - 240))
  const top = Math.max(6, Math.min(state.y, window.innerHeight - 380))

  const isRoot = state.path === rootPath

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
      {!isRoot && (
        <>
          <button className="ctx-item" onClick={() => run({ kind: 'reveal' })}><span>Reveal in File Manager</span></button>
          <button className="ctx-item" onClick={() => run({ kind: 'copy-path' })}><span>Copy Path</span></button>
          <div className="ctx-sep" />
        </>
      )}
      <button className="ctx-item" onClick={() => run({ kind: 'new-file' })}><span>New File…</span></button>
      <button className="ctx-item" onClick={() => run({ kind: 'new-folder' })}><span>New Folder…</span></button>
      {!isRoot && (
        <>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => run({ kind: 'rename' })}><span>Rename…</span><span className="ctx-kbd">F2</span></button>
          <button className="ctx-item danger" onClick={() => run({ kind: 'delete' })}><span>Move to Trash</span><span className="ctx-kbd">Del</span></button>
        </>
      )}
    </div>,
    document.body
  )
}

const ExplorerSection: React.FC<Props> = ({ rootPath, pinned, onTogglePin }) => {
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const [selection, setSelection] = useState<Map<string, boolean>>(new Map())
  const [lastSelected, setLastSelected] = useState<{ path: string; isDir: boolean } | null>(null)
  const [inlineAction, setInlineAction] = useState<InlineAction | null>(null)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [matchingPaths, setMatchingPaths] = useState<Set<string>>(new Set())
  const [visiblePaths, setVisiblePaths] = useState<Set<string>>(new Set())
  const [gitStatus, setGitStatus] = useState<Map<string, 'added' | 'modified' | 'ignored'>>(new Map())

  const visiblePathsRef = useRef<Array<{ path: string; isDir: boolean }>>([])
  visiblePathsRef.current = []

  useEffect(() => {
    setSelection(new Map())
    setLastSelected(null)
    setInlineAction(null)
    setSearchQuery('')
  }, [rootPath])

  useEffect(() => {
    if (!searchQuery.trim() || !rootPath) {
      setMatchingPaths(new Set())
      setVisiblePaths(new Set())
      return
    }
    const timer = setTimeout(async () => {
      const r = await window.electronAPI?.fs?.searchPaths(rootPath, searchQuery.trim())
      if (r?.ok && r.results) {
        const matches = new Set<string>()
        const vis = new Set<string>()
        r.results.forEach((p: string) => {
          matches.add(p)
          let cur = p
          while (cur && cur.startsWith(rootPath) && cur !== rootPath) {
            vis.add(cur)
            cur = cur.replace(/\/[^/]*$/, '')
          }
          vis.add(rootPath)
        })
        setMatchingPaths(matches)
        setVisiblePaths(vis)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery, rootPath])

  const loadGitStatus = useCallback(async () => {
    if (!rootPath) return
    const r = await window.electronAPI?.git?.status(rootPath)
    if (r?.ok && r.files) {
      const statusMap = new Map<string, 'added' | 'modified' | 'ignored'>()
      r.files.forEach(f => {
        const absPath = rootPath.endsWith('/') ? rootPath + f.path : rootPath + '/' + f.path
        const code = (f.staged + f.unstaged).trim()
        if (code.includes('!')) {
          statusMap.set(absPath, 'ignored')
        } else if (code.includes('?') || code.includes('A')) {
          statusMap.set(absPath, 'added')
        } else if (code.includes('M') || code.includes('R') || code.includes('C')) {
          statusMap.set(absPath, 'modified')
        }
      })
      setGitStatus(statusMap)
    } else {
      setGitStatus(new Map())
    }
  }, [rootPath])

  useEffect(() => {
    loadGitStatus()
    if (!rootPath) return
    const id = setInterval(loadGitStatus, 5000)
    return () => clearInterval(id)
  }, [rootPath, refreshKey, loadGitStatus])

  const onSelect = useCallback((path: string, isDir: boolean, e: React.MouseEvent) => {
    setSelection(prev => {
      const next = new Map(prev)
      if (e.ctrlKey || e.metaKey) {
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.set(path, isDir)
        }
        setLastSelected({ path, isDir })
      } else if (e.shiftKey && lastSelected) {
        const visible = visiblePathsRef.current
        const idxA = visible.findIndex(v => v.path === lastSelected.path)
        const idxB = visible.findIndex(v => v.path === path)
        if (idxA !== -1 && idxB !== -1) {
          const start = Math.min(idxA, idxB)
          const end = Math.max(idxA, idxB)
          for (let i = start; i <= end; i++) {
            next.set(visible[i].path, visible[i].isDir)
          }
        }
      } else {
        next.clear()
        next.set(path, isDir)
        setLastSelected({ path, isDir })
      }
      return next
    })
  }, [lastSelected])

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

  const contextValue: ExplorerContextType = {
    rootPath,
    selection,
    onSelect,
    visiblePathsRef,
    inlineAction,
    setInlineAction,
    searchQuery,
    matchingPaths,
    visiblePaths,
    gitStatus,
    triggerRefresh
  }

  const onSectionContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.tree-row')) return
    e.preventDefault()
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      path: rootPath, isDir: true,
      parentDir: rootPath.replace(/\/[^/]*$/, ''),
      onDone: triggerRefresh
    })
  }

  return (
    <ExplorerContext.Provider value={contextValue}>
      <div className="sidebar-section explorer-section" onContextMenu={onSectionContextMenu}>
        <div className="sidebar-section-head">
          <span className="sidebar-section-title" title={rootPath}>
            {rootPath.split('/').filter(Boolean).pop() || rootPath}
          </span>
          <button className={`sidebar-pin ${pinned ? 'on' : ''}`} onClick={onTogglePin} title={pinned ? 'Unpin (follow active panel)' : 'Pin to this folder'}>
            📌
          </button>
        </div>
        
        <div className="explorer-search-wrapper" style={{ padding: '8px 12px 4px 12px' }}>
          <input
            type="text"
            className="explorer-search-input"
            placeholder="Filter files (real-time)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('')
                e.currentTarget.blur()
              }
            }}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.25)',
              color: '#fff',
              fontSize: '11px',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div className="sidebar-section-body" style={{ padding: 0 }}>
          <TreeNode
            key={`${rootPath}:${refreshKey}`}
            path={rootPath}
            name={rootPath.split('/').filter(Boolean).pop() || rootPath}
            depth={0}
            defaultOpen
            onCtx={(x, y, p, isDir, onParentChange) => setCtxMenu({
              x, y, path: p, isDir,
              parentDir: isDir ? p.replace(/\/[^/]*$/, '') : p.replace(/\/[^/]*$/, ''),
              onDone: onParentChange
            })}
          />
        </div>
        {ctxMenu && <FileCtxMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
      </div>
    </ExplorerContext.Provider>
  )
}

type OnCtx = (x: number, y: number, path: string, isDir: boolean, onParentChange: () => void) => void

const TreeNode: React.FC<{
  path: string
  name: string
  depth: number
  defaultOpen?: boolean
  onCtx?: OnCtx
  onParentChange?: () => void
}> = ({ path, name, depth, defaultOpen, onCtx, onParentChange }) => {
  const [open, setOpen] = useState(!!defaultOpen)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string>('')

  const {
    selection, onSelect, visiblePathsRef, inlineAction, setInlineAction,
    searchQuery, matchingPaths, visiblePaths, gitStatus, triggerRefresh
  } = useExplorer()

  const isSearchActive = searchQuery.length > 0
  const isVisible = !isSearchActive || visiblePaths.has(path)

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

  useEffect(() => {
    if (isSearchActive && visiblePaths.has(path)) {
      setOpen(true)
    }
  }, [isSearchActive, visiblePaths, path])

  if (isVisible) {
    visiblePathsRef.current.push({ path, isDir: true })
  }

  const selected = selection.has(path)
  const status = gitStatus.get(path)
  const gitClass = status ? `git-${status}` : ''

  const isRenaming = inlineAction?.path === path && inlineAction.type === 'rename'

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyLink'
    const draggedItems = selection.has(path)
      ? Array.from(selection.entries()).map(([p, d]) => ({ path: p, isDir: d }))
      : [{ path, isDir: true }]
    e.dataTransfer.setData('application/x-wts-path', JSON.stringify({ items: draggedItems }))
    e.dataTransfer.setData('text/plain', draggedItems.map(item => item.path).join('\n'))
    e.stopPropagation()
  }

  const handleRenameCommit = async (val: string) => {
    const trimmed = val.trim()
    if (trimmed && trimmed !== name) {
      const parent = path.replace(/\/[^/]*$/, '')
      const target = parent + '/' + trimmed
      const r = await window.electronAPI?.fs?.rename(path, target)
      if (r && !r.ok) {
        window.alert('Rename failed: ' + r.error)
      } else {
        if (onParentChange) onParentChange()
        else triggerRefresh()
      }
    }
    setInlineAction(null)
  }

  const handleCreateCommit = async (val: string, type: 'new-file' | 'new-folder') => {
    const trimmed = val.trim()
    if (trimmed) {
      const target = path + '/' + trimmed
      const r = type === 'new-file'
        ? await window.electronAPI?.fs?.touch(target)
        : await window.electronAPI?.fs?.mkdir(target)
      if (r && !r.ok) {
        window.alert('Create failed: ' + r.error)
      } else {
        load()
      }
    }
    setInlineAction(null)
  }

  if (!isVisible) return null

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${selected ? 'selected' : ''} ${gitClass}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            onSelect(path, true, e)
          } else {
            setOpen(o => !o)
            onSelect(path, true, e)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(path, true, e)
          onCtx?.(e.clientX, e.clientY, path, true, onParentChange || load)
        }}
        draggable={!isRenaming}
        onDragStart={onDragStart}
        title={path}
      >
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-icon">📁</span>
        {isRenaming ? (
          <input
            autoFocus
            className="tree-inline-input"
            defaultValue={name}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameCommit(e.currentTarget.value)
              else if (e.key === 'Escape') setInlineAction(null)
            }}
            onBlur={(e) => handleRenameCommit(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name">
            <HighlightedName name={name} query={searchQuery} highlight={matchingPaths.has(path)} />
          </span>
        )}
      </div>
      {open && (
        <div className="tree-children">
          {inlineAction?.path === path && (inlineAction.type === 'new-file' || inlineAction.type === 'new-folder') && (
            <div className="tree-row new-item-row" style={{ paddingLeft: 4 + (depth + 1) * 12 }}>
              <span className="tree-caret invisible">·</span>
              <span className="tree-icon">{inlineAction.type === 'new-file' ? '·' : '📁'}</span>
              <input
                autoFocus
                className="tree-inline-input"
                placeholder={inlineAction.type === 'new-file' ? 'New file...' : 'New folder...'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCommit(e.currentTarget.value, inlineAction.type as 'new-file' | 'new-folder')
                  else if (e.key === 'Escape') setInlineAction(null)
                }}
                onBlur={(e) => handleCreateCommit(e.currentTarget.value, inlineAction.type as 'new-file' | 'new-folder')}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {error && <div className="tree-err">{error}</div>}
          {entries === null && !error && <div className="tree-loading" style={{ paddingLeft: 4 + (depth + 1) * 12 }}>…</div>}
          {entries && entries.length === 0 && <div className="tree-empty" style={{ paddingLeft: 4 + (depth + 1) * 12 }}>empty</div>}
          {entries?.map(e => e.isDir
            ? <TreeNode key={e.path} path={e.path} name={e.name} depth={depth + 1} onCtx={onCtx} onParentChange={load} />
            : <FileRow key={e.path} entry={e} depth={depth + 1} onCtx={onCtx} onParentChange={load} />
          )}
        </div>
      )}
    </div>
  )
}

const FileRow: React.FC<{
  entry: Entry
  depth: number
  onCtx?: OnCtx
  onParentChange?: () => void
}> = ({ entry, depth, onCtx, onParentChange }) => {
  const addPanel = useWorkspaceStore(s => s.addPanel)
  const viewport = useWorkspaceStore(s => s.viewport)

  const {
    selection, onSelect, visiblePathsRef, inlineAction, setInlineAction,
    searchQuery, matchingPaths, visiblePaths, gitStatus, triggerRefresh
  } = useExplorer()

  const isSearchActive = searchQuery.length > 0
  const isVisible = !isSearchActive || visiblePaths.has(entry.path)

  if (isVisible) {
    visiblePathsRef.current.push({ path: entry.path, isDir: false })
  }

  const selected = selection.has(entry.path)
  const status = gitStatus.get(entry.path)
  const gitClass = status ? `git-${status}` : ''

  const isRenaming = inlineAction?.path === entry.path && inlineAction.type === 'rename'

  const onDragStart = (e: React.DragEvent, path: string, isDir: boolean) => {
    e.dataTransfer.effectAllowed = 'copyLink'
    const draggedItems = selection.has(path)
      ? Array.from(selection.entries()).map(([p, d]) => ({ path: p, isDir: d }))
      : [{ path, isDir }]
    e.dataTransfer.setData('application/x-wts-path', JSON.stringify({ items: draggedItems }))
    e.dataTransfer.setData('text/plain', draggedItems.map(item => item.path).join('\n'))
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

  const handleRenameCommit = async (val: string) => {
    const trimmed = val.trim()
    if (trimmed && trimmed !== entry.name) {
      const parent = entry.path.replace(/\/[^/]*$/, '')
      const target = parent + '/' + trimmed
      const r = await window.electronAPI?.fs?.rename(entry.path, target)
      if (r && !r.ok) {
        window.alert('Rename failed: ' + r.error)
      } else {
        if (onParentChange) onParentChange()
        else triggerRefresh()
      }
    }
    setInlineAction(null)
  }

  if (!isVisible) return null

  return (
    <div
      className={`tree-row file ${selected ? 'selected' : ''} ${gitClass}`}
      style={{ paddingLeft: 4 + depth * 12 }}
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart(e, entry.path, false)}
      onDoubleClick={openInEditor}
      onClick={(e) => onSelect(entry.path, false, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(entry.path, false, e)
        onCtx?.(e.clientX, e.clientY, entry.path, false, onParentChange || (() => {}))
      }}
      title={entry.path}
    >
      <span className="tree-caret invisible">·</span>
      <span className="tree-icon">{fileIcon(entry.name)}</span>
      {isRenaming ? (
        <input
          autoFocus
          className="tree-inline-input"
          defaultValue={entry.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameCommit(e.currentTarget.value)
            else if (e.key === 'Escape') setInlineAction(null)
          }}
          onBlur={(e) => handleRenameCommit(e.currentTarget.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tree-name">
          <HighlightedName name={entry.name} query={searchQuery} highlight={matchingPaths.has(entry.path)} />
        </span>
      )}
    </div>
  )
}

export default ExplorerSection
