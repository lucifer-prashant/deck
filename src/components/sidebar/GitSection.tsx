import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../../store/workspaceStore'
import '../GlobalSearch.css'

interface Props {
  repoRoot?: string
  pinned: boolean
  onTogglePin: () => void
}

interface GitFile { path: string; staged: string; unstaged: string }
interface GitWorktree { path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }
interface GitStatus {
  branch: string
  ahead: number
  behind: number
  hasUpstream: boolean
  files: GitFile[]
  worktrees: GitWorktree[]
}

const STAGED_CODES: Record<string, string> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict'
}
const UNSTAGED_CODES: Record<string, string> = {
  M: 'modified', D: 'deleted', '?': 'untracked', U: 'conflict'
}

const fileLabel = (f: GitFile): string => {
  if (f.staged === '?' && f.unstaged === '?') return 'untracked'
  if (f.staged !== ' ' && f.unstaged !== ' ') {
    return `${STAGED_CODES[f.staged] || f.staged} + ${UNSTAGED_CODES[f.unstaged] || f.unstaged}`
  }
  if (f.staged !== ' ') return STAGED_CODES[f.staged] || f.staged
  return UNSTAGED_CODES[f.unstaged] || f.unstaged
}

const fileGroup = (f: GitFile): 'staged' | 'changed' | 'untracked' | 'ignored' => {
  if (f.staged === '!' || f.unstaged === '!') return 'ignored'
  if (f.staged === '?' && f.unstaged === '?') return 'untracked'
  if (f.staged !== ' ' && f.staged !== '?') return 'staged'
  return 'changed'
}

const GitSection: React.FC<Props> = ({ repoRoot, pinned, onTogglePin }) => {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [diffPath, setDiffPath] = useState<{ path: string; staged: boolean } | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitNotice, setCommitNotice] = useState('')
  const repoRootRef = useRef(repoRoot)
  useEffect(() => { repoRootRef.current = repoRoot }, [repoRoot])

  const refresh = useCallback(async () => {
    if (!repoRoot) { setStatus(null); setError(''); return }
    const api = window.electronAPI?.git
    if (!api) { setError('git bridge unavailable'); return }
    const captured = repoRoot
    setLoading(true)
    setError('')
    const r = await api.status(captured)
    // Discard if user switched repos while we were awaiting — prevents stale data flash.
    if (captured !== repoRootRef.current) return
    setLoading(false)
    if (r.ok) {
      setStatus({
        branch: r.branch || '(detached)',
        ahead: r.ahead || 0,
        behind: r.behind || 0,
        hasUpstream: !!r.hasUpstream,
        files: r.files || [],
        worktrees: r.worktrees || []
      })
    } else {
      setError(r.error || 'git status failed')
      setStatus(null)
    }
  }, [repoRoot])

  // Reset state immediately when switching repos so we don't flash stale info.
  useEffect(() => {
    setStatus(null)
    setError('')
    setCommitNotice('')
    refresh()
  }, [repoRoot, refresh])

  // Light auto-refresh every 5s while a repo is in view.
  useEffect(() => {
    if (!repoRoot) return
    const id = window.setInterval(refresh, 5000)
    return () => window.clearInterval(id)
  }, [repoRoot, refresh])

  const stage = useCallback(async (paths: string[]) => {
    if (!repoRoot) return
    const r = await window.electronAPI?.git?.stage(repoRoot, paths)
    if (r?.ok) refresh()
    else if (r?.error) setError(r.error)
  }, [repoRoot, refresh])

  const unstage = useCallback(async (paths: string[]) => {
    if (!repoRoot) return
    const r = await window.electronAPI?.git?.unstage(repoRoot, paths)
    if (r?.ok) refresh()
    else if (r?.error) setError(r.error)
  }, [repoRoot, refresh])

  const commit = useCallback(async () => {
    if (!repoRoot || !commitMsg.trim()) return
    setCommitting(true)
    const r = await window.electronAPI?.git?.commit(repoRoot, commitMsg.trim())
    setCommitting(false)
    if (r?.ok) {
      setCommitNotice('committed')
      setCommitMsg('')
      refresh()
      window.setTimeout(() => setCommitNotice(''), 2000)
    } else {
      setError(r?.error || 'commit failed')
    }
  }, [repoRoot, commitMsg, refresh])

  if (!repoRoot) {
    return (
      <div className="sidebar-section git-section">
        <div className="sidebar-section-head">
          <span className="sidebar-section-title">Git</span>
        </div>
        <div className="sidebar-section-body" style={{ opacity: 0.55 }}>
          No repo in active context. Focus a panel inside a Git repo.
        </div>
      </div>
    )
  }

  const staged = status?.files.filter(f => fileGroup(f) === 'staged') || []
  const changed = status?.files.filter(f => fileGroup(f) === 'changed') || []
  const untracked = status?.files.filter(f => fileGroup(f) === 'untracked') || []
  const canCommit = staged.length > 0 && commitMsg.trim().length > 0 && !committing

  const copyPath = (p: string) => {
    navigator.clipboard.writeText(`${repoRoot}/${p}`).catch(() => {})
  }

  return (
    <div className="sidebar-section git-section">
      <div className="sidebar-section-head">
        <span className="sidebar-section-title" title={repoRoot}>
          {repoRoot.split('/').filter(Boolean).pop() || repoRoot}
        </span>
        <button
          className="sidebar-pin"
          onClick={refresh}
          title="Refresh"
        >{loading ? '↻' : '⟳'}</button>
        <button
          className={`sidebar-pin ${pinned ? 'on' : ''}`}
          onClick={onTogglePin}
          title={pinned ? 'Unpin (follow active panel)' : 'Pin to this repo'}
        >📌</button>
      </div>

      {error && <div className="git-error">{error}</div>}

      {status && (
        <>
          <BranchBar repoRoot={repoRoot} status={status} onChange={refresh} onError={setError} />

          {status.files.length === 0 && (
            <div className="git-clean">working tree clean</div>
          )}

          {staged.length > 0 && (
            <GroupView
              title={`Staged (${staged.length})`}
              files={staged}
              tone="staged"
              actionLabel="−"
              actionTitle="Unstage"
              onAction={(p) => unstage([p])}
              onCopy={copyPath}
              onDiff={(p) => setDiffPath({ path: p, staged: true })}
            />
          )}
          {changed.length > 0 && (
            <GroupView
              title={`Changes (${changed.length})`}
              files={changed}
              tone="changed"
              actionLabel="+"
              actionTitle="Stage"
              onAction={(p) => stage([p])}
              onCopy={copyPath}
              onDiff={(p) => setDiffPath({ path: p, staged: false })}
            />
          )}
          {untracked.length > 0 && (
            <GroupView
              title={`Untracked (${untracked.length})`}
              files={untracked}
              tone="untracked"
              actionLabel="+"
              actionTitle="Stage"
              onAction={(p) => stage([p])}
              onCopy={copyPath}
            />
          )}

          {(staged.length > 0 || changed.length > 0) && (
            <div className="git-actions-row">
              {changed.length > 0 && (
                <button
                  className="git-btn"
                  onClick={() => stage(changed.map(f => f.path))}
                  title="git add (all changes)"
                >stage all</button>
              )}
              {staged.length > 0 && (
                <button
                  className="git-btn"
                  onClick={() => unstage(staged.map(f => f.path))}
                  title="git restore --staged"
                >unstage all</button>
              )}
            </div>
          )}

          <div className="git-commit-box">
            <textarea
              className="git-commit-input"
              placeholder={staged.length === 0 ? 'stage files first…' : 'commit message'}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit) {
                  e.preventDefault()
                  commit()
                }
                e.stopPropagation()
              }}
              spellCheck={false}
              rows={2}
            />
            <div className="git-commit-actions">
              <span className="git-commit-hint">Ctrl+Enter to commit</span>
              <button
                className={`git-btn primary ${canCommit ? '' : 'disabled'}`}
                onClick={commit}
                disabled={!canCommit}
              >{committing ? '…' : 'commit'}</button>
            </div>
            {commitNotice && <div className="git-commit-notice">{commitNotice}</div>}
          </div>

          <WorktreesPanel
            repoRoot={repoRoot}
            worktrees={status.worktrees}
            onChange={refresh}
            onError={setError}
          />

          <StashPanel repoRoot={repoRoot} onError={setError} />
        </>
      )}

      {diffPath && (
        <DiffModal
          repoRoot={repoRoot}
          path={diffPath.path}
          staged={diffPath.staged}
          onClose={() => setDiffPath(null)}
        />
      )}
    </div>
  )
}

const BranchBar: React.FC<{
  repoRoot: string
  status: GitStatus
  onChange: () => void
  onError: (msg: string) => void
}> = ({ repoRoot, status, onChange, onError }) => {
  const [branches, setBranches] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<'fetch' | 'pull' | 'push' | null>(null)

  const loadBranches = useCallback(async () => {
    const r = await window.electronAPI?.git?.branches(repoRoot)
    if (r?.ok && r.branches) setBranches(r.branches)
  }, [repoRoot])

  useEffect(() => { if (picking) loadBranches() }, [picking, loadBranches])

  const checkout = async (b: string) => {
    const r = await window.electronAPI?.git?.checkout(repoRoot, b)
    setPicking(false)
    if (r?.ok) onChange()
    else onError(r?.error || 'checkout failed')
  }
  const createBranch = async () => {
    const name = window.prompt('New branch name:')
    if (!name?.trim()) return
    const r = await window.electronAPI?.git?.checkout(repoRoot, name.trim(), true)
    setPicking(false)
    if (r?.ok) onChange()
    else onError(r?.error || 'create failed')
  }

  const doFetch = async () => {
    setBusy('fetch')
    const r = await window.electronAPI?.git?.fetch(repoRoot)
    setBusy(null)
    if (r?.ok) onChange()
    else onError(r?.error || 'fetch failed')
  }
  const doPull = async () => {
    setBusy('pull')
    const r = await window.electronAPI?.git?.pull(repoRoot)
    setBusy(null)
    if (r?.ok) onChange()
    else onError(r?.error || 'pull failed')
  }
  const doPush = async () => {
    setBusy('push')
    const r = await window.electronAPI?.git?.push(repoRoot, !status.hasUpstream)
    setBusy(null)
    if (r?.ok) onChange()
    else onError(r?.error || 'push failed')
  }

  return (
    <>
      <div className="git-branch-row" style={{ position: 'relative' }}>
        <button
          className="git-branch-pill"
          onClick={() => setPicking(p => !p)}
          title="Switch branch"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(77,171,232,0.12)', border: '1px solid rgba(77,171,232,0.3)',
            color: '#9ed1ff', padding: '2px 10px', borderRadius: 999, fontSize: 11.5,
            cursor: 'pointer', fontFamily: 'inherit'
          }}
        >
          <span style={{ opacity: 0.7 }}>⎇</span>
          <span style={{ fontWeight: 600 }}>{status.branch}</span>
          <span style={{ opacity: 0.55 }}>▾</span>
        </button>
        {status.hasUpstream && (
          <>
            {status.ahead > 0 && <span className="git-chip up">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="git-chip down">↓{status.behind}</span>}
            {status.ahead === 0 && status.behind === 0 && <span className="git-chip clean">in sync</span>}
          </>
        )}
        {!status.hasUpstream && status.branch !== '(detached)' && (
          <span className="git-chip muted">no upstream</span>
        )}
        <div style={{ flex: 1 }} />
        <button className="git-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={doFetch} disabled={busy !== null} title="git fetch --all --prune">
          {busy === 'fetch' ? '…' : '⤓'}
        </button>
        <button className="git-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={doPull} disabled={busy !== null} title="git pull --ff-only">
          {busy === 'pull' ? '…' : '↓'}
        </button>
        <button className="git-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={doPush} disabled={busy !== null} title={status.hasUpstream ? 'git push' : 'git push -u origin HEAD'}>
          {busy === 'push' ? '…' : '↑'}
        </button>
      </div>
      {picking && (
        <div className="git-branch-picker" style={{
          maxHeight: 220, overflowY: 'auto', margin: '4px 0',
          background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, padding: 4
        }}>
          {branches.length === 0 && <div style={{ padding: '6px 10px', opacity: 0.5, fontSize: 11 }}>loading…</div>}
          {branches.map(b => (
            <button
              key={b}
              onClick={() => checkout(b)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '4px 10px', border: 'none', background: 'transparent',
                color: b === status.branch ? '#9ed1ff' : 'inherit',
                fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 4
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(77,171,232,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {b === status.branch ? '● ' : '○ '}{b}
            </button>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 4 }}>
            <button
              onClick={createBranch}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '4px 10px', border: 'none', background: 'transparent',
                color: '#9ed1ff', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 4
              }}
            >+ new branch…</button>
          </div>
        </div>
      )}
    </>
  )
}

const StashPanel: React.FC<{ repoRoot: string; onError: (msg: string) => void }> = ({ repoRoot, onError }) => {
  const [stashes, setStashes] = useState<Array<{ ref: string; message: string }>>([])
  const [show, setShow] = useState(false)

  const load = useCallback(async () => {
    const r = await window.electronAPI?.git?.stashList(repoRoot)
    if (r?.ok && r.stashes) setStashes(r.stashes)
  }, [repoRoot])

  useEffect(() => { load() }, [load])

  const stashAll = async () => {
    const msg = window.prompt('Stash message (optional):') || undefined
    const r = await window.electronAPI?.git?.stashSave(repoRoot, msg)
    if (r?.ok) load()
    else onError(r?.error || 'stash failed')
  }
  const pop = async (ref: string) => {
    const r = await window.electronAPI?.git?.stashPop(repoRoot, ref)
    if (r?.ok) load()
    else onError(r?.error || 'pop failed')
  }
  const drop = async (ref: string) => {
    if (!window.confirm(`Drop ${ref}?`)) return
    const r = await window.electronAPI?.git?.stashDrop(repoRoot, ref)
    if (r?.ok) load()
    else onError(r?.error || 'drop failed')
  }

  if (stashes.length === 0 && !show) return null

  return (
    <div className="git-stash" style={{ marginTop: 6 }}>
      <div className="git-group-head" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1 }}>Stash ({stashes.length})</span>
        <button className="git-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={stashAll}>stash all</button>
        <button className="git-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShow(s => !s)}>{show ? 'hide' : 'show'}</button>
      </div>
      {show && stashes.map(s => (
        <div key={s.ref} className="git-stash-row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 11.5 }}>
          <span style={{ flex: 1, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.message}>{s.message}</span>
          <button className="git-file-action" title="Pop" onClick={() => pop(s.ref)}>↑</button>
          <button className="git-file-action" title="Drop" onClick={() => drop(s.ref)}>×</button>
        </div>
      ))}
    </div>
  )
}

const DiffModal: React.FC<{ repoRoot: string; path: string; staged: boolean; onClose: () => void }> = ({ repoRoot, path, staged, onClose }) => {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.electronAPI?.git?.diff(repoRoot, path, staged).then(r => {
      setLoading(false)
      setDiff(r?.diff || r?.error || '(no diff)')
    })
  }, [repoRoot, path, staged])

  return createPortal(
    <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gs-panel" style={{ width: 'min(900px, calc(100vw - 64px))' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="gs-head">
          <span className="gs-icon">±</span>
          <span style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}>{path}{staged ? ' (staged)' : ''}</span>
          <button className="gs-close" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {loading && <div className="gs-empty">loading diff…</div>}
          {!loading && (
            <pre style={{
              margin: 0, padding: '0 16px', fontSize: 11.5,
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
              whiteSpace: 'pre', overflowX: 'auto'
            }}>
              {diff.split('\n').map((line, i) => {
                let color = 'inherit'
                if (line.startsWith('+') && !line.startsWith('+++')) color = '#86db8f'
                else if (line.startsWith('-') && !line.startsWith('---')) color = '#f48fb1'
                else if (line.startsWith('@@')) color = '#8ab4f8'
                else if (line.startsWith('diff ') || line.startsWith('index ')) color = 'rgba(255,255,255,0.4)'
                return <div key={i} style={{ color }}>{line || ' '}</div>
              })}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

const WorktreesPanel: React.FC<{
  repoRoot: string
  worktrees: GitWorktree[]
  onChange: () => void
  onError: (msg: string) => void
}> = ({ repoRoot, worktrees, onChange, onError }) => {
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [branch, setBranch] = useState('')
  const [newBranch, setNewBranch] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!adding) return
    window.electronAPI?.git?.branches(repoRoot).then(r => {
      if (r.ok && r.branches) setBranches(r.branches)
    })
  }, [adding, repoRoot])

  const pickDir = async () => {
    const r = await window.electronAPI?.git?.pickWorktreeDir(repoRoot)
    if (r?.ok && r.path) setPath(r.path)
  }

  const create = async () => {
    if (!path.trim() || !branch.trim()) return
    setBusy(true)
    const r = await window.electronAPI?.git?.worktreeAdd(repoRoot, path.trim(), branch.trim(), newBranch)
    setBusy(false)
    if (r?.ok) {
      setAdding(false)
      setPath(''); setBranch(''); setNewBranch(false)
      onChange()
    } else onError(r?.error || 'worktree add failed')
  }

  const remove = async (wtPath: string) => {
    if (wtPath === repoRoot) {
      onError('cannot remove the active worktree')
      return
    }
    const force = window.confirm(`Remove worktree at ${wtPath}?\n\nOK = remove (will use --force if needed).`)
    if (!force) return
    const r = await window.electronAPI?.git?.worktreeRemove(repoRoot, wtPath, true)
    if (r?.ok) onChange()
    else onError(r?.error || 'worktree remove failed')
  }

  const setSidebarPin = useWorkspaceStore(s => s.setSidebarPin)
  const openInExplorer = (wtPath: string) => {
    // Pin sidebar explorer + git to that worktree so all sections follow.
    setSidebarPin('explorer', wtPath)
    setSidebarPin('git', wtPath)
  }

  return (
    <div className="git-worktrees">
      <div className="git-group-head" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1 }}>Worktrees ({worktrees.length})</span>
        <button
          className="git-btn"
          style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={() => setAdding(v => !v)}
          title="Add worktree"
        >{adding ? '×' : '+ new'}</button>
      </div>
      {worktrees.map(w => {
        const label = w.branch || (w.detached ? 'detached' : (w.bare ? 'bare' : 'main'))
        const isActive = w.path === repoRoot
        return (
          <div className="git-worktree-row" key={w.path} title={w.path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="git-worktree-name" style={{ flex: '0 0 auto', opacity: isActive ? 1 : 0.85 }}>
              {isActive ? '● ' : '○ '}{label}
            </span>
            <span className="git-worktree-path" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.6 }}>
              {w.path.replace(/^.*\//, '')}
            </span>
            {!isActive && (
              <>
                <button
                  className="git-file-action"
                  title="Pin sidebar to this worktree"
                  onClick={() => openInExplorer(w.path)}
                >→</button>
                <button
                  className="git-file-action"
                  title="Remove worktree"
                  onClick={() => remove(w.path)}
                >×</button>
              </>
            )}
          </div>
        )
      })}
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="git-commit-input"
              style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
              placeholder="path (e.g. ../feature-x)"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
            />
            <button className="git-btn" style={{ padding: '2px 8px' }} onClick={pickDir} title="Pick folder">…</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="git-commit-input"
              style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
              placeholder={newBranch ? 'new branch name' : 'existing branch'}
              value={branch}
              list="wts-branches"
              onChange={(e) => setBranch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
            />
            <datalist id="wts-branches">
              {branches.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.8 }}>
            <input type="checkbox" checked={newBranch} onChange={(e) => setNewBranch(e.target.checked)} />
            create new branch
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`git-btn primary ${(!path.trim() || !branch.trim() || busy) ? 'disabled' : ''}`}
              disabled={!path.trim() || !branch.trim() || busy}
              onClick={create}
            >{busy ? '…' : 'create worktree'}</button>
            <button className="git-btn" onClick={() => setAdding(false)}>cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

interface GroupProps {
  title: string
  files: GitFile[]
  tone: 'staged' | 'changed' | 'untracked'
  actionLabel: string
  actionTitle: string
  onAction: (path: string) => void
  onCopy: (path: string) => void
  onDiff?: (path: string) => void
}

const GroupView: React.FC<GroupProps> = ({ title, files, tone, actionLabel, actionTitle, onAction, onCopy, onDiff }) => (
  <div className={`git-group git-group-${tone}`}>
    <div className="git-group-head">{title}</div>
    {files.map(f => (
      <div
        key={f.path}
        className="git-file-row"
        title={onDiff ? `${fileLabel(f)} — click to view diff` : `${fileLabel(f)} — click to copy path`}
        onClick={() => onDiff ? onDiff(f.path) : onCopy(f.path)}
      >
        <span className={`git-file-code tone-${tone}`}>{statusGlyph(f)}</span>
        <span className="git-file-name">{f.path}</span>
        <button
          className="git-file-action"
          title="Copy path"
          onClick={(e) => { e.stopPropagation(); onCopy(f.path) }}
        >⎘</button>
        <button
          className="git-file-action"
          title={actionTitle}
          onClick={(e) => { e.stopPropagation(); onAction(f.path) }}
        >{actionLabel}</button>
      </div>
    ))}
  </div>
)

const statusGlyph = (f: GitFile): string => {
  if (f.staged === '?' && f.unstaged === '?') return 'U'
  if (f.staged === 'A') return 'A'
  if (f.staged === 'M' || f.unstaged === 'M') return 'M'
  if (f.staged === 'D' || f.unstaged === 'D') return 'D'
  if (f.staged === 'R') return 'R'
  return f.staged !== ' ' ? f.staged : f.unstaged
}

export default GitSection
