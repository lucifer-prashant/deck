import React, { useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { useWorkspaceStore, CanvasPreset } from "../store/workspaceStore"
import { serializeKeyEvent } from "../App"
import "./GlobalSearch.css"

type Section = "appearance" | "canvas" | "shortcuts" | "layouts" | "fontsHelp" | "about"

const SECTIONS: Array<{ id: Section; label: string }> = [
	{ id: "appearance", label: "Appearance" },
	{ id: "canvas", label: "Canvas" },
	{ id: "layouts", label: "Saved Layouts" },
	{ id: "shortcuts", label: "Shortcuts" },
	{ id: "fontsHelp", label: "Help & Fonts Guide" },
	{ id: "about", label: "About" },
]

const COMMANDS_META: Array<{ id: string; label: string; description: string }> = [
  { id: 'toggle-command-palette', label: 'Command Palette', description: 'Open command palette overlay' },
  { id: 'toggle-panel-finder', label: 'Find Panel', description: 'Search and zoom to panel by title' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', description: 'Show/hide left sidebar panel' },
  { id: 'toggle-settings', label: 'Open Preferences', description: 'Show preferences overlay' },
  { id: 'toggle-minimap', label: 'Toggle Minimap', description: 'Show/hide world minimap' },
  { id: 'toggle-annotate-mode', label: 'Toggle Annotate Mode', description: 'Toggle pen/eraser canvas overlay' },
  { id: 'toggle-bars', label: 'Toggle Chrome Bars', description: 'Show/hide header and status bar' },
  { id: 'cycle-theme', label: 'Cycle Workspace Theme', description: 'Cycle through dark, light, midnight' },
  { id: 'arrange-selected', label: 'Arrange Selected Panels', description: 'Grid/Align selected panels' },
  { id: 'find-scratchpad', label: 'Toggle Scratchpad Note', description: 'Quickly open scratchpad note panel' },
  { id: 'open-wintab-switcher', label: 'Win+Tab Switcher', description: 'Alt+Tab-style panel switcher' },
  { id: 'toggle-panel-switcher', label: 'Ctrl+Tab Quick Switcher', description: 'Quick switch MRU panel switcher' },
  { id: 'focus-selected', label: 'Focus Selected Panel', description: 'Zoom and focus active panel' },
  { id: 'rename-selected', label: 'Rename Selected Panel', description: 'Edit selected panel title' },
  { id: 'undo', label: 'Undo Canvas Action', description: 'Undo panel move, resize, draw' },
  { id: 'redo', label: 'Redo Canvas Action', description: 'Redo previously undone action' },
  { id: 'new-terminal', label: 'New Terminal Panel', description: 'Spawn a terminal panel centered on cursor' },
  { id: 'new-editor', label: 'New Editor Panel', description: 'Spawn a code editor panel centered on cursor' },
  { id: 'new-browser', label: 'New Browser Panel', description: 'Spawn a web browser panel centered on cursor' },
  { id: 'new-region', label: 'New Region Group', description: 'Spawn a grouping region panel' },
  { id: 'zoom-in', label: 'Zoom In Canvas', description: 'Increase infinite canvas zoom level' },
  { id: 'zoom-out', label: 'Zoom Out Canvas', description: 'Decrease infinite canvas zoom level' },
  { id: 'reset-viewport', label: 'Reset Canvas View', description: 'Reset canvas zoom and offset to default' },
  { id: 'fit-all', label: 'Fit All Panels', description: 'Zoom canvas to fit all active panels' },
  { id: 'toggle-lock', label: 'Lock Selected Panel', description: 'Prevent selected panel from moving/resizing' },
  { id: 'toggle-minimize', label: 'Minimize Selected Panel', description: 'Collapse selected panel to title bar' },
  { id: 'toggle-pin-front', label: 'Pin Panel to Front', description: 'Keep selected panel overlayed on top' },
  { id: 'bring-front', label: 'Bring Panel to Front', description: 'Move selected panel to front index' },
  { id: 'send-back', label: 'Send Panel to Back', description: 'Move selected panel to back index' },
]

const LayoutPresetRow: React.FC<{ preset: CanvasPreset }> = ({ preset }) => {
	const { deleteCanvasPreset, loadCanvasPreset, renameCanvasPreset } = useWorkspaceStore()
	const [isRenaming, setIsRenaming] = useState(false)
	const [nameDraft, setNameDraft] = useState(preset.name)

	const panelCount = Object.keys(preset.panels || {}).length

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 12,
				padding: '10px 12px',
				background: 'rgba(255,255,255,0.03)',
				border: '1px solid rgba(255,255,255,0.06)',
				borderRadius: 6,
				marginBottom: 8
			}}
		>
			<div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
				{isRenaming ? (
					<input
						type="text"
						value={nameDraft}
						onChange={(e) => setNameDraft(e.target.value)}
						onBlur={() => {
							if (nameDraft.trim()) {
								renameCanvasPreset(preset.id, nameDraft.trim())
							}
							setIsRenaming(false)
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								if (nameDraft.trim()) {
									renameCanvasPreset(preset.id, nameDraft.trim())
								}
								setIsRenaming(false)
							} else if (e.key === 'Escape') {
								setNameDraft(preset.name)
								setIsRenaming(false)
							}
						}}
						style={{ ...textInputStyle, fontSize: 12, padding: '2px 6px', minWidth: 120, height: 'auto', flex: 'none' }}
						autoFocus
					/>
				) : (
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg, #e6e8ec)' }}>{preset.name}</span>
						<button
							onClick={() => setIsRenaming(true)}
							style={{ background: 'none', border: 'none', color: 'var(--fg-muted, rgba(255,255,255,0.4))', cursor: 'pointer', fontSize: 11, padding: 0 }}
							title="Rename preset"
						>
							✎
						</button>
					</div>
				)}
				<span style={{ fontSize: 10.5, color: 'var(--fg-muted, rgba(255,255,255,0.4))' }}>
					Saved {new Date(preset.savedAt).toLocaleString()} • {panelCount} panel{panelCount === 1 ? '' : 's'}
				</span>
			</div>
			<div style={{ display: 'flex', gap: 6 }}>
				<button
					onClick={() => loadCanvasPreset(preset.id)}
					style={{ ...actionBtnStyle, background: 'rgba(77,171,232,0.15)', color: '#9ed1ff', borderColor: 'rgba(77,171,232,0.2)' }}
				>
					Load
				</button>
				<button
					onClick={() => {
						if (window.confirm(`Delete preset "${preset.name}"?`)) {
							deleteCanvasPreset(preset.id)
						}
					}}
					style={{ ...actionBtnStyle, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.2)' }}
				>
					Delete
				</button>
			</div>
		</div>
	)
}

const SettingsPane: React.FC = () => {
	const open = useWorkspaceStore((s) => s.settingsOpen)
	const close = useWorkspaceStore((s) => s.toggleSettings)
	const prefs = useWorkspaceStore((s) => s.prefs)
	const updatePrefs = useWorkspaceStore((s) => s.updatePrefs)
	const keybindings = useWorkspaceStore((s) => s.keybindings)
	const updateAvailable = useWorkspaceStore((s) => s.updateAvailable)
	const updateProgress = useWorkspaceStore((s) => s.updateProgress)
	const updateStatus = useWorkspaceStore((s) => s.updateStatus)
	const startUpdate = useWorkspaceStore((s) => s.startUpdate)
	const [active, setActive] = useState<Section>("appearance")
	const [version, setVersion] = useState("")
	const [recordingId, setRecordingId] = useState<string | null>(null)
	const [recordedCombo, setRecordedCombo] = useState("")
	const [tempBgColor, setTempBgColor] = useState(prefs.canvasBgColor || "#1f2024")
	const [shortcutSearch, setShortcutSearch] = useState("")
	// Current OS platform — used for platform-specific UI copy (e.g. shell path hints).
	const [platform, setPlatform] = useState<string>('')

	const previousActiveElement = useRef<HTMLElement | null>(null)

	useEffect(() => {
		if (open) {
			previousActiveElement.current = document.activeElement as HTMLElement | null
		} else {
			if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
				previousActiveElement.current.focus()
			}
		}
	}, [open])

	useEffect(() => {
		window.electronAPI?.getPlatform().then(setPlatform).catch(() => {})
	}, [])

	useEffect(() => {
		setTempBgColor(prefs.canvasBgColor || "#1f2024")
	}, [prefs.canvasBgColor])

	const openKeybindingsJson = async () => {
		const api = window.electronAPI
		if (!api) return
		const home = await api.fs.home()
		if (!home) return
		const filePath = `${home}/.config/deck/keybindings.json`
		
		const store = useWorkspaceStore.getState()
		const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
		const cx = (window.innerWidth / 2 - store.viewport.x) / store.viewport.zoom
		const cy = (window.innerHeight / 2 - store.viewport.y) / store.viewport.zoom
		
		store.addPanel({
			id,
			type: 'editor',
			x: cx - 400,
			y: cy - 250,
			width: 800,
			height: 500,
			title: 'keybindings.json',
			settings: { filePath, folderPath: `${home}/.config/deck` },
			createdAt: Date.now()
		})
		close()
	}

	const revealConfigFolder = async () => {
		const api = window.electronAPI
		if (!api) return
		const home = await api.fs.home()
		if (!home) return
		const filePath = `${home}/.config/deck/keybindings.json`
		await api.fs.reveal(filePath)
	}

	// Esc closes — only attach while open.
	useEffect(() => {
		if (!open) return
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				close()
			}
		}
		window.addEventListener("keydown", esc, true)
		return () => window.removeEventListener("keydown", esc, true)
	}, [open, close])

	// Capture key combination for remapping.
	useEffect(() => {
		if (!recordingId) return

		const handleRecord = (e: KeyboardEvent) => {
			e.preventDefault()
			e.stopPropagation()
			e.stopImmediatePropagation()

			const combo = serializeKeyEvent(e)
			if (combo) {
				setRecordedCombo(combo)
			}
		}

		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault()
				if (recordedCombo) {
					useWorkspaceStore.getState().updateKeybinding(recordingId, recordedCombo)
				}
				setRecordingId(null)
				setRecordedCombo("")
			} else if (e.key === "Escape") {
				e.preventDefault()
				setRecordingId(null)
				setRecordedCombo("")
			}
		}

		window.addEventListener("keydown", handleRecord, true)
		window.addEventListener("keyup", handleKeyUp, true)
		return () => {
			window.removeEventListener("keydown", handleRecord, true)
			window.removeEventListener("keyup", handleKeyUp, true)
		}
	}, [recordingId, recordedCombo])

	// Fetch version once on first open.
	useEffect(() => {
		if (!open || version) return
		window.electronAPI
			?.getAppVersion?.()
			.then(setVersion)
			.catch(() => setVersion("dev"))
	}, [open, version])

	// Apply font-size and density live to document root (single source — no double writes).
	useEffect(() => {
		document.documentElement.style.fontSize = `${prefs.fontSize}px`
		document.documentElement.setAttribute('data-density', prefs.density || 'cozy')
	}, [prefs.fontSize, prefs.density])

	if (!open) return null

	return createPortal(
		<div
			className="gs-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) close()
			}}>
			<div
				className="gs-panel settings-panel"
				style={{
					width: "min(760px, calc(100vw - 64px))",
					maxHeight: "calc(100vh - 120px)",
				}}
				onMouseDown={(e) => e.stopPropagation()}>
				<div className="gs-head">
					<span className="gs-icon">⚙</span>
					<span style={{ flex: 1, fontWeight: 600 }}>Preferences</span>
					<button className="gs-close" onClick={close}>
						×
					</button>
				</div>
				<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
					<div
						style={{
							width: 160,
							borderRight: "1px solid var(--panel-border, rgba(255,255,255,0.06))",
							padding: "8px 0",
							flexShrink: 0,
						}}>
						{SECTIONS.map((s) => (
							<button
								key={s.id}
								onClick={() => setActive(s.id)}
								style={{
									display: "block",
									width: "100%",
									textAlign: "left",
									padding: "8px 14px",
									border: "none",
									background:
										active === s.id ? "color-mix(in srgb, var(--selection-color, #4dabe8) 12%, transparent)" : "transparent",
									color: active === s.id ? "var(--selection-color, #9ed1ff)" : "var(--fg-muted, rgba(255,255,255,0.75))",
									fontSize: 12.5,
									cursor: "pointer",
									fontFamily: "inherit",
								}}>
								{s.label}
							</button>
						))}
					</div>
					<div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
						{active === "appearance" && (
							<div>
								<Field
									label="Canvas background color"
									description="Sets a custom background color for the infinite canvas. Drag the color box or type a hex color."
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
										<div
											onClick={() => document.getElementById('canvas-bg-color-picker')?.click()}
											style={{
												width: 28,
												height: 28,
												borderRadius: 6,
												background: tempBgColor,
												border: '1px solid var(--panel-border, rgba(255, 255, 255, 0.15))',
												cursor: 'pointer',
												flexShrink: 0,
												boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)'
											}}
											title="Open color picker"
										/>
										<input
											id="canvas-bg-color-picker"
											type="color"
											value={tempBgColor}
											onInput={(e) => {
												const val = (e.target as HTMLInputElement).value
												setTempBgColor(val)
												window.__updateDynamicTheme?.(val)
											}}
											onChange={(e) => {
												const val = e.target.value
												setTempBgColor(val)
												updatePrefs({ canvasBgColor: val })
											}}
											style={{ display: 'none' }}
										/>
										<input
											type="text"
											value={tempBgColor}
											onChange={(e) => {
												const val = e.target.value
												setTempBgColor(val)
												if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
													window.__updateDynamicTheme?.(val)
													updatePrefs({ canvasBgColor: val })
												}
											}}
											placeholder="#1f2024"
											style={{
												...textInputStyle,
												width: 90,
												minWidth: 90,
												fontFamily: 'JetBrains Mono, monospace',
												textTransform: 'uppercase'
											}}
										/>
										<button
											onClick={() => {
												updatePrefs({ canvasBgColor: tempBgColor })
											}}
											style={actionBtnStyle}
										>
											Verify & Apply
										</button>
										<button
											onClick={() => {
												const name = `custom-bg-${Date.now()}`
												const next = { ...(prefs.customBgColors || {}), [name]: tempBgColor }
												updatePrefs({ customBgColors: next, canvasBgColor: tempBgColor })
											}}
											style={{
												...actionBtnStyle,
												background: 'var(--selection-color, #4dabe8)',
												color: 'var(--btn-text, #000)',
												borderColor: 'transparent'
											}}
										>
											Save Preset
										</button>
										<button
											onClick={() => {
												setTempBgColor('#1f2024')
												updatePrefs({ canvasBgColor: '' })
												window.__updateDynamicTheme?.('#1f2024')
											}}
											style={{
												...actionBtnStyle,
												color: 'var(--error-fg, #ff8585)',
												borderColor: 'var(--error-border, rgba(235, 94, 85, 0.3))'
											}}
										>
											Reset
										</button>
									</div>
								</Field>

								<Field
									label="Suggested presets"
									description="Switch to standard optimized background colors: Deep Blue, Slate Black, Pure White, Creamy Pearl, or Midnight."
								>
									<div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%' }}>
										{[
											{ name: 'Deep Blue', color: '#0b132b' },
											{ name: 'Slate Black', color: '#0c0c0e' },
											{ name: 'Pure White', color: '#ffffff' },
											{ name: 'Creamy Pearl', color: '#f5f2eb' },
											{ name: 'Midnight', color: '#0d1117' }
										].map((preset) => (
											<div
												key={preset.name}
												style={{
													width: 24,
													height: 24,
													borderRadius: '50%',
													background: preset.color,
													border: '1px solid var(--panel-border, rgba(255, 255, 255, 0.15))',
													cursor: 'pointer',
													boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
													transition: 'transform 100ms'
												}}
												onClick={() => {
													setTempBgColor(preset.color)
													updatePrefs({ canvasBgColor: preset.color })
													window.__updateDynamicTheme?.(preset.color)
												}}
												title={preset.name}
											/>
										))}
									</div>
								</Field>

								{prefs.customBgColors && Object.keys(prefs.customBgColors).length > 0 && (
									<Field
										label="Saved custom presets"
										description="Quickly switch to or delete your saved custom background colors."
									>
										<div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%' }}>
											{Object.entries(prefs.customBgColors).map(([id, color]) => (
												<div
													key={id}
													className="swatch-item"
													style={{
														position: 'relative',
														width: 24,
														height: 24,
														borderRadius: '50%',
														background: color,
														border: '1px solid var(--panel-border, rgba(255, 255, 255, 0.15))',
														cursor: 'pointer',
														boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
													}}
													onClick={() => {
														setTempBgColor(color)
														updatePrefs({ canvasBgColor: color })
														window.__updateDynamicTheme?.(color)
													}}
													title={color}
												>
													<button
														onClick={(e) => {
															e.stopPropagation()
															const next = { ...prefs.customBgColors }
															delete next[id]
															updatePrefs({ customBgColors: next })
														}}
														className="delete-swatch-btn"
														style={{
															position: 'absolute',
															top: -4,
															right: -4,
															width: 14,
															height: 14,
															borderRadius: '50%',
															background: 'var(--error-fg, #ff8585)',
															color: '#fff',
															border: 'none',
															fontSize: 9,
															lineHeight: '14px',
															textAlign: 'center',
															padding: 0,
															cursor: 'pointer',
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'center',
															boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
															opacity: 0,
															transition: 'opacity 100ms'
														}}
													>
														×
													</button>
												</div>
											))}
										</div>
									</Field>
								)}
								<Field
									label="UI font size"
									description="Adjusts the base font size of the application UI elements (menus, sidebar, headers) in pixels."
								>
									<input
										type="range"
										min={11}
										max={16}
										step={0.5}
										value={prefs.fontSize}
										onChange={(e) =>
											updatePrefs({ fontSize: parseFloat(e.target.value) })
										}
										style={{ flex: 1 }}
									/>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={11}
											max={16}
											step={0.5}
											value={prefs.fontSize}
											onChange={(e) => {
												const val = parseFloat(e.target.value)
												if (!isNaN(val)) {
													updatePrefs({ fontSize: Math.max(11, Math.min(16, val)) })
												}
											}}
											style={{
												...textInputStyle,
												width: 60,
												minWidth: 60,
												textAlign: "center",
												padding: "3px 6px",
												fontFamily: "JetBrains Mono, monospace",
												fontSize: 11.5,
											}}
										/>
										<span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", opacity: 0.8 }}>px</span>
									</div>
								</Field>
								<Field
									label="Density"
									description="Controls the vertical spacing (padding, heights, margins) across all tree views, outlines, sidebars, and panels. 'Compact' is optimized for high-density information; 'Comfortable' offers more breathing room."
								>
									<select
										value={prefs.density}
										onChange={(e) =>
											updatePrefs({
												density: e.target.value as
													| "compact"
													| "cozy"
													| "comfortable",
											})
										}
										style={inputStyle}>
										<option value="compact">Compact</option>
										<option value="cozy">Cozy (default)</option>
										<option value="comfortable">Comfortable</option>
									</select>
								</Field>
								<Field
									label="Animations"
									description="Enables or disables visual transition animations for zooming, focusing, and moving panels on the canvas."
								>
									<Toggle
										on={prefs.animations}
										onChange={(v) => updatePrefs({ animations: v })}
									/>
								</Field>
								<div style={{ fontWeight: 600, fontSize: 13, marginTop: 18, marginBottom: 8, color: 'var(--fg, #e6e8ec)' }}>
									Canvas Background & Panel Styling
								</div>
								<Field
									label="Canvas background style"
									description="Sets the visual background grid style of the infinite canvas workspace."
								>
									<select
										value={prefs.canvasGridStyle ?? "grid"}
										onChange={(e) =>
											updatePrefs({
												canvasGridStyle: e.target.value as 'grid' | 'dot' | 'blueprint' | 'neon' | 'none',
											})
										}
										style={inputStyle}>
										<option value="grid">Default Grid</option>
										<option value="dot">Dot Grid</option>
										<option value="blueprint">Blueprint Grid</option>
										<option value="neon">Cyberpunk Neon Grid</option>
										<option value="none">None (Solid Color)</option>
									</select>
								</Field>
								{((prefs.canvasGridStyle ?? 'grid') !== 'none') && (
									<Field
										label="Grid spacing"
										description="Adjusts the grid pattern cell spacing on the canvas in pixels."
									>
										<input
											type="range"
											min={10}
											max={100}
											step={5}
											value={prefs.canvasGridSize ?? 20}
											onChange={(e) =>
												updatePrefs({ canvasGridSize: parseInt(e.target.value, 10) })
											}
											style={{ flex: 1 }}
										/>
										<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
											<input
												type="number"
												min={10}
												max={100}
												step={5}
												value={prefs.canvasGridSize ?? 20}
												onChange={(e) => {
													const val = parseInt(e.target.value, 10)
													if (!isNaN(val)) {
														updatePrefs({ canvasGridSize: Math.max(10, Math.min(100, val)) })
													}
												}}
												style={{
													...textInputStyle,
													width: 60,
													minWidth: 60,
													textAlign: "center",
													padding: "3px 6px",
													fontFamily: "JetBrains Mono, monospace",
													fontSize: 11.5,
												}}
											/>
											<span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", opacity: 0.8 }}>px</span>
										</div>
									</Field>
								)}
								<Field
									label="Canvas background image URL"
									description="Sets an optional custom image URL as the background of the infinite canvas."
								>
									<input
										type="text"
										value={prefs.canvasBgImage ?? ""}
										onChange={(e) =>
											updatePrefs({
												canvasBgImage: e.target.value,
											})
										}
										placeholder="e.g. https://example.com/bg.jpg"
										style={{ ...textInputStyle, flex: 1 }}
									/>
								</Field>
								<Field
									label="Panel glass opacity"
									description="Adjusts the opacity level (transparency) of glassmorphic panels. Slider goes from 0.1 (fully transparent) to 1.0 (fully opaque)."
								>
									<input
										type="range"
										min={0.1}
										max={1.0}
										step={0.05}
										value={prefs.panelGlassOpacity ?? 0.85}
										onChange={(e) =>
											updatePrefs({ panelGlassOpacity: parseFloat(e.target.value) })
										}
										style={{ flex: 1 }}
									/>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={10}
											max={100}
											step={5}
											value={Math.round((prefs.panelGlassOpacity ?? 0.85) * 100)}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10)
												if (!isNaN(val)) {
													updatePrefs({ panelGlassOpacity: Math.max(0.1, Math.min(1.0, val / 100)) })
												}
											}}
											style={{
												...textInputStyle,
												width: 60,
												minWidth: 60,
												textAlign: "center",
												padding: "3px 6px",
												fontFamily: "JetBrains Mono, monospace",
												fontSize: 11.5,
											}}
										/>
										<span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", opacity: 0.8 }}>%</span>
									</div>
								</Field>
								<Field
									label="Panel glass blur (px)"
									description="Adjusts the backdrop blur filter radius behind glassmorphic panels in pixels."
								>
									<input
										type="range"
										min={0}
										max={30}
										step={1}
										value={prefs.panelGlassBlur ?? 12}
										onChange={(e) =>
											updatePrefs({ panelGlassBlur: parseInt(e.target.value, 10) })
										}
										style={{ flex: 1 }}
									/>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={0}
											max={30}
											step={1}
											value={prefs.panelGlassBlur ?? 12}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10)
												if (!isNaN(val)) {
													updatePrefs({ panelGlassBlur: Math.max(0, Math.min(30, val)) })
												}
											}}
											style={{
												...textInputStyle,
												width: 60,
												minWidth: 60,
												textAlign: "center",
												padding: "3px 6px",
												fontFamily: "JetBrains Mono, monospace",
												fontSize: 11.5,
											}}
										/>
										<span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", opacity: 0.8 }}>px</span>
									</div>
								</Field>
								<Field
									label="Default editor font size"
									description="Sets the default font size (in pixels) for the code editor. Individual editor panels can override this."
								>
									<input
										type="number"
										min={10}
										max={30}
										value={prefs.editorFontSize ?? 14}
										onChange={(e) =>
											updatePrefs({
												editorFontSize: parseInt(e.target.value, 10) || 14,
											})
										}
										style={{ ...textInputStyle, width: 80, minWidth: 80 }}
									/>
									<span style={{ opacity: 0.5, fontSize: 11 }}>px</span>
								</Field>
								<Field
									label="Default editor font family"
									description="Specifies the CSS font family string for the code editor (e.g. 'JetBrains Mono', monospace). Applied inside Monaco editor frames."
								>
									<input
										type="text"
										value={prefs.editorFontFamily ?? ""}
										onChange={(e) =>
											updatePrefs({
												editorFontFamily: e.target.value,
											})
										}
										placeholder="e.g. 'JetBrains Mono', monospace"
										style={{ ...textInputStyle, flex: 1 }}
									/>
								</Field>
								<Field
									label="Default editor word wrap"
									description="Controls whether lines in the code editor wrap automatically or overflow horizontally. Individual editors can override this."
								>
									<select
										value={prefs.editorWordWrap ?? "off"}
										onChange={(e) =>
											updatePrefs({
												editorWordWrap: e.target.value as "on" | "off",
											})
										}
										style={inputStyle}>
										<option value="off">Off</option>
										<option value="on">On</option>
									</select>
								</Field>
								<Field
									label="Default terminal font size"
									description="Sets the default font size (in pixels) for terminal windows."
								>
									<input
										type="number"
										min={10}
										max={30}
										value={prefs.terminalFontSize ?? 15}
										onChange={(e) =>
											updatePrefs({
												terminalFontSize: parseInt(e.target.value, 10) || 15,
											})
										}
										style={{ ...textInputStyle, width: 80, minWidth: 80 }}
									/>
									<span style={{ opacity: 0.5, fontSize: 11 }}>px</span>
								</Field>
								<Field
									label="Default terminal font family"
									description="Specifies the CSS font family string for terminal text rendering. Applied inside Xterm canvas layers."
								>
									<input
										type="text"
										value={prefs.terminalFontFamily ?? ""}
										onChange={(e) =>
											updatePrefs({
												terminalFontFamily: e.target.value,
											})
										}
										placeholder="e.g. 'JetBrains Mono', monospace"
										style={{ ...textInputStyle, flex: 1 }}
									/>
								</Field>
								<Field
									label="Terminal Shell Path"
									description={platform === 'win32'
										? "Absolute path to the shell executable to spawn for terminal panels (e.g. powershell.exe or C:\\Windows\\System32\\cmd.exe). Leave empty to use system default."
										: "Absolute path to the system shell executable to spawn for terminal panels (e.g. /bin/bash or /usr/bin/zsh). Leave empty to use system default."
									}
								>
									<input
										type="text"
										value={prefs.defaultTerminalShell ?? ""}
										onChange={(e) =>
											updatePrefs({
												defaultTerminalShell: e.target.value,
											})
										}
										placeholder={platform === 'win32' ? 'e.g. powershell.exe' : 'e.g. /bin/bash'}
										style={{ ...textInputStyle, flex: 1 }}
									/>
								</Field>
								<Field
									label="Terminal Scrollback"
									description="The maximum number of lines kept in the terminal scrollback buffer."
								>
									<input
										type="number"
										min={100}
										max={100000}
										value={prefs.terminalScrollback ?? 10000}
										onChange={(e) =>
											updatePrefs({
												terminalScrollback: parseInt(e.target.value, 10) || 10000,
											})
										}
										style={{ ...textInputStyle, width: 100, minWidth: 100 }}
									/>
									<span style={{ opacity: 0.5, fontSize: 11 }}>lines</span>
								</Field>
								<Field
									label="Header double-click action"
									description="Specifies what happens when you double-click a panel's title bar (None, Minimize, Focus Zoom, or Rename)."
								>
									<select
										value={prefs.panelHeaderDoubleClick ?? "rename"}
										onChange={(e) =>
											updatePrefs({
												panelHeaderDoubleClick: e.target.value as "none" | "minimize" | "focus" | "rename",
											})
										}
										style={inputStyle}>
										<option value="none">Disabled (No-op)</option>
										<option value="minimize">Minimize/Restore panel</option>
										<option value="focus">Focus Zoom (Toggle fullscreen)</option>
										<option value="rename">Rename panel title</option>
									</select>
								</Field>
							</div>
						)}
						{active === "canvas" && (
							<div>
								<Field
									label="Show cursor coords in status bar"
									description="Displays the active mouse cursor coordinates relative to the infinite world canvas in the status bar."
								>
									<Toggle
										on={prefs.showCursorReadout}
										onChange={(v) => updatePrefs({ showCursorReadout: v })}
									/>
								</Field>
								<Field
									label="Default browser home URL"
									description="The starting webpage URL loaded by newly spawned browser panels."
								>
									<input
										type="text"
										value={prefs.browserHomeUrl ?? "https://google.com"}
										onChange={(e) =>
											updatePrefs({
												browserHomeUrl: e.target.value,
											})
										}
										placeholder="e.g. https://google.com"
										style={{ ...textInputStyle, flex: 1 }}
									/>
								</Field>
								<Field
									label="Lazy load background browser tabs"
									description="If enabled, browser panels created in stacked/background tabs will only load their web content when they are first focused, saving memory and CPU."
								>
									<Toggle
										on={prefs.browserLazyLoad ?? false}
										onChange={(v) => updatePrefs({ browserLazyLoad: v })}
									/>
								</Field>
								<Field
									label="Double-click empty canvas to create"
									description="Determines which type of panel is spawned automatically at the cursor coordinates when double-clicking on empty canvas space."
								>
									<select
										value={prefs.doubleClickToCreate ?? "none"}
										onChange={(e) =>
											updatePrefs({
												doubleClickToCreate: e.target.value as "none" | "terminal" | "editor" | "browser",
											})
										}
										style={inputStyle}>
										<option value="none">Disabled (No-op)</option>
										<option value="terminal">Terminal Panel</option>
										<option value="editor">Editor Panel</option>
										<option value="browser">Browser Panel</option>
									</select>
								</Field>

								<div style={{ fontWeight: 600, fontSize: 13, marginTop: 18, marginBottom: 8, color: 'var(--fg, #e6e8ec)' }}>
									Default Spawn Dimensions (px)
								</div>
								<Field
									label="Terminal default size"
									description="Default spawn size (width x height in pixels) for terminal panels."
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={200}
											max={4000}
											value={prefs.defaultPanelWidthTerminal ?? 600}
											onChange={(e) =>
												updatePrefs({
													defaultPanelWidthTerminal: parseInt(e.target.value, 10) || 600,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>W</span>
										<span style={{ opacity: 0.3, margin: '0 4px' }}>×</span>
										<input
											type="number"
											min={150}
											max={3000}
											value={prefs.defaultPanelHeightTerminal ?? 400}
											onChange={(e) =>
												updatePrefs({
													defaultPanelHeightTerminal: parseInt(e.target.value, 10) || 400,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>H</span>
									</div>
								</Field>
								<Field
									label="Editor default size"
									description="Default spawn size (width x height in pixels) for code editor panels."
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={200}
											max={4000}
											value={prefs.defaultPanelWidthEditor ?? 1100}
											onChange={(e) =>
												updatePrefs({
													defaultPanelWidthEditor: parseInt(e.target.value, 10) || 1100,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>W</span>
										<span style={{ opacity: 0.3, margin: '0 4px' }}>×</span>
										<input
											type="number"
											min={150}
											max={3000}
											value={prefs.defaultPanelHeightEditor ?? 760}
											onChange={(e) =>
												updatePrefs({
													defaultPanelHeightEditor: parseInt(e.target.value, 10) || 760,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>H</span>
									</div>
								</Field>
								<Field
									label="Browser default size"
									description="Default spawn size (width x height in pixels) for web browser panels."
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<input
											type="number"
											min={200}
											max={4000}
											value={prefs.defaultPanelWidthBrowser ?? 720}
											onChange={(e) =>
												updatePrefs({
													defaultPanelWidthBrowser: parseInt(e.target.value, 10) || 720,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>W</span>
										<span style={{ opacity: 0.3, margin: '0 4px' }}>×</span>
										<input
											type="number"
											min={150}
											max={3000}
											value={prefs.defaultPanelHeightBrowser ?? 560}
											onChange={(e) =>
												updatePrefs({
													defaultPanelHeightBrowser: parseInt(e.target.value, 10) || 560,
												})
											}
											style={{ ...textInputStyle, width: 80, minWidth: 80 }}
										/>
										<span style={{ opacity: 0.5, fontSize: 11 }}>H</span>
									</div>
								</Field>
								<div
									style={{
										marginTop: 14,
										padding: 10,
										background: "rgba(255,255,255,0.04)",
										borderRadius: 6,
										fontSize: 11.5,
										opacity: 0.7,
										lineHeight: 1.5,
									}}>
									Drag-snap, alignment guides, panel drag/resize behavior are
									all live — these only configure presentation.
								</div>
							</div>
						)}
						{active === "layouts" && (
							<div>
								<div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--fg, #e6e8ec)' }}>
									Save Current Layout
								</div>
								<div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
									<input
										type="text"
										id="new-preset-name-input"
										placeholder="Layout preset name..."
										style={{ ...textInputStyle, flex: 1 }}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												const val = (e.target as HTMLInputElement).value.trim()
												if (val) {
													useWorkspaceStore.getState().saveCanvasPreset(val)
													;(e.target as HTMLInputElement).value = ''
												}
											}
										}}
									/>
									<button
										style={btnStyle}
										onClick={() => {
											const el = document.getElementById('new-preset-name-input') as HTMLInputElement | null
											const val = el?.value.trim()
											if (val) {
												useWorkspaceStore.getState().saveCanvasPreset(val)
												if (el) el.value = ''
											}
										}}
									>
										Save Layout
									</button>
								</div>

								<div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--fg, #e6e8ec)' }}>
									Saved Layout Presets
								</div>
								{Object.keys(useWorkspaceStore.getState().canvasPresets).length === 0 ? (
									<div style={{ fontSize: 12, color: 'var(--fg-muted, rgba(255,255,255,0.4))', fontStyle: 'italic' }}>
										No saved layout presets yet.
									</div>
								) : (
									<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
										{Object.values(useWorkspaceStore.getState().canvasPresets)
											.sort((a, b) => b.savedAt - a.savedAt)
											.map(preset => (
												<LayoutPresetRow key={preset.id} preset={preset} />
											))
										}
									</div>
								)}
							</div>
						)}
						{active === "shortcuts" && (
							<div style={{ fontSize: 12 }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
									<span style={{ opacity: 0.6 }}>Configuration & Keybindings (.json)</span>
									<div style={{ display: 'flex', gap: 8 }}>
										<button onClick={() => useWorkspaceStore.getState().resetKeybindings()} style={actionBtnStyle}>
											Reset Defaults
										</button>
										<button onClick={openKeybindingsJson} style={actionBtnStyle}>
											Edit JSON (Monaco)
										</button>
										<button onClick={revealConfigFolder} style={actionBtnStyle}>
											📁 Open Folder
										</button>
									</div>
								</div>

								{/* Search Bar for Keybindings */}
								<div style={{ marginBottom: 12 }}>
									<input
										type="text"
										placeholder="Search shortcuts by action name, command description, or key..."
										value={shortcutSearch}
										onChange={(e) => setShortcutSearch(e.target.value)}
										style={{
											...textInputStyle,
											width: '100%',
											boxSizing: 'border-box'
										}}
									/>
								</div>

								<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0 24px', marginTop: 12 }}>
									{COMMANDS_META.filter(cmd => {
										const query = shortcutSearch.toLowerCase().trim()
										if (!query) return true
										const key = (keybindings[cmd.id] || '').toLowerCase()
										return (
											cmd.label.toLowerCase().includes(query) ||
											cmd.description.toLowerCase().includes(query) ||
											cmd.id.toLowerCase().includes(query) ||
											key.includes(query)
										)
									}).map(cmd => {
										const currentKey = keybindings[cmd.id] || "None"
										return (
											<div key={cmd.id} style={shortcutRowStyle}>
												<div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
													<div style={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.3, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={cmd.label}>{cmd.label}</div>
													<div style={{ opacity: 0.5, fontSize: 11, marginTop: 2, lineHeight: 1.3, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={cmd.description}>{cmd.description}</div>
												</div>
												<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
													<span style={keyStyle}>{currentKey.toUpperCase()}</span>
													<button
														onClick={() => {
															setRecordingId(cmd.id)
															setRecordedCombo(currentKey)
														}}
														style={editBtnStyle}
													>
														✏️ Edit
													</button>
												</div>
											</div>
										)
									})}
								</div>

								{recordingId && (
									<div style={modalBackdropStyle}>
										<div style={modalStyle}>
											<div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--fg, #e6e8ec)' }}>
												Press keys to bind to:
											</div>
											<div style={{ fontSize: 14, fontWeight: 700, color: 'var(--selection-color, #9ed1ff)', marginBottom: 12 }}>
												{COMMANDS_META.find(c => c.id === recordingId)?.label}
											</div>
											<div style={recordComboStyle}>
												{recordedCombo ? recordedCombo.toUpperCase() : "PRESS KEYS..."}
											</div>
											<div style={{ opacity: 0.5, fontSize: 11, marginBottom: 16, lineHeight: 1.4, color: 'var(--fg-muted)' }}>
												Release modifiers then press <strong style={{ color: 'var(--fg, #fff)' }}>Enter</strong> to save, or <strong style={{ color: 'var(--fg, #fff)' }}>Esc</strong> to cancel.
											</div>
											<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
												<button
													style={btnStyle}
													onClick={() => {
														if (recordedCombo) useWorkspaceStore.getState().updateKeybinding(recordingId, recordedCombo)
														setRecordingId(null)
														setRecordedCombo("")
													}}
													disabled={!recordedCombo}
												>
													Save
												</button>
												<button
													style={{ ...btnStyle, background: 'rgba(255,255,255,0.08)', color: '#fff' }}
													onClick={() => {
														setRecordingId(null)
														setRecordedCombo("")
													}}
												>
													Cancel
												</button>
											</div>
										</div>
									</div>
								)}
							</div>
						)}
						{active === "fontsHelp" && (
							<div style={{ fontSize: 12.5, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 16 }}>
								<div style={{ fontSize: 16, fontWeight: 600, color: 'var(--selection-color, #9ed1ff)', borderBottom: '1px solid var(--panel-border, rgba(255,255,255,0.08))', paddingBottom: 6 }}>
									Customization & Fonts Guide
								</div>

								<div>
									<div style={{ fontWeight: 600, color: 'var(--fg, #e6e8ec)', fontSize: 13, marginBottom: 4 }}>
										⚡ Layout Density
									</div>
									<div style={{ opacity: 0.8 }}>
										The <strong>Density</strong> setting adjusts vertical padding, item heights, tree nodes, outline rows, sidebar items, and window header margins.
										This is applied globally by setting a <code>data-density</code> attribute (<code>compact</code>, <code>cozy</code>, or <code>comfortable</code>) directly on the root document element. All styles adapt fluidly using CSS variables.
									</div>
								</div>

								<div>
									<div style={{ fontWeight: 600, color: 'var(--fg, #e6e8ec)', fontSize: 13, marginBottom: 4 }}>
										🎨 How Fonts Work in Deck
									</div>
									<div style={{ opacity: 0.8, marginBottom: 8 }}>
										Because Deck is built on web technologies (Monaco for editors, Xterm for terminals), it references the fonts installed on your local operating system. It does not preload arbitrary large font files, so your custom font configurations must match the <strong>exact family names</strong> installed on your machine.
									</div>
									<div style={{ opacity: 0.8 }}>
										Fonts are applied separately for different contexts:
										<ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
											<li><strong>Editor Fonts:</strong> Applied inside Monaco Code Editor containers.</li>
											<li><strong>Terminal Fonts:</strong> Applied inside canvas-based Xterm terminals.</li>
											<li><strong>UI Fonts:</strong> Follows the default sans-serif font stack of the application chrome.</li>
										</ul>
									</div>
								</div>

								<div>
									<div style={{ fontWeight: 600, color: 'var(--fg, #e6e8ec)', fontSize: 13, marginBottom: 4 }}>
										📦 Commonly Preloaded / Supported Monospace Fonts
									</div>
									<div style={{ opacity: 0.8, marginBottom: 8 }}>
										The following monospace font families are widely available or pre-configured as fallbacks in standard Linux environments:
									</div>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
										<div>• JetBrains Mono</div>
										<div>• Fira Code</div>
										<div>• Hack</div>
										<div>• Source Code Pro</div>
										<div>• Cascadia Code</div>
										<div>• SF Mono / SFPro</div>
										<div>• DejaVu Sans Mono</div>
										<div>• Ubuntu Mono</div>
										<div>• Liberation Mono</div>
										<div>• Monospace (System Fallback)</div>
									</div>
								</div>

								<div>
									<div style={{ fontWeight: 600, color: '#e6e8ec', fontSize: 13, marginBottom: 4 }}>
										🚀 How to Add Custom Fonts (Linux / Windows)
									</div>
									<div style={{ opacity: 0.8, marginBottom: 8 }}>
										To use custom or patched fonts (like <em>Nerd Fonts</em> for icons) in your editor and terminal:
									</div>
									<div style={{ background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid #4dabe8', padding: '10px 14px', borderRadius: '0 6px 6px 0', fontSize: 12 }}>
										<strong style={{ color: '#9ed1ff' }}>On Linux:</strong>
										<ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
											<li>Download your font files (e.g. <code>.ttf</code> or <code>.otf</code>).</li>
											<li>Copy them to your user font directory: <code>~/.local/share/fonts/</code> (create it if missing).</li>
											<li>Regenerate your system font cache by running:
												<pre style={{ margin: '4px 0', background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', width: 'fit-content' }}>fc-cache -fv</pre>
											</li>
											<li>Specify the exact font name in settings, e.g. <code>{"'FiraCode Nerd Font'"}</code>.</li>
										</ol>
										<div style={{ marginTop: 8 }}>
											<strong style={{ color: '#9ed1ff' }}>On Windows:</strong> Double-click the font file and choose {"\"Install for all users\""}.
										</div>
									</div>
								</div>

								<div>
									<div style={{ fontWeight: 600, color: 'var(--fg, #e6e8ec)', fontSize: 13, marginBottom: 4 }}>
										⚙️ Configuration Formats
									</div>
									<div style={{ opacity: 0.8 }}>
										When typing font families, use CSS-compliant font-family syntax. Wrap names containing spaces in single or double quotes, and provide comma-separated fallbacks:
										<pre style={{ marginTop: 6, background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, overflowX: 'auto' }}>
											{"\"JetBrainsMono Nerd Font\", \"JetBrains Mono\", monospace"}
										</pre>
									</div>
								</div>
							</div>
						)}
						{active === "about" && (
							<div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
								<div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
									Deck
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									<span style={{ opacity: 0.6 }}>version {version || "…"}</span>
									{!updateAvailable ? (
										<span style={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>(latest)</span>
									) : (
										<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
											<button
												onClick={startUpdate}
												disabled={!!updateStatus && !updateStatus.includes('Failed')}
												style={{
													background: 'rgba(77, 171, 232, 0.18)',
													border: '1px solid rgba(77, 171, 232, 0.45)',
													color: '#4dabe8',
													borderRadius: 4,
													padding: '2px 8px',
													fontSize: 11,
													fontWeight: 600,
													cursor: 'pointer',
													fontFamily: 'inherit'
												}}
											>
												Update Available (v{updateAvailable.version})
											</button>
											{updateStatus && <span style={{ opacity: 0.8, fontSize: 11 }}>{updateStatus}</span>}
											{updateProgress !== null && <span style={{ opacity: 0.8, fontSize: 11 }}>{Math.round(updateProgress * 100)}%</span>}
										</div>
									)}
								</div>
								<div style={{ marginTop: 14, opacity: 0.7 }}>
									Spatial infinite-canvas workspace for terminals, editors,
									browsers, and notes.
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	)
}

const inputStyle: React.CSSProperties = {
	background: "var(--input-bg, #1a1c20)",
	border: "1px solid var(--panel-border, rgba(255,255,255,0.12))",
	color: "var(--fg, #e6e8ec)",
	padding: "5px 10px",
	borderRadius: 5,
	fontSize: 12,
	fontFamily: "inherit",
	appearance: "none",
	WebkitAppearance: "none",
	cursor: "pointer",
	minWidth: 180,
}

const textInputStyle: React.CSSProperties = {
	background: "var(--input-bg, #1a1c20)",
	border: "1px solid var(--panel-border, rgba(255,255,255,0.12))",
	color: "var(--fg, #e6e8ec)",
	padding: "5px 10px",
	borderRadius: 5,
	fontSize: 12,
	fontFamily: "inherit",
	minWidth: 180,
}

const Field: React.FC<{ label: string; description?: string; children: React.ReactNode }> = ({
	label,
	description,
	children,
}) => (
	<div
		style={{
			display: "flex",
			alignItems: "center",
			gap: 12,
			padding: "10px 0",
			borderBottom: "1px solid var(--panel-border, rgba(255,255,255,0.04))",
		}}>
		<div
			style={{
				width: 180,
				fontSize: 12.5,
				textDecoration: description ? "underline dashed rgba(255,255,255,0.3)" : "none",
				textUnderlineOffset: description ? "3px" : undefined,
				cursor: description ? "help" : "default",
			}}
			title={description}
		>
			{label}
		</div>
		<div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
			{children}
		</div>
	</div>
)


const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({
	on,
	onChange,
}) => (
	<button
		onClick={() => onChange(!on)}
		style={{
			width: 36,
			height: 20,
			border: "none",
			cursor: "pointer",
			borderRadius: 999,
			padding: 2,
			background: on ? "var(--selection-color, #4dabe8)" : "var(--panel-border, rgba(255,255,255,0.18))",
			transition: "background 120ms",
			position: "relative",
		}}>
		<span
			style={{
				position: "absolute",
				top: 2,
				left: on ? 18 : 2,
				width: 16,
				height: 16,
				borderRadius: "50%",
				background: "#fff",
				transition: "left 120ms cubic-bezier(0.4, 0.0, 0.2, 1)",
			}}
		/>
	</button>
)

const actionBtnStyle: React.CSSProperties = {
	background: "var(--input-bg, rgba(255,255,255,0.06))",
	border: "1px solid var(--panel-border, rgba(255,255,255,0.1))",
	color: "var(--fg, #e6e8ec)",
	padding: "4px 10px",
	borderRadius: 5,
	fontSize: 11.5,
	cursor: "pointer",
	fontFamily: "inherit",
	transition: "background 100ms",
}

const shortcutRowStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 0",
	borderBottom: "1px solid var(--panel-border, rgba(255,255,255,0.04))",
}

const keyStyle: React.CSSProperties = {
	background: "rgba(0, 0, 0, 0.25)",
	border: "1px solid var(--panel-border, rgba(255,255,255,0.08))",
	padding: "4px 8px",
	borderRadius: 4,
	fontFamily: "JetBrains Mono, monospace",
	fontSize: 11,
	color: "var(--selection-color, #9ed1ff)",
	minWidth: 60,
	textAlign: "center",
	display: "inline-block",
}

const editBtnStyle: React.CSSProperties = {
	background: "color-mix(in srgb, var(--selection-color, #4dabe8) 12%, transparent)",
	border: "none",
	borderRadius: 4,
	color: "var(--selection-color, #9ed1ff)",
	padding: "5px 10px",
	fontSize: 11.5,
	cursor: "pointer",
	fontFamily: "inherit",
	transition: "opacity 100ms",
}

const modalBackdropStyle: React.CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	background: "rgba(0,0,0,0.6)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 9999,
}

const modalStyle: React.CSSProperties = {
	background: "var(--modal-bg, #181a1f)",
	border: "1px solid var(--modal-border, rgba(255,255,255,0.08))",
	borderRadius: 8,
	padding: 20,
	width: 320,
	boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
	display: "flex",
	flexDirection: "column",
}

const recordComboStyle: React.CSSProperties = {
	background: "rgba(0,0,0,0.4)",
	border: "1px solid var(--selection-color, rgba(77,171,232,0.3))",
	borderRadius: 5,
	padding: "12px 10px",
	fontFamily: "JetBrains Mono, monospace",
	fontSize: 13,
	color: "var(--selection-color, #4dabe8)",
	textAlign: "center",
	fontWeight: 600,
	letterSpacing: "0.05em",
	marginBottom: 10,
}

const btnStyle: React.CSSProperties = {
	background: "var(--selection-color, #4dabe8)",
	border: "none",
	borderRadius: 5,
	color: "var(--btn-text, #000)",
	padding: "6px 12px",
	fontSize: 12,
	fontWeight: 600,
	cursor: "pointer",
	fontFamily: "inherit",
}

export default SettingsPane
