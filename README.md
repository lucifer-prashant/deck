# Deck

Spatial workspace for code. Terminals, editors, browsers, notes, and git all on one infinite canvas. Built for Linux first.

Drop a real terminal anywhere. Float a code-server editor next to a browser preview. Group panels into regions, stack them into tab groups, or pop one out into its own window and throw it on another desktop. Everything persists.

## Highlights

- **Infinite canvas** — pan, zoom, GPU-composited drag at 60fps even with dozens of panels
- **Real panels** — xterm + node-pty terminals (with login shell + zoxide), code-server editor with Monaco fallback, `<webview>` browser with tabs/find/incognito, notes
- **Git deep** — status, stage/unstage, commit, branch dropdown (checkout + create), push/pull/fetch, diff viewer, stash, full worktree management
- **Docking** — drag any panel onto another's header to merge into a tab stack. Drag a tab out to undock. Sizes restored on unstack
- **Pop-out windows** — detach a panel to its own OS window, drag it to another desktop. State syncs back on re-dock
- **Annotations** — sticky notes + text labels as a markup layer on the canvas
- **Regions** — group panels into a labelled box. Drag the region, children follow. Panels auto-join when dropped inside, auto-leave when dragged fully out
- **Jump mode** — Tab + letter to fly between panels (tmux-style)
- **Themes** — dark, midnight, light, system (follows OS)
- **File explorer** — full right-click: open in editor / new editor / open terminal here / reveal / copy path / new file/folder / rename / move to trash
- **Token tracking** — Claude Code + Codex + opencode JSONL logs aggregated with cost
- **Multi-canvas tabs** — multiple named canvases, each with its own viewport and panel layout
- **Persistence** — every panel, position, viewport, theme, preference saved automatically
- **Performance** — off-viewport panels are visibility-hidden via content-visibility. Webviews throttled when off-screen. Terminal scrollback replays into fresh xterm instances

## Keyboard

| keys | action |
|---|---|
| `Ctrl+P` | command palette |
| `Ctrl+F` | find panel |
| `Ctrl+B` | sidebar (explorer / git / tokens / notes) |
| `Ctrl+,` | preferences |
| `Tab` | jump mode |
| `F` | focus selected panel |
| `Ctrl+G` / `Ctrl+Shift+G` | group / ungroup region |
| `Ctrl+Shift+D` | stack selected panels |
| `Ctrl+D` | duplicate selected |
| `F2` | inline rename |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+\` | hide chrome + status bar |
| `Ctrl+Shift+T` | cycle theme |
| `?` / `F1` | help |

## Stack

Electron 28 · React 18 · TypeScript 5 · Vite 5 · Zustand · xterm.js + node-pty · Monaco / code-server

## Quick start

```bash
npm install
npm run electron:dev
```

Requires Node 20 LTS (node-pty native module). Linux is the primary target — should also run on macOS/Windows with caveats.

## Project layout

```
deck/
├── electron/          # main process + preload
├── src/
│   ├── components/    # Panel, Canvas, Sidebar, GitSection, etc.
│   ├── store/         # zustand store
│   ├── panelContext.ts
│   ├── workspaceCommands.ts
│   └── App.tsx
├── index.html
├── vite.config.ts
└── package.json
```

## Status

Daily-driveable. Solid for everyday use. Known gaps tracked in code comments.

## License

Copyright (C) 2026 Prashant (lucifer-prashant). Licensed under the [MIT License](LICENSE).
