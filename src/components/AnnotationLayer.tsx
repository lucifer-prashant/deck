import React, { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useWorkspaceStore, Annotation } from "../store/workspaceStore"
import { getAnchorPoint, resolveConnectionRoute, generateStraightPath, generateSmoothPath } from "../annotationUtils"
import "./AnnotationLayer.css"

const STICKY_COLORS = [
	{ label: "Yellow", value: "rgba(255, 221, 87, 0.92)" },
	{ label: "Green", value: "rgba(134, 219, 143, 0.92)" },
	{ label: "Blue", value: "rgba(138, 180, 248, 0.92)" },
	{ label: "Pink", value: "rgba(244, 143, 177, 0.92)" },
	{ label: "Purple", value: "rgba(197, 167, 233, 0.92)" },
	{ label: "Gray", value: "rgba(220, 222, 227, 0.92)" },
]

// Annotation types rendered on the <canvas> element (not DOM elements).
const DRAWING_TYPES = new Set(["freehand", "arrow", "rectangle", "highlight", "relationship"])

function parseLineFormatting(text: string): React.ReactNode {
	const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
	const tokens = text.split(regex)
	return tokens.map((token, i) => {
		if (token.startsWith('`') && token.endsWith('`')) {
			return <code key={i} style={{ background: 'rgba(0,0,0,0.15)', padding: '2px 4px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.85em' }}>{token.slice(1, -1)}</code>
		}
		if (token.startsWith('**') && token.endsWith('**')) {
			return <strong key={i} style={{ fontWeight: 'bold' }}>{token.slice(2, -2)}</strong>
		}
		if (token.startsWith('*') && token.endsWith('*')) {
			return <em key={i} style={{ fontStyle: 'italic' }}>{token.slice(1, -1)}</em>
		}
		return token
	})
}

function formatMarkdown(text: string): React.ReactNode[] {
	if (!text) return []
	const lines = text.split('\n')
	return lines.map((line, index) => {
		if (line.startsWith('- [ ] ') || line.startsWith('* [ ] ')) {
			return (
				<div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
					<input type="checkbox" checked={false} readOnly style={{ pointerEvents: 'none' }} />
					<span>{parseLineFormatting(line.substring(6))}</span>
				</div>
			)
		}
		if (line.startsWith('- [x] ') || line.startsWith('* [x] ')) {
			return (
				<div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
					<input type="checkbox" checked={true} readOnly style={{ pointerEvents: 'none' }} />
					<span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{parseLineFormatting(line.substring(6))}</span>
				</div>
			)
		}
		if (line.startsWith('# ')) {
			return <h1 key={index} style={{ fontSize: '1.35em', margin: '8px 0 4px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 2 }}>{parseLineFormatting(line.substring(2))}</h1>
		}
		if (line.startsWith('## ')) {
			return <h2 key={index} style={{ fontSize: '1.2em', margin: '7px 0 3px', fontWeight: 'bold' }}>{parseLineFormatting(line.substring(3))}</h2>
		}
		if (line.startsWith('### ')) {
			return <h3 key={index} style={{ fontSize: '1.1em', margin: '6px 0 2px', fontWeight: 'bold' }}>{parseLineFormatting(line.substring(4))}</h3>
		}
		if (line.startsWith('- ') || line.startsWith('* ')) {
			return (
				<li key={index} style={{ marginLeft: 14, listStyleType: 'disc', margin: '2px 0' }}>
					{parseLineFormatting(line.substring(2))}
				</li>
			)
		}
		return (
			<div key={index} style={{ minHeight: '1.1em', margin: '2px 0' }}>
				{parseLineFormatting(line)}
			</div>
		)
	})
}

const AnnotationLayer: React.FC = () => {
	const annotations = useWorkspaceStore(
		(s) => s.tabs.find((t) => t.id === s.activeTabId)?.annotations || [],
	)
	const annotationsBehindPanels = useWorkspaceStore(
		(s) => s.annotationsBehindPanels,
	)

	const domAnnotations = annotations.filter((a) => !DRAWING_TYPES.has(a.type))
	const relationships = annotations.filter((a) => a.type === "relationship")

	return (
		<div
			className="annotation-layer"
			data-anno-front={
				!annotationsBehindPanels ? "" : undefined
			}
			data-anno-behind={annotationsBehindPanels ? "" : undefined}
			style={
				annotationsBehindPanels
					? { zIndex: 0 }
					: { zIndex: 3 }
			}>
			<svg
				className="annotation-svg"
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: 1,
					height: 1,
					overflow: "visible",
					pointerEvents: "none",
					zIndex: annotationsBehindPanels ? 0 : 3,
				}}>
				<ArrowPorts />
				{relationships.map((a) => (
					<RelationshipLine
						key={a.id}
						annotation={a}
						onDelete={() => useWorkspaceStore.getState().deleteAnnotation(a.id)}
					/>
				))}
			</svg>
			{domAnnotations.map((a) => (
				<AnnotationNode key={a.id} annotation={a} />
			))}
		</div>
	)
}

const PORT_RADIUS = 6

const ArrowPorts: React.FC = () => {
  const annotateMode = useWorkspaceStore(s => s.annotateMode)
  const annotateTool = useWorkspaceStore(s => s.annotateTool)

  if (!annotateMode || annotateTool !== 'arrow') return null

  return <ArrowPortsActive />
}

const ArrowPortsActive: React.FC = () => {
  const panels = useWorkspaceStore(s => s.panels)
  const onPortDown = (panelId: string, anchor: string, edgePos: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const s = useWorkspaceStore.getState()
    if (s.annotateMode && s.annotateTool === 'arrow') {
      window.dispatchEvent(new CustomEvent('deck:arrow-port-click', {
        detail: { panelId, anchor, edgePos, screenX: e.clientX, screenY: e.clientY }
      }))
    }
  }

  const panelList = Object.entries(panels).filter(([, p]) => p.type !== 'region')

  return (
    <>
      {panelList.map(([id, p]) => {
        const h = p.minimized ? 34 : p.height
        const ports = [
          { anchor: 'top',    x: p.x + p.width / 2, y: p.y, pos: 0.5 },
          { anchor: 'bottom', x: p.x + p.width / 2, y: p.y + h, pos: 0.5 },
          { anchor: 'left',   x: p.x, y: p.y + h / 2, pos: 0.5 },
          { anchor: 'right',  x: p.x + p.width, y: p.y + h / 2, pos: 0.5 },
        ]
        return (
          <g key={id}>
            {ports.map(pt => (
              <g key={pt.anchor}>
                <circle
                  data-port-panel-id={id}
                  data-port-anchor={pt.anchor}
                  cx={pt.x} cy={pt.y} r={PORT_RADIUS}
                  fill="#4dabe8" fillOpacity={0.85}
                  stroke="#fff" strokeWidth={1.5}
                  style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                  onMouseDown={onPortDown(id, pt.anchor, pt.pos)}
                />
                <circle
                  data-port-panel-id={id}
                  data-port-anchor={pt.anchor}
                  cx={pt.x} cy={pt.y} r={PORT_RADIUS + 3}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                  onMouseDown={onPortDown(id, pt.anchor, pt.pos)}
                />
              </g>
            ))}
          </g>
        )
      })}
    </>
  )
}

const RelationshipLine: React.FC<{
	annotation: Annotation
	onDelete: () => void
}> = React.memo(({ annotation: a, onDelete }) => {
	if (!a.sourcePanelId || !a.targetPanelId) return null
	const src = useWorkspaceStore(s => s.panels[a.sourcePanelId!])
	const tgt = useWorkspaceStore(s => s.panels[a.targetPanelId!])
	if (!src || !tgt) return null

	// Subscribe to active tab's lastEditedAt to trigger a re-route when any panel finishes dragging
	useWorkspaceStore(s => s.tabs.find(t => t.id === s.activeTabId)?.lastEditedAt)

	const srcPt = getAnchorPoint(src, a.sourceAnchor || "center", a.sourceEdgePos ?? 0.5)
	const tgtPt = getAnchorPoint(tgt, a.targetAnchor || "center", a.targetEdgePos ?? 0.5)
	const broken = a.broken || src.detached || tgt.detached

	// Unify routing using the shared resolveConnectionRoute to route around panels
	const panels = useWorkspaceStore.getState().panels
	const route = resolveConnectionRoute(a, panels as any)
	const pathD = a.curved === false
		? generateStraightPath(route)
		: generateSmoothPath(route, 0.22)

	const midX = (srcPt.x + tgtPt.x) / 2
	const midY = (srcPt.y + tgtPt.y) / 2

	return (
		<g
			onContextMenu={(e) => {
				e.preventDefault()
				e.stopPropagation()
				onDelete()
			}}>
			<defs>
				<marker
					id={`arrowhead-${a.id}`}
					viewBox="0 0 10 7"
					refX={10}
					refY={3.5}
					markerWidth={7}
					markerHeight={5}
					orient="auto-start-reverse">
					<polygon
						points="0 0, 10 3.5, 0 7"
						fill={broken ? "#6b7280" : a.color || "#6b7280"}
					/>
				</marker>
			</defs>
			<path
				data-relationship-id={a.id}
				data-source-panel-id={a.sourcePanelId}
				data-target-panel-id={a.targetPanelId}
				data-source-anchor={a.sourceAnchor || "center"}
				data-target-anchor={a.targetAnchor || "center"}
				data-source-edge-pos={a.sourceEdgePos ?? 0.5}
				data-target-edge-pos={a.targetEdgePos ?? 0.5}
				data-curved={a.curved !== false}
				d={pathD}
				fill="none"
				stroke={broken ? "#6b7280" : a.color || "#6b7280"}
				strokeWidth={2}
				strokeDasharray={broken ? "6 4" : "none"}
				opacity={broken ? 0.4 : 0.85}
				markerEnd={`url(#arrowhead-${a.id})`}
			/>
			{a.relationshipLabel && (
				<text
					data-relationship-label-id={a.id}
					x={midX}
					y={midY - 8}
					textAnchor="middle"
					fill={broken ? "#6b7280" : a.color || "#e6e6e6"}
					fontSize={11}
					fontFamily="sans-serif"
					opacity={broken ? 0.4 : 1}>
					{a.relationshipLabel}
				</text>
			)}
		</g>
	)
})

function contrastColor(bg: string): string {
	const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
	if (!m) return "#1a1d22"
	const [r, g, b] = [+m[1], +m[2], +m[3]]
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
	return lum > 0.55 ? "#1a1d22" : "#f0f0f0"
}

const BORDER_COLORS = [
  { label: "None", value: "" },
  { label: "White", value: "#ffffff" },
  { label: "Blue", value: "#4dabe8" },
  { label: "Red", value: "#ef4444" },
  { label: "Green", value: "#22c55e" },
  { label: "Yellow", value: "#eab308" },
  { label: "Pink", value: "#ec4899" },
  { label: "Cyan", value: "#06b6d4" },
]

const AnnotationColorPicker: React.FC<{
  x: number; y: number; color: string; title: string; onPick: (c: string) => void; onRename: (name: string) => void; onClose: () => void
}> = ({ x, y, color, title, onPick, onRename, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener("mousedown", h, true)
    return () => window.removeEventListener("mousedown", h, true)
  }, [onClose])

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const left = Math.max(4, Math.min(x, window.innerWidth - 200))
  const top = Math.max(4, Math.min(y, window.innerHeight - 50))
  return createPortal(
    <div ref={ref} className="anno-color-picker" style={{ left, top }}>
      {BORDER_COLORS.map(c => (
        <button
          key={c.value}
          className={`anno-border-swatch ${(color || "") === c.value ? "active" : ""}`}
          title={c.label}
          onClick={() => { onPick(c.value); onClose() }}
        >
          {c.value ? (
            <span style={{ background: c.value }} />
          ) : (
            <span className="anno-border-none">N</span>
          )}
        </button>
      ))}
      <div className="anno-picker-sep" />
      {renaming ? (
        <input
          ref={inputRef}
          className="anno-picker-rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onRename(draft.trim()); onClose() }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') { onRename(draft.trim()); onClose() }
            else if (e.key === 'Escape') { setDraft(title); setRenaming(false) }
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="Name..."
        />
      ) : (
        <button className="anno-picker-rename" onClick={() => { setRenaming(true); setDraft(title) }}>
          {title ? title.slice(0, 24) : 'Rename...'}
        </button>
      )}
    </div>,
    document.body
  )
}

type ResizeDir = 'se' | 'sw' | 'ne' | 'nw' | 'n' | 's' | 'e' | 'w'

const ImageNode: React.FC<{
  annotation: Annotation
  imgSrc: string
  onUpdate: (upd: Partial<Annotation>) => void
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  isSelected: boolean
  jumpActive: boolean
}> = React.memo(({ annotation: a, imgSrc, onUpdate, onSelect, onContextMenu, isSelected, jumpActive }) => {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; origins?: Array<{ id: string; x: number; y: number }>; isMulti?: boolean } | null>(null)
  const resizeRef = useRef<{ sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; dir: ResizeDir } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()

    const store = useWorkspaceStore.getState()
    const isSelected = store.selectedAnnotationIds.includes(a.id)
    const isMulti = isSelected && store.selectedAnnotationIds.length > 1

    if (!isMulti) {
      onSelect()
    }

    const s2 = useWorkspaceStore.getState()
    const tab = s2.tabs.find(t => t.id === s2.activeTabId)
    const origins = s2.selectedAnnotationIds.map(id => {
      const ann = tab?.annotations?.find(aa => aa.id === id)
      return ann ? { id, x: ann.x, y: ann.y } : null
    }).filter(Boolean) as { id: string; x: number; y: number }[]

    const panelOrigins = s2.selectedPanelIds.map(id => {
      const p = s2.panels[id]
      return p ? { id, x: p.x, y: p.y } : null
    }).filter(Boolean) as { id: string; x: number; y: number }[]

    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, origins, isMulti: origins.length > 1 }
    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const zoom = useWorkspaceStore.getState().viewport.zoom
      const dx = (ev.clientX - d.sx) / zoom
      const dy = (ev.clientY - d.sy) / zoom
      if (d.isMulti && d.origins) {
        const s = useWorkspaceStore.getState()
        d.origins.forEach(o => s.updateAnnotation(o.id, { x: o.x + dx, y: o.y + dy }))
      } else {
        onUpdate({ x: d.ox + dx, y: d.oy + dy })
      }
      // Move selected panels in sync with annotation.
      if (panelOrigins.length > 0) {
        const s = useWorkspaceStore.getState()
        panelOrigins.forEach(o => s.movePanel(o.id, o.x + dx, o.y + dy))
      }
    }
    const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onResizeDown = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, ow: a.width, oh: a.height, dir }
    const move = (ev: PointerEvent) => {
      const d = resizeRef.current
      if (!d) return
      const zoom = useWorkspaceStore.getState().viewport.zoom
      const dx = (ev.clientX - d.sx) / zoom
      const dy = (ev.clientY - d.sy) / zoom
      let nw = d.ow, nh = d.oh, nx = d.ox, ny = d.oy
      if (d.dir.includes('e')) nw = Math.max(40, d.ow + dx)
      if (d.dir.includes('w')) { nw = Math.max(40, d.ow - dx); nx = d.ox + (d.ow - nw) }
      if (d.dir.includes('s')) nh = Math.max(30, d.oh + dy)
      if (d.dir.includes('n')) { nh = Math.max(30, d.oh - dy); ny = d.oy + (d.oh - nh) }
      onUpdate({ x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) })
    }
    const up = () => { resizeRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`anno-image ${isSelected ? 'anno-selected' : ''} ${jumpActive ? 'jump-highlight' : ''}`}
      style={{
        left: a.x, top: a.y, width: a.width, height: a.height,
        outline: a.color ? `1.5px solid ${a.color}` : undefined,
        outlineOffset: '-1px',
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <img
        src={imgSrc}
        alt="pasted"
        draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none',
        }}
      />
      {(['nw','n','ne','w','e','sw','s','se'] as ResizeDir[]).map(dir => (
        <div
          key={dir}
          className={`anno-resize-handle anno-resize-${dir}`}
          onPointerDown={onResizeDown(dir)}
        />
      ))}
    </div>
  )
})

const AnnotationNode: React.FC<{ annotation: Annotation }> = React.memo(({
	annotation: a,
}) => {
	const update = useWorkspaceStore((s) => s.updateAnnotation)
	const del = useWorkspaceStore((s) => s.deleteAnnotation)
	const selectAnnotation = useWorkspaceStore((s) => s.selectAnnotation)
	const selectedAnnotationIds = useWorkspaceStore((s) => s.selectedAnnotationIds)
	const jumpActive = useWorkspaceStore((s) => s.jumpMode.active)
	const [editing, setEditing] = useState(a.text.trim() === "")
	const [text, setText] = useState(a.text)
	const [showColors, setShowColors] = useState(false)
	const [borderPicker, setBorderPicker] = useState<{ x: number; y: number } | null>(null)
	const dragRef = useRef<{
		startX: number
		startY: number
		origX: number
		origY: number
	} | null>(null)
	const multiOriginsRef = useRef<Array<{ id: string; x: number; y: number }>>([])
	const panelOriginsRef = useRef<Array<{ id: string; x: number; y: number }>>([])
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const labelRef = useRef<HTMLDivElement>(null)

	const bg = a.color || STICKY_COLORS[0].value
	const fg = contrastColor(bg)

	useEffect(() => {
		if (editing) inputRef.current?.focus()
	}, [editing])
	useEffect(() => {
		setText(a.text)
	}, [a.text])

	const onMouseDown = (e: React.MouseEvent) => {
		if (editing) return
		if ((e.target as HTMLElement).closest(".anno-btn")) return
		e.stopPropagation()

		const store = useWorkspaceStore.getState()
		const isSelected = store.selectedAnnotationIds.includes(a.id)
		const isMulti = isSelected && store.selectedAnnotationIds.length > 1

		if (!isMulti) {
			selectAnnotation(a.id)
		}

		const s2 = useWorkspaceStore.getState()
		const tab = s2.tabs.find(t => t.id === s2.activeTabId)
		const origins = s2.selectedAnnotationIds.map(id => {
			const ann = tab?.annotations?.find(aa => aa.id === id)
			return ann ? { id, x: ann.x, y: ann.y } : null
		}).filter(Boolean) as { id: string; x: number; y: number }[]
		multiOriginsRef.current = origins

		// Cache selected panel positions for cross-type multi-move.
		const panels = s2.panels
		panelOriginsRef.current = s2.selectedPanelIds.map(id => {
			const p = panels[id]
			return p ? { id, x: p.x, y: p.y } : null
		}).filter(Boolean) as { id: string; x: number; y: number }[]

		dragRef.current = {
			startX: e.clientX,
			startY: e.clientY,
			origX: a.x,
			origY: a.y,
		}
		const onMove = (ev: MouseEvent) => {
			const d = dragRef.current
			if (!d) return
			const zoom = useWorkspaceStore.getState().viewport.zoom
			const dx = (ev.clientX - d.startX) / zoom
			const dy = (ev.clientY - d.startY) / zoom
			if (multiOriginsRef.current.length > 1) {
				multiOriginsRef.current.forEach(({ id, x, y }) => {
					update(id, { x: x + dx, y: y + dy })
				})
			} else {
				update(a.id, { x: d.origX + dx, y: d.origY + dy })
			}
			// Move selected panels in sync with annotation.
			if (panelOriginsRef.current.length > 0) {
				const s3 = useWorkspaceStore.getState()
				panelOriginsRef.current.forEach(({ id, x, y }) => {
					s3.movePanel(id, x + dx, y + dy)
				})
			}
		}
		const onUp = () => {
			dragRef.current = null
			multiOriginsRef.current = []
			panelOriginsRef.current = []
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
	}

	const commit = () => {
		const txt = text.trim()
		if (!txt && a.type === 'label' && editing) {
			del(a.id)
			return
		}
		if (txt) {
			update(a.id, { text: txt === text ? text : txt })
		}
		setEditing(false)
	}

	const pickerEl = borderPicker && (
		<AnnotationColorPicker
			x={borderPicker.x} y={borderPicker.y}
			color={a.color || ''}
			title={a.title || ''}
			onPick={(c) => { update(a.id, { color: c || '' }); setBorderPicker(null) }}
			onRename={(name) => { update(a.id, { title: name || undefined }) }}
			onClose={() => setBorderPicker(null)}
		/>
	)

	if (a.type === "image") {
		const src = a.filename
		if (!src) return null
		const imgSrc =
			src.startsWith("http") || src.startsWith("data:") || src.startsWith("local-file:")
				? src
				: `deck-asset://${src}`
		return (
			<>
			{a.title && (
				<div className="anno-title" style={{ left: a.x, top: a.y - 16 }}>{a.title}</div>
			)}
			<ImageNode
				annotation={a}
				imgSrc={imgSrc}
				isSelected={selectedAnnotationIds.includes(a.id)}
				jumpActive={jumpActive}
				onUpdate={(upd) => update(a.id, upd)}
				onSelect={() => selectAnnotation(a.id)}
				onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setBorderPicker({ x: e.clientX, y: e.clientY }) }}
			/>
			{pickerEl}
			</>
		)
	}

	if (a.type === "label") {
		const fs = a.fontSize || 14
		const lw = a.width || 160
		const lh = a.height || 0
		return (
			<>
			{a.title && (
				<div className="anno-title" style={{ left: a.x, top: a.y - 14 }}>{a.title}</div>
			)}
			<div
				className={`anno-label ${editing ? 'editing' : ''} ${selectedAnnotationIds.includes(a.id) ? 'anno-selected' : ''} ${jumpActive ? 'jump-highlight' : ''}`}
				ref={labelRef}
				style={{
					left: a.x,
					top: a.y,
					width: lw > 0 ? lw : undefined,
					height: lh > 0 ? lh : undefined,
					minWidth: lw > 0 ? undefined : 40,
					fontSize: fs,
					color: a.color || "rgba(255,255,255,0.92)",
					outline: (a.color && a.color !== "rgba(255,255,255,0.92)") ? `1.5px solid ${a.color}` : undefined,
					outlineOffset: '-1px',
				}}
				onMouseDown={onMouseDown}
				onDoubleClick={() => setEditing(true)}
				onContextMenu={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setBorderPicker({ x: e.clientX, y: e.clientY })
				}}>
				{editing ? (
					<textarea
						ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
						className="anno-label-input"
						value={text}
						onChange={(e) => setText(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter" && !e.shiftKey) commit()
							else if (e.key === "Escape") {
								if (!text.trim()) del(a.id)
								else commit()
							}
						}}
						spellCheck={false}
					/>
				) : (
					<span>{a.text || ""}</span>
				)}
				{(['nw','n','ne','w','e','sw','s','se'] as ResizeDir[]).map(dir => (
					<div
						key={dir}
						className={`anno-resize-handle anno-resize-${dir}`}
						onPointerDown={(e) => {
							e.stopPropagation()
							e.preventDefault()
							const start = { sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, ow: lw, oh: lh }
							const move = (ev: PointerEvent) => {
								const zoom = useWorkspaceStore.getState().viewport.zoom
								const dx = (ev.clientX - start.sx) / zoom
								const dy = (ev.clientY - start.sy) / zoom
								let nw = start.ow, nh = start.oh, nx = start.ox, ny = start.oy
								if (dir.includes('e')) nw = Math.max(40, start.ow + dx)
								if (dir.includes('w')) { nw = Math.max(40, start.ow - dx); nx = start.ox + (start.ow - nw) }
								if (dir.includes('s')) nh = Math.max(18, start.oh + dy)
								if (dir.includes('n')) { nh = Math.max(18, start.oh - dy); ny = start.oy + (start.oh - nh) }
								update(a.id, { x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) })
							}
							const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
							window.addEventListener('pointermove', move)
							window.addEventListener('pointerup', up)
						}}
					/>
				))}
			</div>
			{pickerEl}
			</>
		)
	}

	return (
		<>
		<div
			className={`anno-sticky ${jumpActive ? 'jump-highlight' : ''}`}
			style={{
				left: a.x,
				top: a.y,
				width: a.width,
				height: a.height,
				background: bg,
				color: fg,
			}}
			onMouseDown={onMouseDown}
			onDoubleClick={() => setEditing(true)}
			onContextMenu={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}>
			<div className="anno-toolbar">
				<button
					className="anno-btn"
					title="Color"
					onClick={(e) => {
						e.stopPropagation()
						setShowColors((s) => !s)
					}}>
					●
				</button>
				<div style={{ flex: 1 }} />
				<button
					className="anno-btn danger"
					title="Delete"
					onClick={(e) => {
						e.stopPropagation()
						del(a.id)
					}}>
					×
				</button>
			</div>
			{showColors && (
				<div className="anno-color-row">
					{STICKY_COLORS.map((c) => (
						<button
							key={c.value}
							className="anno-swatch"
							style={{ background: c.value }}
							title={c.label}
							onClick={(e) => {
								e.stopPropagation()
								update(a.id, { color: c.value })
								setShowColors(false)
							}}
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
						if (e.key === "Escape") commit()
					}}
					spellCheck={false}
				/>
			) : (
				<div className="anno-sticky-text" style={{ whiteSpace: 'normal', overflowY: 'auto' }}>
					{a.text ? formatMarkdown(a.text) : <span style={{ opacity: 0.45, fontStyle: 'italic' }}>Double-click to write note (Markdown supported)</span>}
				</div>
			)}
		</div>
		{pickerEl}
		</>
	)
})

export default React.memo(AnnotationLayer)

