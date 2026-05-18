import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import './PanelContextMenu.css'

interface Props {
  tabId: string
  x: number
  y: number
  onRename: () => void
  onClose: () => void
}

const TabContextMenu: React.FC<Props> = ({ tabId, x, y, onRename, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const { tabs, createTab, closeTab, switchTab, markTabSaved, overwriteCanvasPreset, saveCanvasPreset, saveBuiltinPreset, canvasPresets } = useWorkspaceStore()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handler, true)
    window.addEventListener('contextmenu', handler, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', handler, true)
      window.removeEventListener('contextmenu', handler, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return null

  const duplicateTab = () => {
    // Regenerate IDs so source/duplicate panels don't share identity.
    const idMap = new Map<string, string>()
    Object.keys(tab.panels).forEach(oldId => {
      idMap.set(oldId, `${tab.panels[oldId].type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    })
    const newPanels: typeof tab.panels = {}
    Object.values(tab.panels).forEach(p => {
      const newId = idMap.get(p.id)!
      newPanels[newId] = {
        ...p,
        id: newId,
        children: p.children?.map(cid => idMap.get(cid) || cid),
        regionId: p.regionId ? idMap.get(p.regionId) : undefined
      }
    })
    createTab(`${tab.title} Copy`)
    const created = useWorkspaceStore.getState().tabs.slice(-1)[0]
    if (!created) return
    useWorkspaceStore.setState((state) => ({
      tabs: state.tabs.map(t => t.id === created.id ? { ...t, panels: newPanels, viewport: { ...tab.viewport }, lastEditedAt: Date.now() } : t),
      panels: newPanels,
      viewport: { ...tab.viewport }
    }))
  }

  const closeOthers = () => {
    const others = tabs.filter(t => t.id !== tabId)
    const totalPanels = others.reduce((n, t) => n + Object.keys(t.panels).length, 0)
    if (totalPanels > 0) {
      const ok = window.confirm(
        `Close ${others.length} other canvas${others.length === 1 ? '' : 'es'}?\n\n${totalPanels} panel${totalPanels === 1 ? '' : 's'} will be removed.`
      )
      if (!ok) return
    }
    others.forEach(t => closeTab(t.id))
    switchTab(tabId)
  }

  const closeWithConfirm = () => {
    const count = Object.keys(tab.panels).length
    if (count > 0) {
      const dirty = tab.lastEditedAt && tab.lastEditedAt > (tab.lastSavedAt || 0)
      if (dirty) {
        const isBuiltin = tab.kind === 'preset:life' || tab.kind === 'preset:no-life'
        const linked = tab.linkedPresetId ? canvasPresets[tab.linkedPresetId] : null
        const wantSave = window.confirm(
          isBuiltin
            ? `Save layout changes to "${tab.title}" preset before closing? OK = save, Cancel = close without saving.`
            : linked
              ? `Save changes to "${linked.name}" before closing? OK = save, Cancel = close without saving.`
              : `Save canvas "${tab.title}" as a preset before closing? OK = save, Cancel = close without saving.`
        )
        if (wantSave) {
          if (isBuiltin) {
            saveBuiltinPreset(tab.kind as 'preset:life' | 'preset:no-life')
          } else if (linked) {
            overwriteCanvasPreset(linked.id)
            markTabSaved()
          } else {
            const name = window.prompt('Preset name:', tab.title)
            if (name?.trim()) {
              saveCanvasPreset(name.trim())
              markTabSaved()
            }
          }
        }
        closeTab(tabId)
        return
      }
      const ok = window.confirm(`Close canvas "${tab.title}"?\n\n${count} panel${count === 1 ? '' : 's'} will be removed.`)
      if (!ok) return
    }
    closeTab(tabId)
  }

  const wrap = (fn: () => void) => () => { fn(); onClose() }

  const saveCanvas = () => {
    if (!tab) return
    if (tab.kind === 'preset:life' || tab.kind === 'preset:no-life') {
      saveBuiltinPreset(tab.kind)
    } else if (tab.linkedPresetId && canvasPresets[tab.linkedPresetId]) {
      overwriteCanvasPreset(tab.linkedPresetId)
      markTabSaved()
    } else {
      const name = window.prompt('Save canvas as preset:', tab.title)
      if (name?.trim()) {
        saveCanvasPreset(name.trim())
        markTabSaved()
      }
    }
  }

  const left = Math.max(6, Math.min(x, window.innerWidth - 246))
  const top = Math.max(6, Math.min(y, window.innerHeight - 286))

  return createPortal(
    <div ref={menuRef} className="ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <button className="ctx-item" onClick={wrap(onRename)}>
        <span>Rename</span>
      </button>
      <button className="ctx-item" onClick={wrap(duplicateTab)}>
        <span>Duplicate canvas</span>
      </button>
      <button className="ctx-item" onClick={wrap(() => createTab())}>
        <span>New canvas</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={wrap(saveCanvas)}>
        <span>Save</span>
        {tab?.linkedPresetId && canvasPresets[tab.linkedPresetId] && (
          <span className="ctx-kbd">{canvasPresets[tab.linkedPresetId].name}</span>
        )}
      </button>
      <div className="ctx-sep" />
      <button
        className="ctx-item"
        onClick={wrap(closeOthers)}
        disabled={tabs.length < 2}
      ><span>Close others</span></button>
      <button
        className="ctx-item danger"
        onClick={wrap(closeWithConfirm)}
        disabled={tabs.length < 2}
      ><span>Close</span></button>
    </div>,
    document.body
  )
}

export default TabContextMenu
