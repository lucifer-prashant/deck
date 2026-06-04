# Release Notes - v0.5.0

## What's New in v0.5.0

### Key Features
* **Panel Switcher (Ctrl+Tab MRU):** A clean centered modal overlay tracking recently used (MRU) panels. Move with arrow keys or jump directly using keys `1-8`.
* **Auto Layout Engine:** Effortlessly arrange canvas panels on demand. Select multiple panels and arrange them using **Grid**, **Masonry**, **Golden Ratio**, or **Cluster by Type** layouts (cycle strategies via `Ctrl+Shift+A` or the canvas context menu).
* **Outline Sidebar Improvements:** Dedicated sidebar tab mapping all active tabs, panels, and starred items. Features multi-type filters (TERM/EDIT/WEB), status health dots, and keyboard-driven selection focus.
* **Ambient Health Indicators:** Status dots on panel headers tracking runtime health (alive, loading, sleeping, crashed) with one-click reload/restart capabilities.
* **Canvas Cursor Spawning:** Spawning panels via shortcuts (`Ctrl+B`, `Ctrl+E`, `Ctrl+T`) now automatically targets the world cursor coordinates.
* **Focus Mode Enhancements:** Focus selected (`F` key) now centers panels dynamically, taking open sidebars and chrome/status bar visibility into account.
* **Browser & Editor Lazy Loading:** Explicitly suspend and sleep background browsers and code-server editors to reclaim memory and CPU usage.
* **Browser Kiosk (App) Mode:** Right-click browser panels to run them distraction-free without tabs or URL bars, utilizing compact navigation buttons (`‹ ↻ ›`).

### Work in Progress / Known Limitations
* **Win+Tab Switcher (Under Progress):** The Win+Tab (Alt+Tab-style) switcher card overlay is currently under progress and does not work as intended yet. 

---
*Packaged and released by lucifer-prashant*
