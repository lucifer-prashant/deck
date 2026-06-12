import React, { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import './CodexPanel.css'

// Shortcut Chip that queries the store's custom hotkeys configuration
const ShortcutChip: React.FC<{ command: string; fallback: string }> = ({ command, fallback }) => {
  const keybindings = useWorkspaceStore(s => s.keybindings)
  const val = keybindings[command] || fallback

  const parts = val.split('+').map(part => {
    if (part === 'ctrl') return 'Ctrl'
    if (part === 'shift') return 'Shift'
    if (part === 'alt') return 'Alt'
    if (part === 'meta') return 'Meta'
    return part.toUpperCase()
  })

  return (
    <kbd className="shortcut-chip">
      {parts.join(' + ')}
    </kbd>
  )
}

// Inline SVGs for topic diagrams (visually crisp glassmorphic representations)
const CanvasNavDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    <path d="M 0 30 H 240 M 0 60 H 240 M 0 90 H 240" stroke="rgba(77, 171, 232, 0.12)" strokeWidth="1" />
    <path d="M 60 0 V 120 M 120 0 V 120 M 180 0 V 120" stroke="rgba(77, 171, 232, 0.12)" strokeWidth="1" />
    <circle cx="120" cy="60" r="18" fill="rgba(77, 171, 232, 0.15)" stroke="#4dabe8" strokeWidth="1.5" />
    {/* Arrows pointing outward */}
    <path d="M 120 28 L 120 38 M 120 28 L 115 33 M 120 28 L 125 33" stroke="#4dabe8" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 120 92 L 120 82 M 120 92 L 115 87 M 120 92 L 125 87" stroke="#4dabe8" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 88 60 L 98 60 M 88 60 L 93 55 M 88 60 L 93 65" stroke="#4dabe8" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M 152 60 L 142 60 M 152 60 L 147 55 M 152 60 L 147 65" stroke="#4dabe8" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const PanelSpawnDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    <rect x="40" y="25" width="100" height="70" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
    <rect x="40" y="25" width="100" height="18" rx="6" fill="rgba(255,255,255,0.05)" />
    {/* Resize handle highlight */}
    <rect x="137" y="22" width="6" height="76" rx="3" fill="rgba(77,171,232,0.4)" stroke="#4dabe8" strokeWidth="1" />
    <rect x="120" y="45" width="80" height="55" rx="6" fill="rgba(77,171,232,0.1)" stroke="#4dabe8" strokeWidth="1.5" />
    <rect x="120" y="45" width="80" height="16" rx="6" fill="rgba(77,171,232,0.2)" />
  </svg>
)

const StacksDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    <rect x="50" y="20" width="140" height="80" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    {/* Tab bar */}
    <rect x="50" y="20" width="140" height="22" fill="rgba(255,255,255,0.05)" />
    <rect x="56" y="24" width="42" height="14" rx="3" fill="rgba(77,171,232,0.2)" stroke="#4dabe8" strokeWidth="1" />
    <rect x="104" y="24" width="38" height="14" rx="3" fill="rgba(255,255,255,0.05)" />
    <rect x="148" y="24" width="38" height="14" rx="3" fill="rgba(255,255,255,0.05)" />
  </svg>
)

const RegionsDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    {/* Outer Region Panel */}
    <rect x="25" y="15" width="190" height="90" rx="8" fill="rgba(77,171,232,0.04)" stroke="#4dabe8" strokeWidth="1.5" strokeDasharray="3 3" />
    <rect x="35" y="20" width="60" height="12" rx="3" fill="rgba(77,171,232,0.2)" />
    {/* Nested Panels */}
    <rect x="40" y="45" width="65" height="45" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
    <rect x="120" y="40" width="80" height="50" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
  </svg>
)

const DrawModeDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    <rect x="30" y="30" width="70" height="50" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    <rect x="140" y="40" width="70" height="50" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    {/* Connection Link Arrow */}
    <path d="M 100 55 C 115 45, 125 45, 140 65" stroke="#4dabe8" strokeWidth="2" strokeDasharray="2 2" />
    <path d="M 140 65 L 131 64 L 136 57" fill="#4dabe8" />
    {/* Freehand scribble */}
    <path d="M 40 90 Q 70 100 110 85 T 190 105" stroke="rgba(220, 38, 38, 0.4)" strokeWidth="3" strokeLinecap="round" />
  </svg>
)

const DragSpawnDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    {/* Sidebar File representation */}
    <rect x="20" y="25" width="50" height="70" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
    <rect x="26" y="32" width="38" height="8" rx="2" fill="rgba(255,255,255,0.06)" />
    <rect x="26" y="45" width="28" height="8" rx="2" fill="rgba(255,255,255,0.06)" />
    {/* File node being dragged */}
    <g transform="translate(90, 40)">
      <rect x="0" y="0" width="40" height="30" rx="4" fill="rgba(77,171,232,0.15)" stroke="#4dabe8" strokeWidth="1.5" />
      <path d="M 30 5 L 35 10 M 35 5 L 30 10" stroke="#4dabe8" strokeWidth="1" />
    </g>
    {/* Arrow */}
    <path d="M 75 40 L 95 45" stroke="#4dabe8" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const ShellSwitcherDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    <rect x="50" y="25" width="140" height="70" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    <rect x="50" y="25" width="140" height="18" rx="6" fill="rgba(255,255,255,0.05)" />
    {/* Shell Pill */}
    <rect x="56" y="28" width="48" height="12" rx="3" fill="#4dabe8" />
    <circle cx="98" cy="34" r="2" fill="#0c1524" />
    {/* Shell Dropdown list */}
    <g transform="translate(56, 44)">
      <rect x="0" y="0" width="70" height="42" rx="4" fill="rgba(28, 30, 34, 0.95)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      <rect x="4" y="4" width="62" height="8" rx="2" fill="rgba(255,255,255,0.08)" />
      <rect x="4" y="16" width="62" height="8" rx="2" fill="rgba(255,255,255,0.03)" />
      <rect x="4" y="28" width="62" height="8" rx="2" fill="rgba(255,255,255,0.03)" />
    </g>
  </svg>
)

const BrowserGuideDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    {/* Browser Frame */}
    <rect x="40" y="20" width="160" height="80" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
    <rect x="40" y="20" width="160" height="18" rx="6" fill="rgba(255,255,255,0.05)" />
    {/* Tabs */}
    <rect x="46" y="24" width="36" height="10" rx="2" fill="rgba(77,171,232,0.2)" stroke="#4dabe8" strokeWidth="0.8" />
    <rect x="86" y="24" width="30" height="10" rx="2" fill="rgba(255,255,255,0.05)" />
    {/* Popout Button */}
    <rect x="184" y="24" width="10" height="10" rx="2" fill="rgba(255,255,255,0.1)" />
    <path d="M 186 28 L 192 28 M 192 28 L 192 32 M 192 28 L 187 33" stroke="rgba(255,255,255,0.7)" strokeWidth="1" strokeLinecap="round" />
    {/* Address bar */}
    <rect x="46" y="42" width="148" height="12" rx="3" fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
    <circle cx="53" cy="48" r="2" fill="#4dabe8" />
    <rect x="60" y="46" width="90" height="4" rx="1" fill="rgba(255,255,255,0.2)" />
  </svg>
)

const EditorGuideDiagram = () => (
  <svg width="240" height="120" viewBox="0 0 240 120" fill="none">
    <rect width="240" height="120" rx="8" fill="rgba(255,255,255,0.02)" />
    {/* Editor Frame */}
    <rect x="40" y="20" width="160" height="80" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
    {/* Sidebar in editor */}
    <rect x="40" y="20" width="30" height="80" fill="rgba(255,255,255,0.04)" />
    <line x1="70" y1="20" x2="70" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
    {/* Editor Code Lines */}
    <rect x="76" y="26" width="60" height="6" rx="2" fill="rgba(77,171,232,0.25)" />
    <rect x="76" y="38" width="85" height="6" rx="2" fill="rgba(255,255,255,0.08)" />
    <rect x="86" y="50" width="50" height="6" rx="2" fill="rgba(255,255,255,0.08)" />
    <rect x="76" y="62" width="70" height="6" rx="2" fill="rgba(255,255,255,0.08)" />
  </svg>
)

export const CodexPanel: React.FC = () => {
  const { toggleHelp, activeCodexPage, highlightedGlossaryTerm, openCodexToPage, enterSandbox } = useWorkspaceStore()

  // Refs for glossary terms to manage scroll-into-view
  const fontSizeRef = useRef<HTMLDivElement>(null)
  const snapStepRef = useRef<HTMLDivElement>(null)
  const canvasBgColorRef = useRef<HTMLDivElement>(null)
  const panelGlassOpacityRef = useRef<HTMLDivElement>(null)
  const panelGlassBlurRef = useRef<HTMLDivElement>(null)
  const defaultTerminalShellRef = useRef<HTMLDivElement>(null)
  const autoFocusOnCreateRef = useRef<HTMLDivElement>(null)

  const glossaryRefs = React.useMemo(() => ({
    fontSize: fontSizeRef,
    snapStep: snapStepRef,
    canvasBgColor: canvasBgColorRef,
    panelGlassOpacity: panelGlassOpacityRef,
    panelGlassBlur: panelGlassBlurRef,
    defaultTerminalShell: defaultTerminalShellRef,
    autoFocusOnCreate: autoFocusOnCreateRef
  }), [])

  // Handle escape key to close Codex
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleHelp()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleHelp])

  // Handle scroll-to-highlight glossary hooks
  useEffect(() => {
    if (activeCodexPage === 'settings-glossary' && highlightedGlossaryTerm) {
      const ref = glossaryRefs[highlightedGlossaryTerm as keyof typeof glossaryRefs]
      if (ref?.current) {
        // Delay slightly so render completes
        const timerScroll = setTimeout(() => {
          if (ref.current) {
            ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ref.current.classList.add('visual-flash')
          }
        }, 100)

        const timerClean = setTimeout(() => {
          if (ref.current) {
            ref.current.classList.remove('visual-flash')
          }
          // Clear highlight term in the store
          useWorkspaceStore.setState({ highlightedGlossaryTerm: null })
        }, 1800)

        return () => {
          clearTimeout(timerScroll)
          clearTimeout(timerClean)
        }
      }
    }
  }, [activeCodexPage, highlightedGlossaryTerm, glossaryRefs])

  // Categories list
  const navStructure = [
    {
      title: 'Foundations',
      pages: [
        { id: 'canvas-nav', label: 'Canvas Navigation', icon: 'ti ti-arrows-maximize' },
        { id: 'panels-spawn', label: 'Panels: Spawn & Size', icon: 'ti ti-layout-grid' },
        { id: 'stacks-tabs', label: 'Stacks & Tabs', icon: 'ti ti-folders' }
      ]
    },
    {
      title: 'Power Features',
      pages: [
        { id: 'regions-grouping', label: 'Regions & Grouping', icon: 'ti ti-layout-sidebar-right' },
        { id: 'draw-mode', label: 'Draw Mode & Links', icon: 'ti ti-edit' },
        { id: 'drag-spawn', label: 'Drag-to-Spawn', icon: 'ti ti-file-import' },
        { id: 'terminal-switcher', label: 'Terminal shell switcher', icon: 'ti ti-terminal' },
        { id: 'editor-guide', label: 'Code Editor', icon: 'ti ti-code' },
        { id: 'browser-guide', label: 'Web Browser', icon: 'ti ti-world' }
      ]
    },
    {
      title: 'Reference',
      pages: [
        { id: 'kb-shortcuts', label: 'Keyboard Shortcuts', icon: 'ti ti-keyboard' },
        { id: 'settings-glossary', label: 'Settings Glossary', icon: 'ti ti-book' },
        { id: 'onboarding-wizard', label: 'Setup Tour', icon: 'ti ti-rocket' }
      ]
    }
  ]

  // Render content according to activePage
  const renderContent = () => {
    switch (activeCodexPage) {
      case 'canvas-nav':
        return (
          <>
            <h3 className="codex-page-title">Canvas Navigation</h3>
            <p className="codex-page-desc">
              Deck operates on an infinite spatial board. Panning and zooming are your primary navigation mechanics to organize complex layouts.
            </p>

            <div className="codex-diagram-container">
              <CanvasNavDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">How to navigate</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Hold <strong>Middle-Click</strong> (or <strong>Space + Drag</strong>) on empty space to pan the canvas viewport freely.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Use your <strong>Scroll Wheel</strong> (or trackpad pinch-zoom) to zoom in and out, centered on your cursor.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Press <ShortcutChip command="reset-viewport" fallback="ctrl+0" /> to reset zoom to 100% and center on layout origin.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>Press <ShortcutChip command="fit-all" fallback="ctrl+1" /> to calculate canvas bounding box and zoom to fit all panels.</div>
                </li>
              </ul>
            </div>

            <div className="codex-sandbox-box">
              <p className="codex-sandbox-text">
                Want to practice panning and zooming on a test layout? Enter the interactive sandbox space.
              </p>
              <button className="codex-sandbox-btn" onClick={enterSandbox}>
                <i className="ti ti-arrow-right"></i> Try it now
              </button>
            </div>
          </>
        )

      case 'panels-spawn':
        return (
          <>
            <h3 className="codex-page-title">Panels: Spawn, Move, Resize</h3>
            <p className="codex-page-desc">
              All tools inside Deck (Code Editors, Terminals, and Web Browsers) live inside floating spatial containers called Panels.
            </p>

            <div className="codex-diagram-container">
              <PanelSpawnDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">Essential Commands</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Spawn new panels at your viewport center by using hotkeys: Editor (<ShortcutChip command="new-editor" fallback="ctrl+e" />), Terminal (<ShortcutChip command="new-terminal" fallback="ctrl+shift+t" />), Browser (<ShortcutChip command="new-browser" fallback="ctrl+b" />).</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Reposition panels by clicking and dragging their top titlebar headers, or using <kbd>Ctrl + Arrows</kbd> (fine-grained).</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Resize panels by hovering near their borders or corners until resize cursors appear, then drag. Or use <kbd>Alt + Arrows</kbd> / <kbd>Alt+Shift+Arrows</kbd> (to shrink).</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>Double-click a panel header to maximize/minimize it. Delete panels with the header trash can icon or the <kbd>Del / Backspace</kbd> keys.</div>
                </li>
              </ul>
            </div>

            <div className="codex-sandbox-box">
              <p className="codex-sandbox-text">
                Practice creating, dragging, resizing, and deleting panels in our sandbox workspace.
              </p>
              <button className="codex-sandbox-btn" onClick={enterSandbox}>
                <i className="ti ti-arrow-right"></i> Try it now
              </button>
            </div>
          </>
        )

      case 'stacks-tabs':
        return (
          <>
            <h3 className="codex-page-title">Stacks & Tabs</h3>
            <p className="codex-page-desc">
              Group panels together inside tabbed stacks to conserve screen estate, or manage multi-tab workspaces.
            </p>

            <div className="codex-diagram-container">
              <StacksDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">How to stack</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Drag a panel by its titlebar directly over another panel&apos;s header. Release to combine them into a single tab stack.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Drag tabs out of the stack header onto the empty canvas to pop them back out into standalone panels.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Navigate stacks using keyboard shortcuts. Press <ShortcutChip command="toggle-panel-switcher" fallback="ctrl+tab" /> to cycle between panels.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>Use tabs on the top bar to separate projects. Create a new tab sheet using the <kbd>+</kbd> button or a shortcut. Switch sheets via <kbd>1-9</kbd>.</div>
                </li>
              </ul>
            </div>

            <div className="codex-sandbox-box">
              <p className="codex-sandbox-text">
                Enter the sandbox space to stack multiple panel layers and create tab groups.
              </p>
              <button className="codex-sandbox-btn" onClick={enterSandbox}>
                <i className="ti ti-arrow-right"></i> Try it now
              </button>
            </div>
          </>
        )

      case 'regions-grouping':
        return (
          <>
            <h3 className="codex-page-title">Regions & Grouping</h3>
            <p className="codex-page-desc">
              Regions act as parent grouping boxes on the canvas, allowing you to move or arrange clusters of panels collectively.
            </p>

            <div className="codex-diagram-container">
              <RegionsDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">Working with Regions</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Spawn a Region panel using <ShortcutChip command="new-region" fallback="ctrl+alt+r" />. Double-click the region title to name it.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Place any panels inside the dotted boundary of the region. They will become child components of the region.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Drag the Region panel. All child panels nested inside the region boundaries will slide in lockstep automatically.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>Draw selection box by holding <kbd>Shift + Dragging</kbd> on empty canvas. You can move selected groups in bulk.</div>
                </li>
              </ul>
            </div>

            <div className="codex-sandbox-box">
              <p className="codex-sandbox-text">
                Spawn regions and group multiple panels in the sandbox coordinate plane.
              </p>
              <button className="codex-sandbox-btn" onClick={enterSandbox}>
                <i className="ti ti-arrow-right"></i> Try it now
              </button>
            </div>
          </>
        )

      case 'draw-mode':
        return (
          <>
            <h3 className="codex-page-title">Draw Mode & Connection Links</h3>
            <p className="codex-page-desc">
              Use visual annotations to document your workspace, scribble logs, or create relationship arrows between panel modules.
            </p>

            <div className="codex-diagram-container">
              <DrawModeDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">How to Draw & Link</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Press <ShortcutChip command="toggle-annotate-mode" fallback="a" /> to toggle Annotate Mode. This locks panel click interactions and activates drawing.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Choose drawing tools in the floating annotate toolbar, or press keys <kbd>1-5</kbd>: Pen (<kbd>1</kbd>), Arrow (<kbd>2</kbd>), Rect (<kbd>3</kbd>), Highlight (<kbd>4</kbd>), Eraser (<kbd>5</kbd>).</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>To link panel dependencies: select the Arrow tool, click a panel header and drag onto another panel header. An arrow link will anchor them.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>Relationship arrows automatically update their spline lines when panels are dragged or rearranged on the canvas.</div>
                </li>
              </ul>
            </div>

            <div className="codex-sandbox-box">
              <p className="codex-sandbox-text">
                Lock canvas and try drawing connection arrows between our sandbox layout units.
              </p>
              <button className="codex-sandbox-btn" onClick={enterSandbox}>
                <i className="ti ti-arrow-right"></i> Try it now
              </button>
            </div>
          </>
        )

      case 'drag-spawn':
        return (
          <>
            <h3 className="codex-page-title">Drag-to-Spawn</h3>
            <p className="codex-page-desc">
              Seamlessly import external folders, configuration scripts, or markdown documents into active workspace nodes.
            </p>

            <div className="codex-diagram-container">
              <DragSpawnDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">Drag & Drop Guides</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Open the Sidebar Explorer panel using <ShortcutChip command="toggle-sidebar" fallback="ctrl+shift+b" />.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Click, hold, and drag any file or directory path item out of the sidebar tree onto empty canvas space.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Releasing the click will instantly spawn a new Code Editor panel pre-loading the selected target.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>You can also drag file nodes directly from your operating system&apos;s Explorer/Finder window onto the Deck canvas.</div>
                </li>
              </ul>
            </div>
          </>
        )

      case 'terminal-switcher':
        return (
          <>
            <h3 className="codex-page-title">Terminal Shell Switcher</h3>
            <p className="codex-page-desc">
              Run scripts, start dev servers, or browse directory files inside terminal panels using flexible shell profiles.
            </p>

            <div className="codex-diagram-container">
              <ShellSwitcherDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">How to switch shell</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div>Look at the right side of any Terminal panel&apos;s top header. It displays a shell chip representing the active shell.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div>Click the shell profile pill to open a drop-down menu listing all detected available shells (Bash, Zsh, Fish, WSL, Cmd).</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div>Select a shell. Deck will ask for switch confirmation (unless disabled in settings) and restart the session using that shell path.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div>To change your default terminal shell profile globally, use the <ShortcutChip command="toggle-settings" fallback="ctrl+," /> panel settings page.</div>
                </li>
              </ul>
            </div>
          </>
        )

      case 'editor-guide':
        return (
          <>
            <h3 className="codex-page-title">Code Editor Guide</h3>
            <p className="codex-page-desc">
              Deck features a fully-fledged code editor powered by VS Code (code-server). It brings comprehensive IDE features directly onto your canvas.
            </p>

            <div className="codex-diagram-container">
              <EditorGuideDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">Working with the Editor</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div><strong>code-server VS Code:</strong> The editor runs VS Code inside a webview. You can install extensions, customize workspaces, edit files, and use standard VS Code keyboard shortcuts.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div><strong>Drag-to-Focus Spawning:</strong> Drag any file or directory from the sidebar explorer onto empty canvas space to open a new editor panel, or drop it onto an existing editor panel to open the file in focus immediately.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div><strong>Workspace Context:</strong> Editor panels synchronize with your workspace folders, ensuring git status, workspace files, and local code-server sessions stay aligned.</div>
                </li>
              </ul>
            </div>
          </>
        )

      case 'browser-guide':
        return (
          <>
            <h3 className="codex-page-title">Web Browser Guide</h3>
            <p className="codex-page-desc">
              Deck contains a custom-built, multi-tab web browser optimized for local webapp development, document previewing, and general browsing.
            </p>

            <div className="codex-diagram-container">
              <BrowserGuideDiagram />
            </div>

            <div>
              <h4 className="codex-section-title-inline">Key Browser Features</h4>
              <ul className="codex-steps">
                <li className="codex-step-item">
                  <div className="codex-step-num">1</div>
                  <div><strong>Sleep / RAM Saver:</strong> Browsers automatically sleep (lazy-load) when created or restored from templates, saving ~250 MB of RAM each. Click the panel to wake it up. You can manually sleep any inactive browser panel via its right-click menu.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">2</div>
                  <div><strong>App / Kiosk Mode:</strong> Previews PDFs, local servers, or static assets cleanly. The tabstrip and URL bar are hidden entirely to give full canvas space to the app view.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">3</div>
                  <div><strong>Incognito Partitions:</strong> Standard tabs share the main session cache and cookies. Incognito tabs (created via <kbd>⎈</kbd> or <ShortcutChip command="new-incognito" fallback="ctrl+shift+n" />) spawn isolated, transient session partitions.</div>
                </li>
                <li className="codex-step-item">
                  <div className="codex-step-num">4</div>
                  <div><strong>System Popout (⇱):</strong> Click the popout button in the browser address bar to instantly load the current URL in your operating system&apos;s default external browser.</div>
                </li>
              </ul>
            </div>
          </>
        )

      case 'kb-shortcuts':
        return (
          <>
            <h3 className="codex-page-title">Keyboard Shortcuts</h3>
            <p className="codex-page-desc">
              Increase your workspace velocity. Shortcuts query your live user hotkey configuration.
            </p>

            <div className="codex-kb-grid">
              <div className="codex-kb-section">
                <h4>Canvas Commands</h4>
                <div className="codex-kb-list">
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Reset Viewport</span>
                    <ShortcutChip command="reset-viewport" fallback="ctrl+0" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Fit All Panels</span>
                    <ShortcutChip command="fit-all" fallback="ctrl+1" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Zoom In</span>
                    <ShortcutChip command="zoom-in" fallback="ctrl+=" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Zoom Out</span>
                    <ShortcutChip command="zoom-out" fallback="ctrl+-" />
                  </div>
                </div>
              </div>

              <div className="codex-kb-section">
                <h4>Panel Spawning</h4>
                <div className="codex-kb-list">
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">New Editor</span>
                    <ShortcutChip command="new-editor" fallback="ctrl+e" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">New Terminal</span>
                    <ShortcutChip command="new-terminal" fallback="ctrl+shift+t" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">New Browser</span>
                    <ShortcutChip command="new-browser" fallback="ctrl+b" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">New Region Group</span>
                    <ShortcutChip command="new-region" fallback="ctrl+alt+r" />
                  </div>
                </div>
              </div>

              <div className="codex-kb-section">
                <h4>Workspace Toggles</h4>
                <div className="codex-kb-list">
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Help Codex</span>
                    <ShortcutChip command="toggle-help" fallback="?" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Settings</span>
                    <ShortcutChip command="toggle-settings" fallback="ctrl+," />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Command Palette</span>
                    <ShortcutChip command="toggle-command-palette" fallback="ctrl+p" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Sidebar</span>
                    <ShortcutChip command="toggle-sidebar" fallback="ctrl+shift+b" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Top/Bottom Chrome Bars</span>
                    <ShortcutChip command="toggle-bars" fallback="ctrl+\\" />
                  </div>
                  <div className="codex-kb-row">
                    <span className="codex-kb-label">Toggle Annotate Mode</span>
                    <ShortcutChip command="toggle-annotate-mode" fallback="a" />
                  </div>
                </div>
              </div>
            </div>
          </>
        )

      case 'settings-glossary':
        return (
          <>
            <h3 className="codex-page-title">Settings Glossary</h3>
            <p className="codex-page-desc">
              A comprehensive directory of user preference settings. Learn how each switch modifies Deck workspace behavior.
            </p>

            <div className="codex-glossary">
              <div ref={glossaryRefs.fontSize} className="codex-glossary-item" id="term-fontSize">
                <div className="codex-glossary-term">fontSize</div>
                <p className="codex-glossary-def">
                  Determines the global base font size (in pixels) for the main application shell interface. Modifies text readability inside sidebars, menus, and chrome status lines.
                </p>
              </div>

              <div ref={glossaryRefs.snapStep} className="codex-glossary-item" id="term-snapStep">
                <div className="codex-glossary-term">snapStep</div>
                <p className="codex-glossary-def">
                  Specifies grid align snap step thresholds (in pixels). When panels are dragged or resized, they lock to increments of this size. Set to zero or low values to enable completely fluid positioning.
                </p>
              </div>

              <div ref={glossaryRefs.canvasBgColor} className="codex-glossary-item" id="term-canvasBgColor">
                <div className="codex-glossary-term">canvasBgColor</div>
                <p className="codex-glossary-def">
                  Configures the color of the canvas workspace background. Leaving this empty lets the app automatically choose standard dark, light, or blueprint grid theme colors.
                </p>
              </div>

              <div ref={glossaryRefs.panelGlassOpacity} className="codex-glossary-item" id="term-panelGlassOpacity">
                <div className="codex-glossary-term">panelGlassOpacity</div>
                <p className="codex-glossary-def">
                  Controls the background transparency level of panels, scaling from completely solid (1.00) to glassmorphic transparent (0.00). Works in tandem with background blur.
                </p>
              </div>

              <div ref={glossaryRefs.panelGlassBlur} className="codex-glossary-item" id="term-panelGlassBlur">
                <div className="codex-glossary-term">panelGlassBlur</div>
                <p className="codex-glossary-def">
                  Configures the CSS backdrop filter blur radius (in pixels) of the glassmorphic panels. Set higher numbers for heavy frosty aesthetics, or zero to disable translucent blur.
                </p>
              </div>

              <div ref={glossaryRefs.defaultTerminalShell} className="codex-glossary-item" id="term-defaultTerminalShell">
                <div className="codex-glossary-term">defaultTerminalShell</div>
                <p className="codex-glossary-def">
                  Specifies an absolute system path executable to spawn for terminal panels (e.g. <code>/usr/bin/fish</code> or custom console exe). Only active when shell type is set to Custom.
                </p>
              </div>

              <div ref={glossaryRefs.autoFocusOnCreate} className="codex-glossary-item" id="term-autoFocusOnCreate">
                <div className="codex-glossary-term">autoFocusOnCreate</div>
                <p className="codex-glossary-def">
                  When enabled, spawning any new panel (Editor, Terminal, Browser) immediately grabs the keyboard focus and brings the node to the front of the screen.
                </p>
              </div>
            </div>
          </>
        )

      case 'onboarding-wizard':
        return (
          <>
            <h3 className="codex-page-title">Workspace Setup Tour</h3>
            <p className="codex-page-desc">
              The setup tour runs automatically when Deck is launched for the first time. It helps configure your shell and spawn initial template workspaces.
            </p>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px dashed var(--panel-border, rgba(255, 255, 255, 0.12))',
              borderRadius: '8px',
              padding: '24px',
              textAlign: 'center',
              marginTop: '30px',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{ fontSize: '42px', marginBottom: '14px' }}>🚀</div>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '18px', color: 'var(--fg)', fontWeight: 600 }}>Restart Setup Wizard</h4>
              <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.5' }}>
                Would you like to run the onboarding setup wizard again? This allows you to re-select your preferred default shell profile and choose a workspace starter template.
              </p>
              <button
                className="codex-sandbox-btn"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  // Close the Codex Panel
                  toggleHelp()
                  // Reset onboardingComplete and wizardStep in the store
                  const s = useWorkspaceStore.getState()
                  if (s.settingsOpen) s.toggleSettings()
                  s.updatePrefs({
                    onboardingComplete: false,
                    wizardStep: 0
                  })
                }}
              >
                Launch Setup Tour
              </button>
            </div>
          </>
        )

      default:
        return null
    }
  }

  return (
    <div className="codex-overlay" onClick={toggleHelp}>
      <div className="codex-container" onClick={(e) => e.stopPropagation()}>
        {/* Left Nav Menu */}
        <div className="codex-sidebar">
          <div className="codex-logo">
            <i className="ti ti-notebook"></i>
            <span>Deck Codex</span>
          </div>

          {navStructure.map((sec, idx) => (
            <div key={idx} className="codex-nav-section">
              <span className="codex-section-title">{sec.title}</span>
              {sec.pages.map((p) => (
                <button
                  key={p.id}
                  className={`codex-nav-btn ${activeCodexPage === p.id ? 'active' : ''}`}
                  onClick={() => openCodexToPage(p.id)}
                >
                  <i className={p.icon}></i>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right Content Panel */}
        <div className="codex-content-wrapper">
          <div className="codex-header">
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>
              Manual / Documentation
            </span>
            <button className="codex-close-btn" onClick={toggleHelp}>
              ×
            </button>
          </div>

          <div className="codex-body">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CodexPanel
