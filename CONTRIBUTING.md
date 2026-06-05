# Contributing to Deck

## Development Setup

```bash
npm install
npm run dev          # Vite + Electron hot-reload
npm run lint         # ESLint (0-warning policy)
npx tsc --noEmit     # Type check (see note below on pre-existing errors)
```

> **TypeScript note**: five `TS2688` errors exist for missing `@types/` packages (`estree-jsx`, `hast`, `js-cookie`, `mdx`, `unist`). These are pre-existing and do not affect runtime or Electron builds. ESLint is the primary lint gate.

---

## Where things live

| Path | Purpose |
|------|---------|
| `src/` | React renderer process |
| `src/store/workspaceStore.ts` | Central Zustand state — panels, tabs, prefs, annotations |
| `src/components/Canvas.tsx` | Infinite canvas, zoom/pan, selection, drag-drop |
| `src/workspaceCommands.ts` | All workspace-level commands (fit, align, arrange, …) |
| `electron/main.ts` | Electron main process — window management, IPC, PTY |
| `electron/preload.ts` | Context-bridge surface exposed to the renderer |
| `electron/webview-preload.ts` | Injected into browser-panel webviews |

---

## Browser session & credential storage

Deck's browser panels use Electron [webview partitions](https://www.electronjs.org/docs/latest/api/webview-tag#partition) for session isolation:

- **Normal tabs**: `persist:wts-browser` — cookies/localStorage are stored **persistently** in Electron's `userData` directory.
- **Incognito tabs**: `wts-incognito-<tabId>` — in-memory only, cleared when the tab closes.

### Where is userData?

| Platform | Path |
|----------|------|
| Linux | `~/.config/deck/` |
| macOS | `~/Library/Application Support/deck/` |
| Windows | `%APPDATA%\deck\` |

The `userData` directory is **outside the project source tree** — it is never committed to git. Cookies and sessions for sites like Instagram, Reddit, LinkedIn, etc. live there (under `userData/Partition/persist_wts-browser/Cookies`) and are not accessible to the renderer process directly.

**Never commit** anything from `userData/`. The `.gitignore` explicitly excludes `userData/`, `Cookies`, `Local Storage/`, `Session Storage/`, and `IndexedDB/` as a defence-in-depth measure.

---

## Code conventions

- **Zustand actions are stable references** — do not wrap them in `useCallback` just to pass as props.
- **Annotation shallow-clone invariant** — `Annotation.pathData` must always be *replaced* (`annotation.pathData = [...]`), never mutated in-place (`annotation.pathData.push(...)`). The annotation history snapshots use `annotations.map(x => ({ ...x }))` which is a shallow clone. Violating this invariant breaks undo/redo.
- **Module-level constants** — sets/objects that are logically constant (e.g. `DRAWING_TYPES`) belong at module scope, not inside component render.
- **No `console.log` in production paths** — the `initialize()` function and main render path should stay clean.
