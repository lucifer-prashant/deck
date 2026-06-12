import type { Panel } from './store/workspaceStore'

const panelHasState = (p: Panel): boolean => {
  if (p.type === 'region') return true
  return true
}

export const confirmPanelDeletion = (count: number) => {
  const label = count === 1 ? 'this panel' : `${count} selected panels`
  return window.confirm(`Delete ${label}?`)
}

export const confirmPanelsDeletion = (targets: Panel[]): boolean => {
  if (targets.length === 0) return false
  const stateful = targets.filter(panelHasState)
  if (stateful.length === 0) return true

  if (targets.length === 1) {
    const p = stateful[0]
    if (p.type === 'region') {
      const count = p.children?.length || 0
      const tail = count > 0 ? ` (${count} ${count === 1 ? 'panel stays' : 'panels stay'} on canvas)` : ''
      return window.confirm(`Delete region "${p.title}"?${tail}`)
    }
    if (p.type === 'browser') {
      const settings = p.settings as Record<string, unknown> | undefined
      const browserTabs = settings?.browserTabs as Array<{ url: string }> | undefined
      const isPdf = p.title?.toLowerCase().endsWith('.pdf') || browserTabs?.[0]?.url?.toLowerCase().endsWith('.pdf')
      const typeName = isPdf ? 'pdf view' : 'browser'
      return window.confirm(`Delete ${typeName} "${p.title}"?`)
    }
    return window.confirm(`Delete ${p.type} "${p.title}"?`)
  }

  return window.confirm(`Delete ${targets.length} panels? ${stateful.length} contain state.`)
}
