import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Panel as PanelType, useWorkspaceStore } from '../store/workspaceStore'

interface Props {
  panel: PanelType
}

interface Commit {
  isGraphOnly: boolean
  graph: string
  sha?: string
  author?: string
  date?: string
  subject?: string
  refs?: string
}

export const GitPanel: React.FC<Props> = ({ panel }) => {
  const [repoRoot, setRepoRoot] = useState<string>('')
  const [commits, setCommits] = useState<Commit[]>([])
  const [branch, setBranch] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [limit, setLimit] = useState(100)
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)

  // Try to find a repoRoot from panel settings or workspace store
  useEffect(() => {
    if (panel.repoRoot) {
      setRepoRoot(panel.repoRoot)
      return
    }
    const settings = (panel.settings || {}) as { repoRoot?: string }
    if (settings.repoRoot) {
      setRepoRoot(settings.repoRoot)
      return
    }

    // Fallback: look for repoRoot on any active panel
    const store = useWorkspaceStore.getState()
    const found = Object.values(store.panels).find(p => p.repoRoot)?.repoRoot
    if (found) {
      setRepoRoot(found)
    }
  }, [panel.repoRoot, panel.settings])

  const fetchLog = useCallback(async (rootPath: string, currentLimit: number) => {
    if (!rootPath) return
    setLoading(true)
    setErrorMsg('')
    try {
      const logRes = await window.electronAPI?.git?.log(rootPath, currentLimit)
      if (logRes?.ok && logRes.commits) {
        setCommits(logRes.commits)
      } else {
        setErrorMsg(logRes?.error || 'Failed to load git log')
      }

      const statusRes = await window.electronAPI?.git?.status(rootPath)
      if (statusRes?.ok && statusRes.branch) {
        setBranch(statusRes.branch)
      } else {
        setBranch('')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (repoRoot) {
      fetchLog(repoRoot, limit)
    }
  }, [repoRoot, limit, fetchLog])

  const handlePickRepo = async () => {
    const res = await window.electronAPI?.git?.pickWorktreeDir()
    if (res?.ok && res.path) {
      setRepoRoot(res.path)
      useWorkspaceStore.getState().updatePanel(panel.id, {
        settings: {
          ...(panel.settings || {}),
          repoRoot: res.path
        }
      }, { skipHistory: true })
    }
  }

  // Parse git refs like "(HEAD -> main, origin/main, tag: v1.0.0)"
  const renderRefs = (refsStr?: string) => {
    if (!refsStr || !refsStr.trim()) return null
    let cleaned = refsStr.trim()
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      cleaned = cleaned.slice(1, -1)
    }
    const parts = cleaned.split(',').map(p => p.trim())
    return (
      <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, verticalAlign: 'middle' }}>
        {parts.map((p, idx) => {
          let isHead = p.includes('HEAD') || p.includes('->')
          let isTag = p.startsWith('tag:')
          let text = p
          if (p.includes('->')) {
            text = p.split('->')[1].trim()
          } else if (p.startsWith('tag:')) {
            text = p.slice(4).trim()
          }

          const badgeStyle: React.CSSProperties = {
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            fontWeight: 600,
            background: isHead ? 'rgba(76, 175, 80, 0.15)' : isTag ? 'rgba(255, 152, 0, 0.15)' : 'rgba(33, 150, 243, 0.15)',
            color: isHead ? '#81c784' : isTag ? '#ffb74d' : '#64b5f6',
            border: isHead ? '1px solid rgba(76,175,80,0.3)' : isTag ? '1px solid rgba(255,152,0,0.3)' : '1px solid rgba(33,150,243,0.3)',
            whiteSpace: 'nowrap'
          }

          return (
            <span key={idx} style={badgeStyle}>
              {isTag ? '🏷️ ' : ''}{text}
            </span>
          )
        })}
      </span>
    )
  }

  if (!repoRoot) {
    return (
      <div style={placeholderStyle}>
        <div style={placeholderCardStyle}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⎇</div>
          <h3 style={{ margin: '0 0 8px 0', color: 'rgba(255,255,255,0.9)' }}>No Repository Selected</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
            Select a git repository to view its commit history and branch structure graph.
          </p>
          <button style={btnActionStyle} onClick={handlePickRepo}>
            Open Repository
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle} onWheel={(e) => e.stopPropagation()}>
      {/* Header toolbar */}
      <div style={toolbarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={repoNameStyle} title={repoRoot}>
            📁 {repoRoot.split('/').filter(Boolean).pop() || repoRoot}
          </span>
          {branch && <span style={branchBadgeStyle}>⎇ {branch}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            style={selectStyle}
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
          >
            <option value="50">50 commits</option>
            <option value="100">100 commits</option>
            <option value="250">250 commits</option>
            <option value="500">500 commits</option>
          </select>
          <button style={btnStyle} onClick={() => fetchLog(repoRoot, limit)} disabled={loading}>
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
          <button style={btnStyle} onClick={handlePickRepo}>
            Change Folder
          </button>
        </div>
      </div>

      {/* Main Commit Graph Area */}
      <div style={logListContainerStyle} onWheel={(e) => e.stopPropagation()}>
        {errorMsg && <div style={errorStyle}>⚠️ {errorMsg}</div>}
        <div style={logListStyle}>
          {commits.map((c, i) => {
            if (c.isGraphOnly) {
              return (
                <div key={i} style={commitRowStyle}>
                  <span style={graphStyle}>{c.graph}</span>
                </div>
              )
            }

            return (
              <div key={i} style={commitRowStyle}>
                <span style={graphStyle}>{c.graph}</span>
                <div style={commitInfoStyle}>
                  <span
                    style={shaStyle}
                    onClick={() => c.sha && setSelectedCommitSha(c.sha)}
                    title="Click to view commit detail"
                  >
                    {c.sha}
                  </span>
                  {renderRefs(c.refs)}
                  <span style={subjectStyle} title={c.subject}>
                    {c.subject}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={authorStyle}>@{c.author}</span>
                  <span style={dateStyle}>{c.date}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedCommitSha && (
        <CommitDetailsModal
          repoRoot={repoRoot}
          sha={selectedCommitSha}
          onClose={() => setSelectedCommitSha(null)}
        />
      )}
    </div>
  )
}

/* Commit Detail Modal */
interface ModalProps {
  repoRoot: string
  sha: string
  onClose: () => void
}

const CommitDetailsModal: React.FC<ModalProps> = ({ repoRoot, sha, onClose }) => {
  const [details, setDetails] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    window.electronAPI?.git?.show(repoRoot, sha).then(res => {
      setLoading(false)
      if (res?.ok && res.stdout) {
        setDetails(res.stdout)
      } else {
        setError(res?.error || 'Failed to get commit details')
      }
    })
  }, [repoRoot, sha])

  // Simple parsing of commit details into metadata, stats, and diff
  const parsed = useMemo(() => {
    if (!details) return { metadata: '', stats: '', diffLines: [] as string[] }
    const lines = details.split('\n')
    const metadataLines: string[] = []
    const statLines: string[] = []
    const diffLines: string[] = []

    let section: 'meta' | 'stats' | 'diff' = 'meta'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('diff --git')) {
        section = 'diff'
      } else if (section === 'meta' && (line.startsWith('---') || (line.trim() === '' && i > 4))) {
        // Look ahead to see if next lines are file stats
        section = 'stats'
      }

      if (section === 'meta') {
        metadataLines.push(line)
      } else if (section === 'stats') {
        statLines.push(line)
      } else {
        diffLines.push(line)
      }
    }

    return {
      metadata: metadataLines.join('\n'),
      stats: statLines.join('\n'),
      diffLines
    }
  }, [details])

  return createPortal(
    <div style={modalBackdropStyle} onClick={onClose} onWheel={(e) => e.stopPropagation()}>
      <div style={modalContainerStyle} onClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>
            Commit Details: {sha.slice(0, 8)}
          </span>
          <button style={modalCloseBtnStyle} onClick={onClose}>×</button>
        </div>

        <div style={modalBodyStyle}>
          {loading ? (
            <div style={modalLoadingStyle}>Loading commit diff...</div>
          ) : error ? (
            <div style={errorStyle}>{error}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Metadata Info */}
              <div style={metaBoxStyle}>
                <pre style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-wrap' }}>
                  {parsed.metadata}
                </pre>
              </div>

              {/* Stat Info */}
              {parsed.stats.trim() && (
                <div style={statsBoxStyle}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>FILES MODIFIED</div>
                  <pre style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap' }}>
                    {parsed.stats}
                  </pre>
                </div>
              )}

              {/* Diffs */}
              {parsed.diffLines.length > 0 && (
                <div style={diffBoxStyle}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>DIFF</div>
                  <div style={diffScrollContainerStyle} onWheel={(e) => e.stopPropagation()}>
                    {parsed.diffLines.map((line, idx) => {
                      let color = 'rgba(255,255,255,0.7)'
                      let background = 'transparent'
                      if (line.startsWith('+') && !line.startsWith('+++')) {
                        color = '#a5d6a7'
                        background = 'rgba(76, 175, 80, 0.1)'
                      } else if (line.startsWith('-') && !line.startsWith('---')) {
                        color = '#ef9a9a'
                        background = 'rgba(244, 67, 54, 0.1)'
                      } else if (line.startsWith('@@')) {
                        color = '#80deea'
                        background = 'rgba(0, 188, 212, 0.05)'
                      } else if (line.startsWith('diff --git')) {
                        color = '#fff'
                        background = 'rgba(255,255,255,0.06)'
                      }

                      return (
                        <div
                          key={idx}
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 11.5,
                            lineHeight: '1.5',
                            whiteSpace: 'pre',
                            color,
                            background,
                            padding: '1px 8px'
                          }}
                        >
                          {line}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* Styles */
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minHeight: 0,
  background: '#121212',
  color: 'rgba(255,255,255,0.85)',
  fontFamily: 'system-ui, -apple-system, sans-serif'
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 12px',
  background: '#1a1a1a',
  borderBottom: '1px solid #282828',
  fontSize: 11.5
}

const repoNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'rgba(255,255,255,0.85)',
  textOverflow: 'ellipsis',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  maxWidth: 240
}

const branchBadgeStyle: React.CSSProperties = {
  background: 'rgba(77, 171, 232, 0.12)',
  color: '#4dabe8',
  border: '1px solid rgba(77, 171, 232, 0.3)',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 600
}

const selectStyle: React.CSSProperties = {
  background: '#242424',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 11,
  cursor: 'pointer',
  outline: 'none'
}

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const logListContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
  padding: '8px 0'
}

const logListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'max-content',
  minWidth: '100%',
  fontFamily: 'JetBrains Mono, monospace'
}

const commitRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  minHeight: 22,
  paddingRight: 12
}

const graphStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  color: '#4dabe8',
  whiteSpace: 'pre',
  paddingLeft: 12,
  letterSpacing: '-0.5px'
}

const commitInfoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  marginLeft: 4,
  fontSize: 11.5,
  color: 'rgba(255,255,255,0.8)'
}

const shaStyle: React.CSSProperties = {
  color: '#4dabe8',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontWeight: 500
}

const subjectStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.9)',
  textOverflow: 'ellipsis',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  maxWidth: 500
}

const authorStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.4)',
  whiteSpace: 'nowrap'
}

const dateStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.3)',
  whiteSpace: 'nowrap',
  minWidth: 80,
  textAlign: 'right'
}

const errorStyle: React.CSSProperties = {
  background: 'rgba(244, 67, 54, 0.1)',
  border: '1px solid rgba(244, 67, 54, 0.3)',
  borderRadius: 4,
  color: '#ef9a9a',
  padding: '8px 12px',
  margin: '8px 12px',
  fontSize: 12
}

const placeholderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  background: '#121212'
}

const placeholderCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  maxWidth: 320,
  padding: 24,
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 8,
  backdropFilter: 'blur(8px)'
}

const btnActionStyle: React.CSSProperties = {
  background: '#4dabe8',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  padding: '6px 16px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.2s'
}

/* Modal styles */
const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999
}

const modalContainerStyle: React.CSSProperties = {
  width: 'min(900px, calc(100vw - 64px))',
  maxHeight: 'calc(100vh - 64px)',
  background: '#181818',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  borderBottom: '1px solid #2a2a2a',
  background: '#1f1f1f'
}

const modalCloseBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgba(255,255,255,0.5)',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: '1',
  padding: 0
}

const modalBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  minHeight: 0
}

const modalLoadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 200,
  fontSize: 12,
  color: 'rgba(255,255,255,0.5)',
  fontFamily: 'monospace'
}

const metaBoxStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  padding: 12
}

const statsBoxStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  padding: 12
}

const diffBoxStyle: React.CSSProperties = {
  background: '#0c0c0c',
  border: '1px solid #222',
  borderRadius: 6,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 200
}

const diffScrollContainerStyle: React.CSSProperties = {
  overflowX: 'auto',
  maxHeight: 400
}
