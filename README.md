# Glint

A VS Code-inspired code editor with a liquid-glass UI, full colour customisation, and an Electron shell.

Glint is built around three principles:

- **Liquid glass UI** — translucent, blurred surfaces (`backdrop-filter`) that tint with your desktop, not flat opaque panels.
- **Full colour control** — accent, background, foreground, muted text, glass blur and opacity are all user-configurable, on top of five curated themes.
- **Local-first** — every file operation runs on your machine. Nothing is uploaded.

## Features

| Area | What works today |
|------|------------------|
| Workspace | Open folder / open file, recursive explorer with collapsible folders, file sizes, recent folders |
| Editor | Tabs with dirty indicators, editable buffer, save (⌘S), save as (⇧⌘S), tab switching, close with unsaved-change prompt |
| Code presentation | Line numbers with active-line highlight, current-line highlight, lightweight syntax highlighting for JS/TS/JSON/HTML/CSS/Python and more, language detection in the status bar |
| Navigation | Command palette (⇧⌘P), find (⌘F), replace (⇧⌘F) with match counts and match highlighting, sidebar toggle (⌘B) |
| Appearance | 5 themes (Glint Dark, Glint Light, Ocean, Solarized, Midnight), custom accent/background/text/muted colours, adjustable glass blur and surface opacity, font family/size, tab size, word wrap |
| Integration | Menu bar (File/Edit/View/Theme/Window/Help), window minimise/maximise/close controls, external file change detection with reload |
| Status | Encoding, indent width, cursor position, language, active theme |

## Architecture

```
src/
  main/main.js       Electron main process: windows, menu, dialogs, file I/O, settings persistence, file watching
  preload/preload.js contextBridge API — the only renderer↔main channel (context isolation on, node integration off)
  renderer/
    index.html       UI structure and the liquid-glass design system
    renderer.js      Editor logic, syntax highlighting, command palette, find/replace, settings
```

The renderer runs sandboxed with `contextIsolation: true` and `nodeIntegration: false`. Every privileged operation goes through the typed API exposed by the preload script.

## Development

```bash
npm install
npm start          # run the app
npm run pack       # package to dist/mac-arm64/Glint.app
npm run dist       # build distributable dmg/zip
```

## Security notes

- `contextIsolation` is enabled and `nodeIntegration` is disabled.
- The preload script exposes a narrow, explicit API surface.
- All IPC channels in `main.js` have matching handlers in `preload.js`.

## Roadmap

See the project summary for the proposed feature sets (performance, AI-first editing, collaboration, UI, intelligence, and developer workflow) that would take Glint beyond VS Code.

## License

MIT
