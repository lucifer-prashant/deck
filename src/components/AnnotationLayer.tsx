import React, { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore, Annotation } from '../store/workspaceStore'
import './AnnotationLayer.css'

const STICKY_COLORS = [
  { label: 'Yellow', value: 'rgba(255, 221, 87, 0.92)' },
  { label: 'Green',  value: 'rgba(134, 219, 143, 0.92)' },
  { label: 'Blue',   value: 'rgba(138, 180, 248, 0.92)' },
  { label: 'Pink',   value: 'rgba(244, 143, 177, 0.92)' },
  { label: 'Purple', value: 'rgba(197, 167, 233, 0.92)' },
  { label: 'Gray',   value: 'rgba(220, 222, 227, 0.92)' }
]

const AnnotationLayer: React.FC = () => {
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const annotations = useWorkspaceStore(s => s.tabs.find(t => t.id === activeTabId)?.annotations || [])
  return (
    <>
      {annotations.map(a => <AnnotationNode key={a.id} annotation={a} />)}
    </>
  )
}

const AnnotationNode: React.FC<{ annotation: Annotation }> = ({ annotation: a }) => {
  const update = useWorkspaceStore(s => s.updateAnnotation)
  const del = useWorkspaceStore(s => s.deleteAnnotation)
  const viewport = useWorkspaceStore(s => s.viewport)
  const [editing, setEditing] = useState(a.text.trim() === '')
  const [text, setText] = useState(a.text)
  const [showColors, setShowColors] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setText(a.text) }, [a.text])

  const onMouseDown = (e: React.MouseEvent) => {
    if (editing) return
    if ((e.target as HTMLElement).closest('.anno-btn')) return
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: a.x, origY: a.y }
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (ev.clientX - d.startX) / viewport.zoom
      const dy = (ev.clientY - d.startY) / viewport.zoom
      update(a.id, { x: d.origX + dx, y: d.origY + dy })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const commit = () => { update(a.id, { text }); setEditing(false) }

  if (a.type === 'label') {
    return (
      <div
        className="anno-label"
        style={{ left: a.x, top: a.y, color: a.color || 'rgba(255,255,255,0.92)' }}
        onMouseDown={onMouseDown}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); del(a.id) }}
      >
        {editing ? (
          <input
            ref={inputRef as unknown as React.RefObject<HTMLInputElement>}
            className="anno-label-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' || e.key === 'Escape') commit()
            }}
            spellCheck={false}
          />
        ) : (
          <span>{a.text || '(label)'}</span>
        )}
      </div>
    )
  }

  return (
    <div
      className="anno-sticky"
      style={{
        left: a.x, top: a.y, width: a.width, height: a.height,
        background: a.color || STICKY_COLORS[0].value
      }}
      onMouseDown={onMouseDown}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); del(a.id) }}
    >
      <div className="anno-toolbar">
        <button
          className="anno-btn"
          title="Color"
          onClick={(e) => { e.stopPropagation(); setShowColors(s => !s) }}
        >●</button>
        <div style={{ flex: 1 }} />
        <button
          className="anno-btn danger"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); del(a.id) }}
        >×</button>
      </div>
      {showColors && (
        <div className="anno-color-row">
          {STICKY_COLORS.map(c => (
            <button
              key={c.value}
              className="anno-swatch"
              style={{ background: c.value }}
              title={c.label}
              onClick={(e) => { e.stopPropagation(); update(a.id, { color: c.value }); setShowColors(false) }}
            />
          ))}
        </div>
      )}
      {editing ? (
        <textarea
          ref={inputRef}
          className="anno-sticky-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') commit()
          }}
          spellCheck={false}
        />
      ) : (
        <div className="anno-sticky-text">{a.text || 'sticky note'}</div>
      )}
    </div>
  )
}

export default AnnotationLayer
