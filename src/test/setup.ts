// Global test setup — runs before every test file.
import '@testing-library/jest-dom'

// Mock Electron APIs. The store's dualStorage gracefully falls back to
// localStorage when window.electronAPI is undefined (via optional chaining).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).electronAPI = undefined

// Mock window.confirm for panelDeletion tests. Override per-test as needed.
vi.stubGlobal('confirm', () => true)

// Mock window.dispatchEvent for workspaceCommands (flagSmoothViewport)
const _origDispatch = window.dispatchEvent.bind(window)
vi.stubGlobal('dispatchEvent', (e: Event) => {
  // Swallow CustomEvents from store/commands — they target the real DOM
  if (e instanceof CustomEvent) return true
  return _origDispatch(e)
})
