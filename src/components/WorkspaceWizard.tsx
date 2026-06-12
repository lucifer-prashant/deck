import React, { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { SHELL_CONFIGS, TerminalShellType, DefaultShellSetting } from '../types/terminalShells'
import { fitItemsToViewport } from '../workspaceCommands'
import './WorkspaceWizard.css'

interface ShellInfo {
  type: string
  label: string
  path: string
}

export const WorkspaceWizard: React.FC = () => {
  const { prefs, updatePrefs, addPanel, selectPanel } = useWorkspaceStore()
  const wizardStep = prefs.wizardStep

  const [detectedShells, setDetectedShells] = useState<ShellInfo[]>([])
  const [loadingShells, setLoadingShells] = useState(true)
  const [selectedShell, setSelectedShell] = useState<ShellInfo | null>(null)
  const [customPathInput, setCustomPathInput] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<'solo' | 'research' | 'blank' | null>('solo')
  const [welcomeFilePath, setWelcomeFilePath] = useState('')

  // Query detected shells and welcome path on mount
  useEffect(() => {
    if (window.electronAPI?.detectShells) {
      window.electronAPI.detectShells()
        .then((shells) => {
          setDetectedShells(shells)
          // Default selection to first shell if available
          if (shells.length > 0) {
            setSelectedShell(shells[0])
          }
          setLoadingShells(false)
        })
        .catch((err) => {
          console.error('Failed to detect shells:', err)
          setLoadingShells(false)
        })
    } else {
      setLoadingShells(false)
    }

    if (window.electronAPI?.fs?.welcomePath) {
      window.electronAPI.fs.welcomePath()
        .then((path) => {
          setWelcomeFilePath(path)
        })
        .catch((err) => {
          console.error('Failed to resolve welcome path:', err)
        })
    }
  }, [])

  // Sync custom path input into selected shell object if "Custom" option is active
  const handleCustomPathChange = (val: string) => {
    setCustomPathInput(val)
    if (selectedShell?.type === 'custom') {
      setSelectedShell({
        type: 'custom',
        label: 'Custom Path',
        path: val.trim()
      })
    }
  }

  const handleSelectCustom = () => {
    const shellObj = {
      type: 'custom',
      label: 'Custom Path',
      path: customPathInput.trim()
    }
    setSelectedShell(shellObj)
  }

  const handleSkip = () => {
    applyTemplate('blank')
  }

  const handleNext = () => {
    if (wizardStep === 0) {
      updatePrefs({ wizardStep: 1 })
    } else if (wizardStep === 1) {
      if (!selectedShell) return

      // Write chosen shell configuration to preferences
      if (selectedShell.type === 'custom') {
        updatePrefs({
          defaultTerminalShellType: 'custom',
          defaultTerminalShell: selectedShell.path
        })
      } else {
        updatePrefs({
          defaultTerminalShellType: selectedShell.type as DefaultShellSetting,
          defaultTerminalShell: ''
        })
      }
      updatePrefs({ wizardStep: 2 })
    } else if (wizardStep === 2) {
      if (!selectedTemplate) return
      updatePrefs({ wizardStep: 3 })
    }
  }

  const handleBack = () => {
    if (wizardStep > 0) {
      updatePrefs({ wizardStep: wizardStep - 1 })
    }
  }

  const applyTemplate = (template: 'solo' | 'research' | 'blank') => {
    const store = useWorkspaceStore.getState()
    const now = Date.now()

    // Clear existing panels just in case
    useWorkspaceStore.setState({ panels: {}, selectedPanelIds: [] })

    if (template === 'solo') {
      const editorId = `editor-${now}`
      const terminalId = `terminal-${now + 1}`

      const editorPanel = {
        id: editorId,
        type: 'editor' as const,
        title: 'Welcome Scratchpad',
        x: -580,
        y: -380,
        width: 1100,
        height: 760,
        settings: { filePath: welcomeFilePath },
        createdAt: now,
        updatedAt: now
      }

      const terminalPanel = {
        id: terminalId,
        type: 'terminal' as const,
        title: 'Terminal',
        x: 540,
        y: -200,
        width: 600,
        height: 400,
        settings: { cwd: undefined },
        createdAt: now,
        updatedAt: now
      }

      addPanel(editorPanel)
      addPanel(terminalPanel)

      setTimeout(() => {
        fitItemsToViewport([editorPanel, terminalPanel])
        selectPanel(editorId)
      }, 50)

    } else if (template === 'research') {
      const browserId = `browser-${now}`
      const stickyId = `annotation-${now + 1}`

      const browserPanel = {
        id: browserId,
        type: 'browser' as const,
        title: 'DevDocs Reference',
        x: -400,
        y: -280,
        width: 720,
        height: 560,
        settings: { url: 'https://devdocs.io/' },
        createdAt: now,
        updatedAt: now
      }

      const notesTemplate = `# Research Log\n* **Objective:** [Enter research goal]\n* **Key Findings:** \n* **Reference Links:** `

      const stickyNote = {
        id: stickyId,
        type: 'sticky' as const,
        x: 360,
        y: -150,
        width: 300,
        height: 300,
        text: notesTemplate,
        color: '#ffbb00'
      }

      addPanel(browserPanel)
      store.addAnnotation(stickyNote)

      setTimeout(() => {
        fitItemsToViewport([browserPanel, stickyNote])
        selectPanel(browserId)
      }, 50)

    } else {
      // Blank Canvas: center camera at (0, 0)
      store.setViewport({ x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 })
    }

    // Complete onboarding wizard
    updatePrefs({
      onboardingComplete: true,
      wizardStep: -1
    })
  }

  // Render correct content per step
  const renderStepContent = () => {
    switch (wizardStep) {
      case 0:
        return (
          <>
            <h2 className="wizard-step-title">Welcome to Deck 🚀</h2>
            <p className="wizard-step-desc">
              Deck is a spatial, canvas-based developer workspace designed for multi-tasking. Lay out editors, terminals, and web browsers side-by-side on an infinite grid.
            </p>
            <div className="wizard-graphic-container" style={{ height: '180px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '32px' }}>🌌</div>
              <div style={{ fontSize: '12px', opacity: 0.6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Infinite Developer Canvas</div>
            </div>
          </>
        )

      case 1:
        return (
          <>
            <h2 className="wizard-step-title">Configure Shell Profile</h2>
            <p className="wizard-step-desc">
              Choose the default shell profile to spawn for terminal panels. You can change this later in settings.
            </p>

            {loadingShells ? (
              <div className="wizard-options-list" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <i className="ti ti-spinner animate-spin" style={{ fontSize: '24px', color: '#4dabe8' }}></i>
                <span style={{ fontSize: '12px', opacity: 0.6 }}>Detecting available shells...</span>
              </div>
            ) : (
              <div className="wizard-options-list">
                {detectedShells.map((shell, idx) => {
                  const conf = SHELL_CONFIGS[shell.type as TerminalShellType]
                  const icon = conf ? conf.icon : 'ti ti-terminal-2'
                  const isActive = selectedShell && selectedShell.path === shell.path && selectedShell.type === shell.type
                  return (
                    <button
                      key={idx}
                      className={`wizard-option-btn ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedShell(shell)}
                    >
                      <i className={icon}></i>
                      <div>
                        <div style={{ fontWeight: 600 }}>{shell.label}</div>
                        <div style={{ fontSize: '10px', opacity: 0.5 }}>{shell.path}</div>
                      </div>
                    </button>
                  )
                })}

                {/* Custom Shell Path option */}
                <button
                  className={`wizard-option-btn ${selectedShell?.type === 'custom' && !detectedShells.some(s => s.path === selectedShell?.path) ? 'active' : ''}`}
                  onClick={handleSelectCustom}
                >
                  <i className="ti ti-terminal-2"></i>
                  <div style={{ width: '100%' }}>
                    <div style={{ fontWeight: 600 }}>Custom Path...</div>
                    <div style={{ fontSize: '10px', opacity: 0.5 }}>Specify an absolute executable path</div>
                  </div>
                </button>

                {selectedShell?.type === 'custom' && (
                  <div className="wizard-custom-input-container">
                    <input
                      type="text"
                      className="wizard-custom-input"
                      placeholder="e.g. /usr/bin/fish or C:\bin\my-shell.exe"
                      value={customPathInput}
                      onChange={(e) => handleCustomPathChange(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )

      case 2:
        return (
          <>
            <h2 className="wizard-step-title">Choose Workspace Template</h2>
            <p className="wizard-step-desc">
              Deck operates on spatial layouts. Choose a starting template to populate your initial tab.
            </p>

            <div className="wizard-grid-options">
              <div
                className={`wizard-grid-card ${selectedTemplate === 'solo' ? 'active' : ''}`}
                onClick={() => setSelectedTemplate('solo')}
              >
                <i className="ti ti-code"></i>
                <div className="wizard-grid-card-title">Solo Dev</div>
                <div className="wizard-grid-card-desc">Spawn editor + terminal side-by-side</div>
              </div>

              <div
                className={`wizard-grid-card ${selectedTemplate === 'research' ? 'active' : ''}`}
                onClick={() => setSelectedTemplate('research')}
              >
                <i className="ti ti-search"></i>
                <div className="wizard-grid-card-title">Research</div>
                <div className="wizard-grid-card-desc">Preload web browser + notes sticky</div>
              </div>

              <div
                className={`wizard-grid-card ${selectedTemplate === 'blank' ? 'active' : ''}`}
                onClick={() => setSelectedTemplate('blank')}
              >
                <i className="ti ti-border-all"></i>
                <div className="wizard-grid-card-title">Blank Canvas</div>
                <div className="wizard-grid-card-desc">Start clean with an empty grid</div>
              </div>
            </div>
          </>
        )

      case 3:
        return (
          <>
            <h2 className="wizard-step-title">One Golden Rule</h2>
            <p className="wizard-step-desc">
              Deck workspaces are infinite. Here is the single most important control to navigate the canvas:
            </p>

            <div className="wizard-graphic-container">
              <div className="wizard-mouse-pan-graphic">
                <div className="wizard-pan-action">
                  <svg className="wizard-svg-mouse" width="40" height="60" viewBox="0 0 24 36">
                    <rect x="2" y="2" width="20" height="32" rx="10" />
                    {/* scroll wheel / middle click */}
                    <line x1="12" y1="2" x2="12" y2="12" />
                    <circle cx="12" cy="9" r="2" fill="#4dabe8" />
                  </svg>
                  <div className="wizard-pan-arrows">
                    <i className="ti ti-arrows-maximize" style={{ fontSize: '32px' }}></i>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 500, color: '#e6e8ec', padding: '0 16px' }}>
              Hold <strong>Middle-Click</strong> (or <strong>Space + Drag</strong>) to pan the canvas.
              Scroll to zoom in/out.
            </div>
          </>
        )

      default:
        return null
    }
  }

  // If complete, don't show the wizard overlay
  if (wizardStep === -1) return null

  return (
    <div className="wizard-overlay">
      <div className="wizard-card">
        <div className="wizard-header">
          <div className="wizard-title">Workspace Setup</div>
          <div className="wizard-progress">
            {[0, 1, 2, 3].map((step) => (
              <div
                key={step}
                className={`wizard-dot ${step === wizardStep ? 'active' : ''}`}
              />
            ))}
          </div>
        </div>

        <div className="wizard-content">
          {renderStepContent()}
        </div>

        <div className="wizard-footer">
          {wizardStep < 3 ? (
            <button className="wizard-btn-skip" onClick={handleSkip}>
              Skip Tour
            </button>
          ) : (
            <div></div> // spacer
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            {wizardStep > 0 && (
              <button className="wizard-btn" onClick={handleBack}>
                Back
              </button>
            )}

            {wizardStep < 3 ? (
              <button
                className="wizard-btn primary"
                disabled={wizardStep === 1 && !selectedShell}
                onClick={handleNext}
              >
                Next
              </button>
            ) : (
              <button
                className="wizard-btn primary"
                onClick={() => applyTemplate(selectedTemplate || 'solo')}
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
