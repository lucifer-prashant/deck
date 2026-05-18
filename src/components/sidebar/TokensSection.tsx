import React, { useCallback, useEffect, useMemo, useState } from 'react'

interface Row {
  tool: string
  project: string
  model: string
  day: string
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  messages: number
  costUsd: number
}

interface Props {
  activeProject?: string
}

const fmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fmtFull = new Intl.NumberFormat('en')
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

const TOOL_COLOR: Record<string, string> = {
  claude: '#cba6f7',
  codex: '#89b4fa',
  opencode: '#a6e3a1'
}

const TokensSection: React.FC<Props> = ({ activeProject }) => {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [scannedAt, setScannedAt] = useState<number | null>(null)
  const [error, setError] = useState<string>('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.tokens
    if (!api) { setError('tokens bridge unavailable'); return }
    setLoading(true)
    setError('')
    const r = await api.scan()
    setLoading(false)
    if (r.ok && r.rows) {
      setRows(r.rows)
      setScannedAt(r.scannedAt || Date.now())
    } else {
      setError(r.error || 'scan failed')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Switch to project scope automatically if active project changes and we have data for it.
  useEffect(() => {
    if (!activeProject) return
    if (!rows) return
    if (rows.some(r => projectMatches(r.project, activeProject))) {
      // don't force, just allow user to switch via toggle
    }
  }, [activeProject, rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    if (scope === 'project') {
      if (!activeProject) return []
      return rows.filter(r => projectMatches(r.project, activeProject))
    }
    return rows
  }, [rows, scope, activeProject])

  const totals = useMemo(() => {
    let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, cost = 0, messages = 0
    for (const r of filtered) {
      input += r.input; output += r.output
      cacheCreate += r.cacheCreate; cacheRead += r.cacheRead
      cost += r.costUsd; messages += r.messages
    }
    return { input, output, cacheCreate, cacheRead, cost, messages, total: input + output + cacheCreate + cacheRead }
  }, [filtered])

  const byModel = useMemo(() => {
    const m = new Map<string, { tokens: number; cost: number; messages: number }>()
    for (const r of filtered) {
      const cur = m.get(r.model) || { tokens: 0, cost: 0, messages: 0 }
      cur.tokens += r.input + r.output + r.cacheCreate + r.cacheRead
      cur.cost += r.costUsd
      cur.messages += r.messages
      m.set(r.model, cur)
    }
    return Array.from(m.entries()).map(([k, v]) => ({ model: k, ...v })).sort((a, b) => b.cost - a.cost)
  }, [filtered])

  const byTool = useMemo(() => {
    const m = new Map<string, { tokens: number; cost: number; messages: number }>()
    for (const r of filtered) {
      const cur = m.get(r.tool) || { tokens: 0, cost: 0, messages: 0 }
      cur.tokens += r.input + r.output + r.cacheCreate + r.cacheRead
      cur.cost += r.costUsd
      cur.messages += r.messages
      m.set(r.tool, cur)
    }
    return Array.from(m.entries()).map(([k, v]) => ({ tool: k, ...v })).sort((a, b) => b.cost - a.cost)
  }, [filtered])

  const spark = useMemo(() => {
    const days: Record<string, number> = {}
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      days[d.toISOString().slice(0, 10)] = 0
    }
    for (const r of filtered) {
      if (r.day in days) days[r.day] += r.costUsd
    }
    const vals = Object.values(days)
    const max = Math.max(...vals, 0.0001)
    return { days: Object.entries(days), max }
  }, [filtered])

  return (
    <div className="sidebar-section tokens-section">
      <div className="sidebar-section-head">
        <span className="sidebar-section-title">Token Usage</span>
        <button
          className="sidebar-pin"
          title="Refresh"
          onClick={refresh}
        >{loading ? '↻' : '⟳'}</button>
      </div>

      <div className="tokens-scope-toggle">
        <button
          className={`tokens-scope-btn ${scope === 'global' ? 'active' : ''}`}
          onClick={() => setScope('global')}
        >Global</button>
        <button
          className={`tokens-scope-btn ${scope === 'project' ? 'active' : ''}`}
          onClick={() => setScope('project')}
          disabled={!activeProject}
          title={activeProject ? `Filter to ${activeProject}` : 'No active project'}
        >This Project</button>
      </div>

      {error && <div className="tokens-error">{error}</div>}
      {!error && rows === null && <div className="tokens-loading">scanning local logs…</div>}
      {!error && rows && rows.length === 0 && <div className="tokens-empty">no agent logs found</div>}
      {!error && rows && rows.length > 0 && (
        <>
          {scope === 'project' && !activeProject && (
            <div className="tokens-empty">no active project context — focus a panel inside a project</div>
          )}
          {scope === 'project' && activeProject && filtered.length === 0 && (
            <div className="tokens-empty">no logs found for<br/><b>{activeProject}</b></div>
          )}
          {filtered.length > 0 && (
            <>
              <div className="tokens-card hero">
                <div className="tokens-cost">{usd(totals.cost)}</div>
                <div className="tokens-cost-sub">est. cost · {fmtFull.format(totals.messages)} messages</div>
                <div className="tokens-breakdown">
                  <span><b>{fmt.format(totals.input)}</b> in</span>
                  <span><b>{fmt.format(totals.output)}</b> out</span>
                  <span><b>{fmt.format(totals.cacheRead)}</b> cache hit</span>
                  <span><b>{fmt.format(totals.cacheCreate)}</b> cache write</span>
                </div>
              </div>

              <div className="tokens-spark">
                <div className="tokens-spark-label">last 7 days</div>
                <div className="tokens-spark-bars">
                  {spark.days.map(([day, cost]) => {
                    const h = Math.max(2, (cost / spark.max) * 32)
                    const isZero = cost === 0
                    return (
                      <div key={day} className="tokens-spark-bar-wrap" title={`${day}: ${usd(cost)}`}>
                        <div className="tokens-spark-bar" style={{ height: h, opacity: isZero ? 0.18 : 1 }} />
                        <div className="tokens-spark-day">{day.slice(8)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="tokens-list">
                <div className="tokens-list-head">by tool</div>
                {byTool.map(t => (
                  <div className="tokens-row" key={t.tool}>
                    <span className="tokens-tool-chip" style={{ background: `${TOOL_COLOR[t.tool] || '#888'}22`, color: TOOL_COLOR[t.tool] || '#bbb' }}>{t.tool}</span>
                    <span className="tokens-row-main">{fmt.format(t.tokens)} tokens · {t.messages} msgs</span>
                    <span className="tokens-row-cost">{usd(t.cost)}</span>
                  </div>
                ))}
              </div>

              <div className="tokens-list">
                <div className="tokens-list-head">by model</div>
                {byModel.slice(0, 8).map(m => (
                  <div className="tokens-row" key={m.model}>
                    <span className="tokens-model" title={m.model}>{shortModel(m.model)}</span>
                    <span className="tokens-row-main">{fmt.format(m.tokens)} · {m.messages}</span>
                    <span className="tokens-row-cost">{usd(m.cost)}</span>
                  </div>
                ))}
              </div>

              <DayBreakdown rows={filtered} />


              {scannedAt && (
                <div className="tokens-foot">
                  scanned {new Date(scannedAt).toLocaleTimeString()}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

const DayBreakdown: React.FC<{ rows: Row[] }> = ({ rows }) => {
  const [expanded, setExpanded] = useState(false)
  const byDay = useMemo(() => {
    const m = new Map<string, { tokens: number; cost: number; messages: number }>()
    for (const r of rows) {
      const cur = m.get(r.day) || { tokens: 0, cost: 0, messages: 0 }
      cur.tokens += r.input + r.output + r.cacheCreate + r.cacheRead
      cur.cost += r.costUsd
      cur.messages += r.messages
      m.set(r.day, cur)
    }
    return Array.from(m.entries()).map(([day, v]) => ({ day, ...v })).sort((a, b) => b.day.localeCompare(a.day))
  }, [rows])
  if (byDay.length === 0) return null
  const visible = expanded ? byDay : byDay.slice(0, 7)
  return (
    <div className="tokens-list">
      <div className="tokens-list-head">by day</div>
      {visible.map(d => (
        <div className="tokens-row" key={d.day}>
          <span className="tokens-day">{d.day}</span>
          <span className="tokens-row-main">{fmt.format(d.tokens)} · {d.messages}</span>
          <span className="tokens-row-cost">{usd(d.cost)}</span>
        </div>
      ))}
      {byDay.length > 7 && (
        <button className="tokens-list-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? `show recent 7` : `show all (${byDay.length})`}
        </button>
      )}
    </div>
  )
}

const projectMatches = (logProject: string, activeProject: string): boolean => {
  if (!logProject || !activeProject) return false
  const a = logProject.replace(/\/+$/, '')
  const b = activeProject.replace(/\/+$/, '')
  if (a === b) return true
  // Only match on full path-segment boundaries — prevents '/foo/bar' from matching
  // '/foo/bar-old' (which substring-contains would do).
  const segMatch = (longer: string, shorter: string) =>
    longer.startsWith(shorter + '/') || longer.endsWith('/' + shorter)
  return segMatch(a, b) || segMatch(b, a)
}

const shortModel = (m: string): string => {
  // claude-opus-4-7-20251024 -> opus 4.7
  const claudeMatch = m.match(/^claude-(opus|sonnet|haiku)-(\d)-(\d)/)
  if (claudeMatch) return `${claudeMatch[1]} ${claudeMatch[2]}.${claudeMatch[3]}`
  const gpt = m.match(/^(gpt-\S+|o\d[\w-]*)/)
  if (gpt) return gpt[1]
  return m.length > 20 ? m.slice(0, 20) + '…' : m
}

export default TokensSection
