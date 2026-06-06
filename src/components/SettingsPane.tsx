import React, { useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { useWorkspaceStore, CanvasPreset, WorkspaceState } from "../store/workspaceStore"
import { serializeKeyEvent } from "../App"
import "./GlobalSearch.css"

type Section = "appearance" | "panels" | "workspace" | "layouts" | "shortcuts" | "about"

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
	{ id: "appearance", label: "Appearance", icon: "ti ti-palette" },
	{ id: "panels", label: "Panels", icon: "ti ti-terminal-2" },
	{ id: "workspace", label: "Workspace", icon: "ti ti-layout-kanban" },
	{ id: "layouts", label: "Layouts", icon: "ti ti-layout-grid" },
	{ id: "shortcuts", label: "Shortcuts", icon: "ti ti-keyboard" },
	{ id: "about", label: "About", icon: "ti ti-info-circle" },
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

interface SettingDefinition {
	tab: Section
	label: string
	description?: string
}

const SETTINGS_REGISTRY: SettingDefinition[] = [
	// Appearance tab
	{ tab: 'appearance', label: 'Canvas background color', description: 'Sets a custom background color for the infinite canvas. Drag the color box or type a hex color.' },
	{ tab: 'appearance', label: 'Suggested presets', description: 'Switch to standard optimized background colors: Deep Blue, Slate Black, Pure White, Creamy Pearl, or Midnight.' },
	{ tab: 'appearance', label: 'Saved custom presets', description: 'Quickly switch to or delete your saved custom background colors.' },
	{ tab: 'appearance', label: 'Canvas background style', description: 'Sets the visual background grid style of the infinite canvas workspace.' },
	{ tab: 'appearance', label: 'Grid spacing', description: 'Adjusts the grid pattern cell spacing on the canvas in pixels.' },
	{ tab: 'appearance', label: 'Canvas background image URL', description: 'Sets an optional custom image URL as the background of the infinite canvas. Supports web URLs, local file paths, drag-and-drop files, or pasting images.' },
	{ tab: 'appearance', label: 'Panel glass opacity', description: 'Adjusts the opacity level (transparency) of glassmorphic panels. Slider goes from 0.1 (fully transparent) to 1.0 (fully opaque).' },
	{ tab: 'appearance', label: 'Panel glass blur (px)', description: 'Adjusts the backdrop blur filter radius behind glassmorphic panels in pixels.' },
	{ tab: 'appearance', label: 'UI font size', description: 'Adjusts the base font size of the application UI elements (menus, sidebar, headers) in pixels.' },
	{ tab: 'appearance', label: 'Density', description: "Controls the vertical spacing (padding, heights, margins) across all tree views, outlines, sidebars, and panels. 'Compact' is optimized for high-density information; 'Comfortable' offers more breathing room." },
	{ tab: 'appearance', label: 'Animations', description: 'Enables or disables visual transition animations for zooming, focusing, and moving panels on the canvas.' },

	// Panels tab
	{ tab: 'panels', label: 'Default editor font size', description: 'Sets the default font size (in pixels) for the code editor. Individual editor panels can override this.' },
	{ tab: 'panels', label: 'Default editor font family', description: "Specifies the CSS font family string for the code editor (e.g. 'JetBrains Mono', monospace). Applied inside Monaco editor frames." },
	{ tab: 'panels', label: 'Default editor word wrap', description: 'Controls whether lines in the code editor wrap automatically or overflow horizontally. Individual editors can override this.' },
	{ tab: 'panels', label: 'Default terminal font size', description: 'Sets the default font size (in pixels) for terminal windows.' },
	{ tab: 'panels', label: 'Default terminal font family', description: 'Specifies the CSS font family string for terminal text rendering. Applied inside Xterm canvas layers.' },
	{ tab: 'panels', label: 'Default Terminal Shell', description: 'Select which shell to launch by default for new terminal panels.' },
	{ tab: 'panels', label: 'Confirm Shell Switch', description: "Ask for confirmation before switching a running terminal's shell type (which terminates the active session)." },
	{ tab: 'panels', label: 'Terminal Shell Path', description: 'Absolute path to the system shell executable to spawn for terminal panels.' },
	{ tab: 'panels', label: 'Terminal Scrollback', description: 'Lines of terminal history kept in memory per session.' },
	{ tab: 'panels', label: 'Default browser home URL', description: 'The starting webpage URL loaded by newly spawned browser panels.' },
	{ tab: 'panels', label: 'Lazy load background browser tabs', description: 'Suspends inactive browser panels to save memory.' },

	// Workspace tab
	{ tab: 'workspace', label: 'Show cursor coords in status bar', description: 'Displays the active mouse cursor coordinates relative to the infinite world canvas in the status bar.' },
	{ tab: 'workspace', label: 'Auto-focus on panel create', description: 'Automatically zooms and centers the viewport to frame a newly created panel.' },
	{ tab: 'workspace', label: 'Double-click empty canvas to create', description: 'Determines which type of panel is spawned automatically at the cursor coordinates when double-clicking on empty canvas space.' },
	{ tab: 'workspace', label: 'Header double-click action', description: "What happens when you double-click a panel's title bar." },
	{ tab: 'workspace', label: 'Terminal default size', description: 'Default spawn size (width x height in pixels) for terminal panels.' },
	{ tab: 'workspace', label: 'Editor default size', description: 'Default spawn size (width x height in pixels) for code editor panels.' },
	{ tab: 'workspace', label: 'Browser default size', description: 'Default spawn size (width x height in pixels) for web browser panels.' },

	// Layouts
	{ tab: 'layouts', label: 'layouts' },
	{ tab: 'layouts', label: 'saved layouts' },
	{ tab: 'layouts', label: 'preset' },

	// Shortcuts
	{ tab: 'shortcuts', label: 'shortcuts' },
	{ tab: 'shortcuts', label: 'keybindings' },
	{ tab: 'shortcuts', label: 'command palette' },

	// About
	{ tab: 'about', label: 'about' },
	{ tab: 'about', label: 'help' },
	{ tab: 'about', label: 'fonts' },
	{ tab: 'about', label: 'version' },
	{ tab: 'about', label: 'update' }
]

const SettingsPane: React.FC = () => {
	const open = useWorkspaceStore((s) => s.settingsOpen)
	const close = useWorkspaceStore((s) => s.toggleSettings)
	const prefs = useWorkspaceStore((s) => s.prefs)
	const updatePrefsRaw = useWorkspaceStore((s) => s.updatePrefs)
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
	const [settingsSearchQuery, setSettingsSearchQuery] = useState("")
	const [guideOpen, setGuideOpen] = useState(false)
	const [shortcutRefOpen, setShortcutRefOpen] = useState(false)
	const [undoToast, setUndoToast] = useState<{ visible: boolean; message: string; backup: Partial<WorkspaceStorePrefs> } | null>(null)
	// Current OS platform — used for platform-specific UI copy (e.g. shell path hints).
	const [platform, setPlatform] = useState<string>('')
	const [openAccordion, setOpenAccordion] = useState<string | null>(null)

	const [shellPathInput, setShellPathInput] = useState(prefs.defaultTerminalShell || "")
	const [showShellPathsDropdown, setShowShellPathsDropdown] = useState(false)
	const shellPathsDropdownRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setShellPathInput(prefs.defaultTerminalShell || "")
	}, [prefs.defaultTerminalShell])

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (shellPathsDropdownRef.current && !shellPathsDropdownRef.current.contains(e.target as Node)) {
				setShowShellPathsDropdown(false)
			}
		}
		document.addEventListener('mousedown', handler)
		return () => document.removeEventListener('mousedown', handler)
	}, [])

	const commitShellPath = (path: string) => {
		const trimmed = path.trim()
		if (trimmed) {
			updatePrefs({
				defaultTerminalShell: trimmed
			})
		} else {
			updatePrefs({
				defaultTerminalShell: ""
			})
		}
		setShowShellPathsDropdown(false)
	}

	const handleShellPathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			commitShellPath(shellPathInput)
			e.currentTarget.blur()
		} else if (e.key === 'Escape') {
			setShellPathInput(prefs.defaultTerminalShell || "")
			setShowShellPathsDropdown(false)
			e.currentTarget.blur()
		}
	}

	const handleSelectDropdownItem = (path: string) => {
		setShellPathInput(path)
		commitShellPath(path)
	}

	type WorkspaceStorePrefs = WorkspaceState['prefs']

	const updatePrefs = (val: Partial<WorkspaceStorePrefs>) => {
		setUndoToast(null)
		updatePrefsRaw(val)
	}

	const toggleAccordion = (name: string) => {
		setOpenAccordion((prev) => (prev === name ? null : name))
	}

	const getTabMatchCount = (tabId: Section, query: string): number => {
		if (!query) return 0
		const q = query.toLowerCase()
		return SETTINGS_REGISTRY.filter(item => 
			item.tab === tabId && 
			(item.label.toLowerCase().includes(q) || (item.description && item.description.toLowerCase().includes(q)))
		).length
	}

	const matchSetting = (label: string, description?: string) => {
		// Always return true so that all options and section headers remain rendered in the DOM.
		// Styling (highlighting and dimming) is handled dynamically inside the Field component.
		return true
	}

	const isSectionMatched = (labels: string[]): boolean => {
		if (!settingsSearchQuery) return true
		const q = settingsSearchQuery.toLowerCase()
		return labels.some(label => {
			const found = SETTINGS_REGISTRY.find(item => item.label.toLowerCase() === label.toLowerCase())
			if (!found) return false
			return found.label.toLowerCase().includes(q) || (found.description && found.description.toLowerCase().includes(q))
		})
	}

	const resetSection = (sectionName: string, keys: Array<keyof WorkspaceStorePrefs>) => {
		// 1. Create backup of current prefs
		const backup: Partial<WorkspaceStorePrefs> = {}
		keys.forEach(k => {
			backup[k] = prefs[k] as any
		})
		
		// 2. Define defaults
		const defaults: Partial<WorkspaceStorePrefs> = {
			canvasBgColor: '',
			fontSize: 13,
			density: 'cozy',
			animations: true,
			canvasGridStyle: 'none',
			canvasGridSize: 20,
			canvasBgImage: '',
			panelGlassOpacity: 0.85,
			panelGlassBlur: 12,
			editorFontSize: 14,
			editorFontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
			editorWordWrap: 'off',
			terminalFontSize: 15,
			terminalFontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, monospace",
			defaultTerminalShell: '',
			defaultTerminalShellType: '',
			skipShellSwitchConfirmation: false,
			terminalScrollback: 10000,
			browserHomeUrl: 'https://google.com',
			browserLazyLoad: false,
			showCursorReadout: true,
			doubleClickToCreate: 'none',
			autoFocusOnCreate: true,
			panelHeaderDoubleClick: 'rename',
			defaultPanelWidthTerminal: 600,
			defaultPanelHeightTerminal: 400,
			defaultPanelWidthEditor: 1100,
			defaultPanelHeightEditor: 760,
			defaultPanelWidthBrowser: 720,
			defaultPanelHeightBrowser: 560
		}
		
		// 3. Build reset object
		const updateObj: Partial<WorkspaceStorePrefs> = {}
		keys.forEach(k => {
			updateObj[k] = defaults[k] as any
		})
		
		// Special case for color
		if (keys.includes('canvasBgColor')) {
			setTempBgColor('#1f2024')
			window.__updateDynamicTheme?.('#1f2024')
		}
		
		// 4. Update
		updatePrefs(updateObj)
		
		// 5. Show Toast
		setUndoToast({
			visible: true,
			message: `Reset ${sectionName} to default`,
			backup
		})
	}

	useEffect(() => {
		setUndoToast(null)
	}, [active, settingsSearchQuery])

	useEffect(() => {
		if (!undoToast?.visible) return
		const timer = setTimeout(() => {
			setUndoToast(null)
		}, 5000)
		return () => clearTimeout(timer)
	}, [undoToast])

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
					position: "relative",
				}}
				onMouseDown={(e) => e.stopPropagation()}>
				<div className="gs-head">
					<span className="gs-icon">⚙</span>
					<span style={{ flex: 1, fontWeight: 600 }}>Preferences</span>
					<button className="gs-close" onClick={close}>
						×
					</button>
				</div>
				<style>{`
					@keyframes toastSlideUp {
						from { opacity: 0; transform: translate(-50%, 8px); }
						to { opacity: 1; transform: translate(-50%, 0); }
					}
					.settings-section-header {
						display: flex;
						align-items: center;
						justify-content: space-between;
						font-weight: 600;
						font-size: 13px;
						margin-top: 18px;
						margin-bottom: 8px;
						color: var(--fg, #e6e8ec);
						border-top: 1px solid var(--panel-border, rgba(255,255,255,0.06));
						padding-top: 12px;
					}
					.settings-section-header:first-of-type {
						border-top: none;
						padding-top: 0;
						margin-top: 0;
						border-top: none;
					}
					.settings-reset-btn {
						background: none;
						border: none;
						color: var(--fg-muted, rgba(255,255,255,0.4));
						font-size: 11px;
						cursor: pointer;
						opacity: 0;
						transition: opacity 0.15s ease, color 0.15s ease;
						font-family: inherit;
						padding: 2px 6px;
						border-radius: 4px;
					}
					.settings-section-header:hover .settings-reset-btn {
						opacity: 1;
					}
					.settings-reset-btn:hover {
						color: var(--selection-color, #4dabe8);
						background: rgba(255,255,255,0.04);
					}
					.settings-nested-field {
						padding-left: 16px;
						border-left: 1px dashed rgba(255,255,255,0.08);
						margin-left: 6px;
						margin-top: 6px;
						margin-bottom: 6px;
					}
					.about-accordion-btn {
						width: 100%;
						text-align: left;
						background: rgba(255,255,255,0.02);
						border: 1px solid rgba(255,255,255,0.05);
						border-radius: 6px;
						color: var(--fg, #e6e8ec);
						font-size: 13px;
						font-weight: 600;
						padding: 10px 14px;
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: space-between;
						margin-top: 12px;
						transition: background 0.15s ease;
						border-shadow: none;
						font-family: inherit;
					}
					.about-accordion-btn:hover {
						background: rgba(255,255,255,0.05);
					}
					.sidebar-tab-btn {
						display: flex;
						align-items: center;
						gap: 10px;
						width: 100%;
						text-align: left;
						padding: 8px 14px;
						border: none;
						font-family: inherit;
						box-sizing: border-box;
						transition: all 0.15s ease;
						background: transparent;
						color: var(--fg-muted, rgba(255,255,255,0.75));
						border-left: 2px solid transparent;
						cursor: pointer;
						opacity: 1;
					}
					.sidebar-tab-btn:hover:not(:disabled) {
						background: rgba(255, 255, 255, 0.04);
						color: var(--fg, #e6e8ec);
					}
					.sidebar-tab-btn.active {
						border-left: 2px solid var(--selection-color, #4dabe8) !important;
						background: color-mix(in srgb, var(--selection-color, #4dabe8) 12%, transparent) !important;
						color: var(--selection-color, #9ed1ff) !important;
					}
					.sidebar-tab-btn:disabled {
						opacity: 0.25;
						cursor: not-allowed;
						pointer-events: none;
					}
					.shell-history-dropdown {
						position: absolute;
						top: 100%;
						left: 0;
						width: 100%;
						background: rgba(25, 26, 30, 0.95);
						backdrop-filter: blur(12px);
						border: 1px solid rgba(255, 255, 255, 0.08);
						border-radius: 6px;
						margin-top: 4px;
						z-index: 1000;
						max-height: 180px;
						overflow-y: auto;
						box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
						padding: 4px 0;
					}
					.shell-history-dropdown-row {
						display: flex;
						align-items: center;
						justify-content: space-between;
						transition: background 0.15s ease;
					}
					.shell-history-dropdown-row:hover {
						background: rgba(255, 255, 255, 0.05);
					}
					.shell-history-dropdown-row:hover .shell-history-remove-btn {
						color: rgba(255, 255, 255, 0.65);
					}
					.shell-history-dropdown-item {
						display: flex;
						align-items: center;
						gap: 8px;
						padding: 6px 12px;
						background: none;
						border: none;
						color: rgba(255, 255, 255, 0.85);
						font-family: inherit;
						font-size: 12px;
						text-align: left;
						cursor: pointer;
						transition: color 0.15s ease;
					}
					.shell-history-dropdown-row:hover .shell-history-dropdown-item {
						color: #fff;
					}
					.shell-history-dropdown-item i {
						font-size: 13px;
						color: rgba(255, 255, 255, 0.4);
					}
					.shell-history-remove-btn {
						background: none;
						border: none;
						color: rgba(255, 255, 255, 0.3);
						cursor: pointer;
						font-size: 14px;
						font-weight: bold;
						padding: 4px 10px;
						border-radius: 4px;
						transition: color 0.15s ease, background 0.15s ease;
						margin-right: 4px;
					}
					.shell-history-remove-btn:hover {
						background: rgba(255, 107, 107, 0.15) !important;
						color: #ff6b6b !important;
					}
				`}</style>

				<div style={{ padding: "12px 20px 8px 20px", borderBottom: "1px solid var(--panel-border, rgba(255,255,255,0.06))", flexShrink: 0 }}>
					<div style={{ position: "relative", display: "flex", alignItems: "center" }}>
						<span style={{ position: "absolute", left: 12, opacity: 0.5, fontSize: 13 }}>🔍</span>
						<input
							type="text"
							value={settingsSearchQuery}
							onChange={(e) => setSettingsSearchQuery(e.target.value)}
							placeholder="Search settings..."
							style={{
								...textInputStyle,
								width: "100%",
								paddingLeft: 34,
								boxSizing: "border-box",
								fontSize: 12.5,
								background: "rgba(0,0,0,0.2)"
							}}
						/>
						{settingsSearchQuery && (
							<button
								onClick={() => setSettingsSearchQuery("")}
								style={{
									position: "absolute",
									right: 12,
									background: "none",
									border: "none",
									color: "rgba(255,255,255,0.4)",
									cursor: "pointer",
									fontSize: 12,
									padding: 0
								}}
							>
								×
							</button>
						)}
					</div>
				</div>

				<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
					<div
						style={{
							width: 175,
							borderRight: "1px solid var(--panel-border, rgba(255,255,255,0.06))",
							padding: "8px 0",
							flexShrink: 0,
						}}>
						{SECTIONS.map((s) => {
							const isActive = active === s.id
							const matchCount = settingsSearchQuery ? getTabMatchCount(s.id, settingsSearchQuery) : 0
							const isDisabled = settingsSearchQuery && matchCount === 0
							return (
								<button
									key={s.id}
									onClick={() => !isDisabled && setActive(s.id)}
									disabled={!!isDisabled}
									className={`sidebar-tab-btn ${isActive ? 'active' : ''}`}
								>
									<i className={s.icon} style={{ fontSize: 13.5, opacity: isActive ? 1 : 0.5, color: isActive ? "var(--selection-color, #4dabe8)" : "inherit" }} />
									<span style={{ flex: 1 }}>{s.label}</span>
									{settingsSearchQuery && matchCount > 0 && (
										<span style={{
											fontSize: 10,
											background: isActive ? "var(--selection-color, #4dabe8)" : "rgba(255,255,255,0.15)",
											color: isActive ? "#000" : "#fff",
											padding: "1px 5px",
											borderRadius: 99,
											fontWeight: "bold"
										}}>
											{matchCount}
										</span>
									)}
								</button>
							)
						})}
					</div>
					<div
						onFocus={(e) => {
							const target = e.target as HTMLElement
							if (target && !target.closest('.settings-reset-btn')) {
								setUndoToast(null)
							}
						}}
						onClick={(e) => {
							const target = e.target as HTMLElement
							if (target && !target.closest('.settings-reset-btn')) {
								setUndoToast(null)
							}
						}}
						style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}
					>
						<SettingsSearchContext.Provider value={{ settingsSearchQuery }}>
							{active === "appearance" && (
							<div>
								{/* Canvas Background Section */}
								{(matchSetting("Canvas background color") || matchSetting("Suggested presets") || matchSetting("Saved custom presets")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Canvas background color", "Suggested presets", "Saved custom presets"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Canvas Background</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Canvas Background", ["canvasBgColor", "customBgColors"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Canvas background color", "Sets a custom background color for the infinite canvas. Drag the color box or type a hex color.") && (
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
										)}

										{matchSetting("Suggested presets", "Switch to standard optimized background colors: Deep Blue, Slate Black, Pure White, Creamy Pearl, or Midnight.") && (
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
														{ name: 'Midnight', color: '#1f2024' }
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
										)}

										{prefs.customBgColors && Object.keys(prefs.customBgColors).length > 0 && matchSetting("Saved custom presets", "Quickly switch to or delete your saved custom background colors.") && (
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
									</>
								)}

								{/* Canvas Pattern & Image Section */}
								{(matchSetting("Canvas background style") || matchSetting("Grid spacing") || matchSetting("Canvas background image URL")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Canvas background style", "Grid spacing", "Canvas background image URL"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Canvas Pattern & Image</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Canvas Pattern & Image", ["canvasGridStyle", "canvasGridSize", "canvasBgImage"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Canvas background style", "Sets the visual background grid style of the infinite canvas workspace.") && (
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
										)}
										{((prefs.canvasGridStyle ?? 'grid') !== 'none') && matchSetting("Grid spacing", "Adjusts the grid pattern cell spacing on the canvas in pixels.") && (
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
															fontFamily: 'JetBrains Mono, monospace',
															fontSize: 11.5,
														}}
													/>
													<span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.8 }}>px</span>
												</div>
											</Field>
										)}
										{matchSetting("Canvas background image URL", "Sets an optional custom image URL as the background of the infinite canvas. Supports web URLs, local file paths, drag-and-drop files, or pasting images.") && (
											<Field
												label="Canvas background image URL"
												description="Sets an optional custom image URL as the background of the infinite canvas. Supports web URLs, local file paths, drag-and-drop files, or pasting images."
											>
												<div style={{ display: "flex", gap: 8, width: "100%" }}>
													<input
														type="text"
														value={prefs.canvasBgImage ?? ""}
														onChange={async (e) => {
															const val = e.target.value
															updatePrefs({ canvasBgImage: val })
															const trimmed = val.trim()
															if (trimmed && 
																!trimmed.startsWith("http://") && 
																!trimmed.startsWith("https://") && 
																!trimmed.startsWith("deck-asset://") && 
																!trimmed.startsWith("data:") &&
																(trimmed.startsWith("/") || trimmed.match(/^[a-zA-Z]:\\/))) {
																const res = await window.electronAPI.fs.importAsAsset(trimmed)
																if (res?.ok && res.filename) {
																	updatePrefs({ canvasBgImage: `deck-asset://${res.filename}` })
																}
															}
														}}
														onDragOver={(e) => {
															e.preventDefault()
															e.stopPropagation()
														}}
														onDrop={async (e) => {
															e.preventDefault()
															e.stopPropagation()
															const files = Array.from(e.dataTransfer.files)
															if (files.length > 0) {
																const file = files[0]
																if (file.path) {
																	const res = await window.electronAPI.fs.importAsAsset(file.path)
																	if (res?.ok && res.filename) {
																		updatePrefs({ canvasBgImage: `deck-asset://${res.filename}` })
																	}
																}
															}
														}}
														onPaste={async (e) => {
															const items = e.clipboardData?.items
															if (items) {
																for (let i = 0; i < items.length; i++) {
																	const item = items[i]
																	if (item.type.startsWith("image/")) {
																		e.preventDefault()
																		const blob = item.getAsFile()
																		if (blob) {
																			const reader = new FileReader()
																			reader.onload = async () => {
																				const dataUrl = reader.result as string
																				const base64 = dataUrl.split(",")[1]
																				const res = await window.electronAPI.fs.writeAsset(base64, blob.name || "bg-paste.png")
																				if (res?.ok && res.filename) {
																					updatePrefs({ canvasBgImage: `deck-asset://${res.filename}` })
																				}
																			}
																			reader.readAsDataURL(blob)
																		}
																		return
																	}
																}
															}
														}}
														placeholder="URL, absolute file path, paste image, or drop file here"
														style={{ ...textInputStyle, flex: 1 }}
													/>
													<button
														onClick={async () => {
															const res = await window.electronAPI.file.openDialog()
															if (res?.ok && res.path) {
																const importRes = await window.electronAPI.fs.importAsAsset(res.path)
																if (importRes?.ok && importRes.filename) {
																	updatePrefs({ canvasBgImage: `deck-asset://${importRes.filename}` })
																}
															}
														}}
														style={{
															...actionBtnStyle,
															flexShrink: 0,
															display: "flex",
															alignItems: "center",
															gap: 4
														}}
														title="Choose a local image file"
													>
														<i className="ti ti-folder" /> Browse…
													</button>
												</div>
											</Field>
										)}
									</>
								)}

								{/* Panel Styling Section */}
								{(matchSetting("Panel glass opacity") || matchSetting("Panel glass blur (px)")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Panel glass opacity", "Panel glass blur (px)"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Panel Styling</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Panel Styling", ["panelGlassOpacity", "panelGlassBlur"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Panel glass opacity", "Adjusts the opacity level (transparency) of glassmorphic panels. Slider goes from 0.1 (fully transparent) to 1.0 (fully opaque).") && (
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
															fontFamily: 'JetBrains Mono, monospace',
															fontSize: 11.5,
														}}
													/>
													<span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.8 }}>%</span>
												</div>
											</Field>
										)}
										{matchSetting("Panel glass blur (px)", "Adjusts the backdrop blur filter radius behind glassmorphic panels in pixels.") && (
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
															fontFamily: 'JetBrains Mono, monospace',
															fontSize: 11.5,
														}}
													/>
													<span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.8 }}>px</span>
												</div>
											</Field>
										)}
									</>
								)}

								{/* UI & Typography Section */}
								{(matchSetting("UI font size") || matchSetting("Density") || matchSetting("Animations")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["UI font size", "Density", "Animations"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>UI & Typography</span>
											<button className="settings-reset-btn" onClick={() => resetSection("UI & Typography", ["fontSize", "density", "animations"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("UI font size", "Adjusts the base font size of the application UI elements (menus, sidebar, headers) in pixels.") && (
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
															fontFamily: 'JetBrains Mono, monospace',
															fontSize: 11.5,
														}}
													/>
													<span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.8 }}>px</span>
												</div>
											</Field>
										)}
										{matchSetting("Density", "Controls the vertical spacing (padding, heights, margins) across all tree views, outlines, sidebars, and panels. 'Compact' is optimized for high-density information; 'Comfortable' offers more breathing room.") && (
											<Field
												label="Density"
												description="Adjusts padding, row heights, and sidebar item spacing."
											>
												<select
													value={prefs.density}
													onChange={(e) =>
														updatePrefs({
															density: e.target.value as "compact" | "cozy" | "comfortable",
														})
													}
													style={inputStyle}>
													<option value="compact">Compact</option>
													<option value="cozy">Cozy (default)</option>
													<option value="comfortable">Comfortable</option>
												</select>
											</Field>
										)}
										{matchSetting("Animations", "Enables or disables visual transition animations for zooming, focusing, and moving panels on the canvas.") && (
											<Field
												label="Animations"
												description="Enables or disables visual transition animations for zooming, focusing, and moving panels on the canvas."
											>
												<Toggle
													on={prefs.animations}
													onChange={(v) => updatePrefs({ animations: v })}
												/>
											</Field>
										)}
									</>
								)}
							</div>
						)}

						{active === "panels" && (
							<div>
								{/* Editor Panels Section */}
								{(matchSetting("Default editor font size") || matchSetting("Default editor font family") || matchSetting("Default editor word wrap")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Default editor font size", "Default editor font family", "Default editor word wrap"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Editor Panels</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Editor Panels", ["editorFontSize", "editorFontFamily", "editorWordWrap"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Default editor font size", "Sets the default font size (in pixels) for the code editor. Individual editor panels can override this.") && (
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
										)}
										{matchSetting("Default editor font family", "Specifies the CSS font family string for the code editor (e.g. 'JetBrains Mono', monospace). Applied inside Monaco editor frames.") && (
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
										)}
										{matchSetting("Default editor word wrap", "Controls whether lines in the code editor wrap automatically or overflow horizontally. Individual editors can override this.") && (
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
										)}
									</>
								)}

								{/* Terminal Panels Section */}
								{(matchSetting("Default terminal font size") || matchSetting("Default terminal font family") || matchSetting("Default Terminal Shell") || matchSetting("Confirm Shell Switch") || matchSetting("Terminal Shell Path") || matchSetting("Terminal Scrollback")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Default terminal font size", "Default terminal font family", "Default Terminal Shell", "Confirm Shell Switch", "Terminal Shell Path", "Terminal Scrollback"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Terminal Panels</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Terminal Panels", ["terminalFontSize", "terminalFontFamily", "defaultTerminalShell", "defaultTerminalShellType", "skipShellSwitchConfirmation", "terminalScrollback"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Default terminal font size", "Sets the default font size (in pixels) for terminal windows.") && (
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
										)}
										{matchSetting("Default terminal font family", "Specifies the CSS font family string for terminal text rendering. Applied inside Xterm canvas layers.") && (
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
										)}
										{platform === 'win32' && matchSetting("Default Terminal Shell", "Select which shell to launch by default for new terminal panels.") && (
											<Field
												label="Default Terminal Shell"
												description="Select which shell to launch by default for new terminal panels."
											>
												<select
													value={prefs.defaultTerminalShellType ?? ""}
													onChange={(e) =>
														updatePrefs({
															defaultTerminalShellType: e.target.value as any,
														})
													}
													style={inputStyle}
												>
													<option value="">Remember Last Used</option>
													<option value="powershell">PowerShell</option>
													<option value="cmd">Command Prompt</option>
													<option value="wsl">WSL</option>
													<option value="gitbash">Git Bash</option>
													<option value="custom">Custom Path</option>
												</select>
											</Field>
										)}
										{platform === 'win32' && matchSetting("Confirm Shell Switch", "Ask for confirmation before switching a running terminal's shell type (which terminates the active session).") && (
											<div className="settings-nested-field">
												<Field
													label="Confirm Shell Switch"
													description="Ask for confirmation before switching a running terminal's shell type (which terminates the active session)."
												>
													<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
														<input
															type="checkbox"
															checked={!prefs.skipShellSwitchConfirmation}
															onChange={(e) =>
																updatePrefs({
																	skipShellSwitchConfirmation: !e.target.checked,
																})
															}
															id="chk-shell-confirm"
														/>
														<label htmlFor="chk-shell-confirm" style={{ fontSize: 12, userSelect: 'none', cursor: 'pointer', opacity: 0.8 }}>
															Confirm before closing session
														</label>
													</div>
												</Field>
											</div>
										)}
										{(platform !== 'win32' || prefs.defaultTerminalShellType === 'custom') && matchSetting("Terminal Shell Path", "Absolute path to the system shell executable to spawn for terminal panels.") && (
											<div className={platform === 'win32' ? "settings-nested-field" : ""} style={{ position: 'relative' }} ref={shellPathsDropdownRef}>
												<Field
													label="Terminal Shell Path"
													description={platform === 'win32'
														? "Absolute path to the shell executable to spawn for terminal panels (e.g. C:\\Windows\\System32\\cmd.exe)."
														: "Absolute path to the system shell executable to spawn for terminal panels (e.g. /bin/bash or /usr/bin/zsh). Leave empty to use system default."
													}
												>
													<div style={{ position: 'relative', display: 'flex', flex: 1 }}>
														<input
															type="text"
															value={shellPathInput}
															onChange={(e) => setShellPathInput(e.target.value)}
															onFocus={() => setShowShellPathsDropdown(true)}
															onBlur={() => commitShellPath(shellPathInput)}
															onKeyDown={handleShellPathKeyDown}
															placeholder={platform === 'win32' ? 'e.g. C:\\Windows\\System32\\cmd.exe' : 'e.g. /bin/bash'}
															style={{ ...textInputStyle, flex: 1, paddingRight: (prefs.recentShellPaths || []).length > 0 ? 30 : 12 }}
														/>
														{(prefs.recentShellPaths || []).length > 0 && (
															<button
																type="button"
																onClick={() => setShowShellPathsDropdown(!showShellPathsDropdown)}
																onMouseDown={(e) => e.preventDefault()}
																style={{
																	background: 'none',
																	border: 'none',
																	color: 'rgba(255,255,255,0.4)',
																	cursor: 'pointer',
																	position: 'absolute',
																	right: 8,
																	top: '50%',
																	transform: 'translateY(-50%)',
																	fontSize: 9,
																	padding: 4,
																}}
															>
																▼
															</button>
														)}
													</div>

													{showShellPathsDropdown && (prefs.recentShellPaths || []).length > 0 && (
														<div className="shell-history-dropdown">
															{(prefs.recentShellPaths || []).map((path) => (
																<div
																	key={path}
																	className="shell-history-dropdown-row"
																>
																	<button
																		type="button"
																		className="shell-history-dropdown-item"
																		style={{ flex: 1, paddingLeft: 12 }}
																		onMouseDown={(e) => {
																			e.preventDefault();
																			handleSelectDropdownItem(path);
																		}}
																	>
																		<i className="ti ti-terminal-2" />
																		<span>{path}</span>
																	</button>
																	<button
																		type="button"
																		className="shell-history-remove-btn"
																		title="Remove from history"
																		onMouseDown={(e) => {
																			e.preventDefault();
																			e.stopPropagation();
																			const currentList = prefs.recentShellPaths || [];
																			const updated = currentList.filter(p => p !== path);
																			updatePrefs({ recentShellPaths: updated });
																		}}
																	>
																		×
																	</button>
																</div>
															))}
														</div>
													)}
												</Field>
											</div>
										)}
										{matchSetting("Terminal Scrollback", "Lines of terminal history kept in memory per session.") && (
											<Field
												label="Terminal Scrollback"
												description="Lines of terminal history kept in memory per session."
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
										)}
									</>
								)}

								{/* Browser Panels Section */}
								{(matchSetting("Default browser home URL") || matchSetting("Lazy load background browser tabs")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Default browser home URL", "Lazy load background browser tabs"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Browser Panels</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Browser Panels", ["browserHomeUrl", "browserLazyLoad"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Default browser home URL", "The starting webpage URL loaded by newly spawned browser panels.") && (
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
										)}
										{matchSetting("Lazy load background browser tabs", "Suspends inactive browser panels to save memory.") && (
											<Field
												label="Lazy load background browser tabs"
												description="Suspends inactive browser panels to save memory."
											>
												<Toggle
													on={prefs.browserLazyLoad ?? false}
													onChange={(v) => updatePrefs({ browserLazyLoad: v })}
												/>
											</Field>
										)}
									</>
								)}
							</div>
						)}

						{active === "workspace" && (
							<div>
								{/* Workspace Behavior Section */}
								{(matchSetting("Show cursor coords in status bar") || matchSetting("Auto-focus on panel create") || matchSetting("Double-click empty canvas to create") || matchSetting("Header double-click action")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Show cursor coords in status bar", "Auto-focus on panel create", "Double-click empty canvas to create", "Header double-click action"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Workspace Behavior</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Workspace Behavior", ["showCursorReadout", "doubleClickToCreate", "autoFocusOnCreate", "panelHeaderDoubleClick"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Show cursor coords in status bar", "Displays the active mouse cursor coordinates relative to the infinite world canvas in the status bar.") && (
											<Field
												label="Show cursor coords in status bar"
												description="Displays the active mouse cursor coordinates relative to the infinite world canvas in the status bar."
											>
												<Toggle
													on={prefs.showCursorReadout}
													onChange={(v) => updatePrefs({ showCursorReadout: v })}
												/>
											</Field>
										)}
										{matchSetting("Auto-focus on panel create", "Automatically zooms and centers the viewport to frame a newly created panel.") && (
											<Field
												label="Auto-focus on panel create"
												description="Automatically zooms and centers the viewport to frame a newly created panel."
											>
												<Toggle
													on={prefs.autoFocusOnCreate !== false}
													onChange={(v) => updatePrefs({ autoFocusOnCreate: v })}
												/>
											</Field>
										)}
										{matchSetting("Double-click empty canvas to create", "Determines which type of panel is spawned automatically at the cursor coordinates when double-clicking on empty canvas space.") && (
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
										)}
										{matchSetting("Header double-click action", "What happens when you double-click a panel's title bar.") && (
											<Field
												label="Header double-click action"
												description="What happens when you double-click a panel's title bar."
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
										)}
									</>
								)}

								{/* Default Spawn Dimensions Section */}
								{(matchSetting("Terminal default size") || matchSetting("Editor default size") || matchSetting("Browser default size")) && (
									<>
										<div className="settings-section-header" style={{ opacity: isSectionMatched(["Terminal default size", "Editor default size", "Browser default size"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
											<span>Default Spawn Dimensions</span>
											<button className="settings-reset-btn" onClick={() => resetSection("Default Spawn Dimensions", ["defaultPanelWidthTerminal", "defaultPanelHeightTerminal", "defaultPanelWidthEditor", "defaultPanelHeightEditor", "defaultPanelWidthBrowser", "defaultPanelHeightBrowser"])}>
												Reset Section
											</button>
										</div>
										{matchSetting("Terminal default size", "Default spawn size (width x height in pixels) for terminal panels.") && (
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
										)}
										{matchSetting("Editor default size", "Default spawn size (width x height in pixels) for code editor panels.") && (
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
										)}
										{matchSetting("Browser default size", "Default spawn size (width x height in pixels) for web browser panels.") && (
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
										)}
									</>
								)}
							</div>
						)}

						{active === "layouts" && (
							<div>
								<div className="settings-section-header" style={{ opacity: isSectionMatched(["layouts", "saved layouts", "preset"]) ? 1 : 0.35, transition: "opacity 0.15s ease" }}>
									<span>Saved Layout Presets</span>
								</div>
								{useWorkspaceStore.getState().tabs.length > 0 && (
									<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
										{Object.values(useWorkspaceStore.getState().canvasPresets || {}).map((preset) => (
											<LayoutPresetRow key={preset.id} preset={preset} />
										))}
										{Object.keys(useWorkspaceStore.getState().canvasPresets || {}).length === 0 && (
											<div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
												No custom canvas presets saved yet. Double-click tabs or hit Export to manage.
											</div>
										)}
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
														if (recordedCombo) {
															useWorkspaceStore.getState().updateKeybinding(recordingId, recordedCombo)
														}
														setRecordingId(null)
														setRecordedCombo("")
													}}
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

								{/* Accordions */}
								<div style={{ marginTop: 20 }}>
									{/* Accordion 1 */}
									<button
										className="about-accordion-btn"
										onClick={() => toggleAccordion("density")}
									>
										<span>⚡ Layout Density Guide</span>
										<span>{openAccordion === "density" ? "▼" : "▶"}</span>
									</button>
									{openAccordion === "density" && (
										<div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.05)", borderTop: "none", borderRadius: "0 0 6px 6px", display: "flex", flexDirection: "column", gap: 8, opacity: 0.9 }}>
											<div>
												The <strong>Density</strong> setting adjusts vertical padding, item heights, tree nodes, outline rows, sidebar items, and window header margins.
											</div>
											<div>
												This is applied globally by setting a <code>data-density</code> attribute (<code>compact</code>, <code>cozy</code>, or <code>comfortable</code>) directly on the root document element. All styles adapt fluidly using CSS variables.
											</div>
										</div>
									)}

									{/* Accordion 2 */}
									<button
										className="about-accordion-btn"
										onClick={() => toggleAccordion("fonts")}
									>
										<span>🚀 Custom Fonts & Nerd Fonts Integration</span>
										<span>{openAccordion === "fonts" ? "▼" : "▶"}</span>
									</button>
									{openAccordion === "fonts" && (
										<div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.05)", borderTop: "none", borderRadius: "0 0 6px 6px", display: "flex", flexDirection: "column", gap: 12, opacity: 0.9 }}>
											<div>
												<strong style={{ color: "var(--selection-color, #9ed1ff)" }}>Font Segregation:</strong>
												<ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
													<li><strong>Editor Fonts:</strong> Applied inside Monaco-based code editor frames.</li>
													<li><strong>Terminal Fonts:</strong> Applied inside canvas-based Xterm terminals.</li>
													<li><strong>UI Fonts:</strong> Follows the default sans-serif font stack of the application chrome.</li>
												</ul>
											</div>

											<div>
												<strong style={{ color: "var(--selection-color, #9ed1ff)" }}>Commonly Preloaded / Supported Monospace Fonts:</strong>
												<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, marginTop: 4 }}>
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
												<strong style={{ color: "var(--selection-color, #9ed1ff)" }}>How to Install Custom Fonts:</strong>
												<div style={{ background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid #4dabe8', padding: '8px 12px', borderRadius: '0 6px 6px 0', fontSize: 11.5, marginTop: 4 }}>
													<strong style={{ color: '#fff' }}>On Linux:</strong>
													<ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
														<li>Download your font files (e.g. <code>.ttf</code> or <code>.otf</code>).</li>
														<li>Copy them to your user font directory: <code>~/.local/share/fonts/</code> (create it if missing).</li>
														<li>Regenerate your system font cache by running:
															<pre style={{ margin: '4px 0', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', width: 'fit-content' }}>fc-cache -fv</pre>
														</li>
														<li>Specify the exact font name in settings, e.g. <code>{"'FiraCode Nerd Font'"}</code>.</li>
													</ol>
													<div style={{ marginTop: 6 }}>
														<strong style={{ color: '#fff' }}>On Windows:</strong> Double-click the font file and choose "Install for all users".
													</div>
												</div>
											</div>
										</div>
									)}

									{/* Accordion 3 */}
									<button
										className="about-accordion-btn"
										onClick={() => toggleAccordion("formats")}
									>
										<span>⚙️ CSS Configuration Formats</span>
										<span>{openAccordion === "formats" ? "▼" : "▶"}</span>
									</button>
									{openAccordion === "formats" && (
										<div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.05)", borderTop: "none", borderRadius: "0 0 6px 6px", display: "flex", flexDirection: "column", gap: 8, opacity: 0.9 }}>
											<div>
												When typing font families, use CSS-compliant font-family syntax. Wrap names containing spaces in single or double quotes, and provide comma-separated fallbacks:
											</div>
											<pre style={{ marginTop: 4, background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, overflowX: 'auto', color: 'var(--selection-color, #9ed1ff)' }}>
												{"\"JetBrainsMono Nerd Font\", \"JetBrains Mono\", monospace"}
											</pre>
										</div>
									)}
								</div>
							</div>
						)}
					</SettingsSearchContext.Provider>
				</div>
				</div>

				{/* Undo Toast */}
				{undoToast && undoToast.visible && (
					<div
						className="settings-toast"
						style={{
							position: 'absolute',
							bottom: 16,
							left: '50%',
							transform: 'translateX(-50%)',
							background: 'var(--modal-bg, #181a1f)',
							border: '1px solid var(--selection-color, #4dabe8)',
							padding: '8px 14px',
							borderRadius: 8,
							boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
							display: 'flex',
							alignItems: 'center',
							gap: 16,
							zIndex: 10000,
							backdropFilter: 'blur(8px)',
							animation: 'toastSlideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
						}}
					>
						<span style={{ fontSize: 12.5, color: 'var(--fg, #e6e8ec)' }}>
							{undoToast.message}
						</span>
						<div style={{ display: 'flex', gap: 8 }}>
							<button
								onClick={() => {
									updatePrefsRaw(undoToast.backup)
									setUndoToast(null)
								}}
								style={{
									background: 'var(--selection-color, #4dabe8)',
									border: 'none',
									borderRadius: 4,
									color: 'var(--btn-text, #000)',
									padding: '4px 10px',
									fontSize: 11.5,
									fontWeight: 600,
									cursor: 'pointer',
								}}
							>
								Undo
							</button>
							<button
								onClick={() => setUndoToast(null)}
								style={{
									background: 'rgba(255, 255, 255, 0.08)',
									border: 'none',
									borderRadius: 4,
									color: 'var(--fg, #fff)',
									padding: '4px 10px',
									fontSize: 11.5,
									cursor: 'pointer',
								}}
							>
								Dismiss
							</button>
						</div>
					</div>
				)}
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

const SettingsSearchContext = React.createContext<{ settingsSearchQuery: string }>({ settingsSearchQuery: "" })

const Field: React.FC<{ label: string; description?: string; children: React.ReactNode }> = ({
	label,
	description,
	children,
}) => {
	const { settingsSearchQuery } = React.useContext(SettingsSearchContext)
	const q = settingsSearchQuery?.toLowerCase()
	const isMatched = !q || label.toLowerCase().includes(q) || (description && description.toLowerCase().includes(q))

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 12,
				padding: "10px 8px",
				marginLeft: "-8px",
				marginRight: "-8px",
				borderBottom: "1px solid var(--panel-border, rgba(255,255,255,0.04))",
				opacity: isMatched ? 1.0 : 0.3,
				background: (q && isMatched) ? "rgba(77, 171, 232, 0.04)" : "transparent",
				borderLeft: (q && isMatched) ? "2px solid var(--selection-color, #4dabe8)" : "2px solid transparent",
				borderRadius: 4,
				transition: "all 0.15s ease",
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
}


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
