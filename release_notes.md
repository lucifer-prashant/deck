# Release Notes - v0.5.1

This patch release polishes the codebase by stripping retired features, resolving styling selectors, and correcting documentation and keyboard shortcuts.

## What's Changed in v0.5.1

### 🧹 Codebase Refactoring & Cleanup
* **Retired Tokens Feature Removal:** Removed the orphaned `TokensSection.tsx` component, clean-up of `tokens:scan` backend handlers, sqlite3 log scanners, and pricing helper functions in `electron/main.ts` and `preload.ts`.
* **Obsolete Style Selectors Stripped:** Cleaned up unused style rules matching `.tokens-...`, `.panel-type-note`, and `.note-content` selectors from `Sidebar.css` and `Panel.css`.
* **Shortcuts & Settings Polishes:** 
  * Updated keybind reference guides in `HelpOverlay.tsx` to list `Sidebar (Explorer/Git/Outline)`.
  * Corrected keybind rows in `SettingsPane.tsx` to list `Ctrl+B` as `New Browser panel` matching its actual implementation.
* **Metadata Type Safety fallback:** Added a safe metadata fallback to `TYPE_META.editor` inside the `WinTabSwitcher` to prevent potential crashes on unknown panel types.

---
*Packaged and released by lucifer-prashant*
