import React from "react"
import { useWorkspaceStore } from "../store/workspaceStore"
import "./AnnotateToolbar.css"

const TOOLS = [
	{ key: "freehand", label: "Pen (1)", icon: "ti-pencil" },
	{ key: "arrow", label: "Arrow (2)", icon: "ti-arrow-up-right" },
	{ key: "rectangle", label: "Rect (3)", icon: "ti-rectangle" },
	{ key: "highlight", label: "Highlight (4)", icon: "ti-highlight" },
	{ key: "eraser", label: "Eraser (5)", icon: "ti-eraser" },
] as const

const DRAW_COLORS = [
	"#ffffff",
	"#ff4444",
	"#44bb44",
	"#4488ff",
	"#ffcc00",
	"#ff44cc",
	"#44dddd",
	"#ff8800",
]

const AnnotateToolbar: React.FC = () => {
	const annotateMode = useWorkspaceStore((s) => s.annotateMode)
	const annotateTool = useWorkspaceStore((s) => s.annotateTool)
	const drawColor = useWorkspaceStore((s) => s.drawColor)
	const annotationsVisible = useWorkspaceStore((s) => s.annotationsVisible)
	const annotationsBehindPanels = useWorkspaceStore((s) => s.annotationsBehindPanels)
	const setAnnotateTool = useWorkspaceStore((s) => s.setAnnotateTool)
	const setDrawColor = useWorkspaceStore((s) => s.setDrawColor)
	const toggleAnnotateMode = useWorkspaceStore((s) => s.toggleAnnotateMode)
	const toggleAnnotationsVisible = useWorkspaceStore((s) => s.toggleAnnotationsVisible)
	const toggleAnnotationsBehindPanels = useWorkspaceStore((s) => s.toggleAnnotationsBehindPanels)

	if (!annotateMode) return null

	const clearAll = () => {
		const s = useWorkspaceStore.getState()
		const tab = s.tabs.find((t) => t.id === s.activeTabId)
		if (!tab?.annotations?.length) return
		const drawingTypes = new Set(['freehand', 'arrow', 'rectangle', 'highlight'])
		const drawings = tab.annotations.filter(a => drawingTypes.has(a.type))
		if (drawings.length === 0) return
		const ok = window.confirm(`Delete ${drawings.length} drawing${drawings.length === 1 ? '' : 's'}? (freehand, arrows, rectangles, highlights only)`)
		if (!ok) return
		drawings.forEach(a => s.deleteAnnotation(a.id))
	}

	return (
		<div className="annotate-toolbar">
			<div className="annotate-toolbar-left">
				{TOOLS.map((t) => (
					<button
						key={t.key}
						className={`annotate-tool-btn ${annotateTool === t.key ? "active" : ""}`}
						title={t.label}
						onClick={() => setAnnotateTool(t.key)}>
						<i className={`ti ${t.icon}`} aria-hidden="true" />
					</button>
				))}

				<div className="annotate-toolbar-sep" />

				<div className="annotate-color-row">
					{DRAW_COLORS.map((c) => (
						<button
							key={c}
							className={`annotate-swatch ${drawColor === c ? "active" : ""}`}
							style={{ background: c }}
							title={c}
							aria-label={c}
							onClick={() => setDrawColor(c)}
						/>
					))}
				</div>
			</div>

			<div className="annotate-toolbar-sep" />

			<div className="annotate-toolbar-right">
				<button
					className={`annotate-tool-btn ${annotationsBehindPanels ? "active" : ""}`}
					title="Send annotations to back / bring to front"
					onClick={toggleAnnotationsBehindPanels}>
					<i className="ti ti-layers-subtract" aria-hidden="true" />
				</button>

				<button
					className="annotate-tool-btn danger"
					title="Clear drawings (arrows, lines, shapes)"
					onClick={clearAll}>
					<i className="ti ti-trash" aria-hidden="true" />
				</button>

				<button
					className={`annotate-tool-btn ${annotationsVisible ? "" : "off"}`}
					title="Toggle annotations visibility"
					onClick={toggleAnnotationsVisible}>
					<i
						className={`ti ${annotationsVisible ? "ti-eye" : "ti-eye-off"}`}
						aria-hidden="true"
					/>
				</button>

				<div className="annotate-toolbar-sep" />

				<button
					className="annotate-tool-btn mode-label"
					title="Exit annotate mode (A)"
					onClick={toggleAnnotateMode}>
					<i className="ti ti-pencil-minus" aria-hidden="true" />
					ANNOTATE
				</button>
			</div>
		</div>
	)
}

export default AnnotateToolbar
