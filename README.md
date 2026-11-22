# Glint

A VS Code-inspired code editor with a liquid-glass UI, full colour and font customisation, built-in AI, collaboration, and developer workflow tools — all on an Electron shell.

Glint is built around three principles:

- **Liquid glass UI** — translucent, blurred surfaces (`backdrop-filter`) that tint with your desktop. A "liquid mode" refracts your actual desktop wallpaper behind the editor.
- **Fully personalisable** — accent, background, foreground, muted text, glass blur and opacity, plus complete typography control (font family, size, weight, line height, letter spacing, ligatures, and custom font import).
- **Local-first** — every file operation runs on your machine. Nothing is uploaded unless you explicitly deploy.

---

## Feature sets

### Performance
- **Virtual scrolling** — only the visible window of lines is rendered for huge files (configurable threshold, default 5000 lines). Verified with 12,000-line files.
- **Native file watching** — event-driven `fs.watch` with debounced notifications instead of polling.
- **Non-blocking typing** — all heavy work (AI requests, analysis, git, deploys) runs in the main process or off the UI thread.
- **Lazy startup** — no extension host to warm up.

### AI-first
Configure any OpenAI-compatible provider — local (Ollama, LM Studio, llama.cpp server) or cloud.
- **Chat panel** with file context attachment and conversation history
- **Inline ghost text** completions while typing (rate-limited so typing stays smooth)
- **AI explain**, **AI refactor** (with a stated goal), **AI docstring generation**
- **AI commit messages** generated from your actual git diff
- **Local fallback** docstring generator that works with no provider configured

### Collaboration
Zero runtime dependencies — Glint ships its own RFC6455 WebSocket client/server.
- **Built-in relay server** so teammates connect over your LAN (or a tunnel)
- **Operation-based edit sync** with sequence numbers and deduplication
- **Live peer cursors** with per-user colours and name flags
- **Session chat** and a session URL you can copy and share

### UI / UX
- **Liquid mode** — refracts your desktop wallpaper behind translucent surfaces
- **Ambient light** — tint follows the time of day (dawn → day → dusk → night)
- **Theme marketplace** — 10 built-in themes plus custom theme export/import
- **Per-project themes** via `.glint/settings.json`
- **Zen mode** — hide all chrome and focus on code

### Intelligence
- **Semantic-ish search** across the project with relevance scoring and symbol bonuses
- **Dead-code detection** by cross-referencing definitions and usages
- **Test impact analysis** mapping source files to the tests that touch them
- **Project overview** statistics (files, lines, languages, dead code, test coverage)

### Developer workflow
- **Live preview** with auto-detected dev server (Vite, Next, Nuxt, CRA, static, Python)
- **Deploy targets** — Vercel, Netlify, Cloudflare Pages, GitHub Pages, or local export
- **Database browser** — SQLite files and HTTP JSON endpoints
- **Embedded API client** — methods, headers, body, formatted response viewer, request history
- **Terminal panel** for running commands in the workspace

### Typography
- Font family (system monospace fonts plus custom imports)
- Font size, weight, line height, letter spacing
- Font ligatures toggle
- Import `.ttf` / `.otf` fonts directly from your Mac

---

## Core editing (verified end-to-end)

| Area | What works |
|------|------------|
| Workspace | Open folder / open file, recursive explorer with collapsible folders, file sizes, recent folders |
| Editor | Tabs with dirty indicators, save (⌘S), save as (⇧⌘S), close with unsaved-change prompt |
| Code presentation | Line numbers with active-line highlight, current-line highlight, syntax highlighting, language detection |
| Navigation | Command palette (⇧⌘P), find (⌘F), replace (⇧⌘F), sidebar toggle (⌘B), bottom panel (⌘J) |
| Appearance | Colour customisation, glass blur/opacity sliders, 10 themes, ambient light, liquid mode |
| Integration | Menu bar (File/Edit/View/AI/Collab/Theme/Tools/Window/Help), window controls, external file-change detection |
| Status | Encoding, indent width, cursor position, language, active theme, live-collab indicator |

---

## Architecture

```
src/
  main/
    main.js                    Electron entry: window, menu, IPC wiring
    services/
      settings.js              Global + per-workspace settings store
      workspace.js             Tree building, file I/O, native fs.watch
      ai.js                    Provider abstraction (local + cloud)
      collaboration.js         Operation-based sync, peer/cursor/chat state
      relay.js                 In-process collaboration relay server
      websocket.js             RFC6455 WebSocket client/server (no deps)
      intelligence.js          Search, dead code, test impact, docstrings
      workflow.js              Preview, deploy, database, API client, terminal
      themes.js                Built-in themes, marketplace, wallpaper, fonts
      git.js                   Status, diff, stage, commit, log
  preload/
    preload.js                 contextBridge API — the only renderer↔main channel
  renderer/
    index.html                 UI structure
    styles/
      base.css                 Design system, layout, editor, activity bar
      panels.css               AI chat, settings, marketplace, dialogs, panels
    modules/
      editor.js                EditorEngine: virtual scrolling, highlighting, tabs
      themes.js                ThemeManager: appearance, fonts, marketplace, liquid mode
      ai.js                    AI chat, ghost text, refactor, commit messages
      collaboration.js         Session lifecycle, remote cursors, chat
      intelligence.js          Search, dead code, test impact, overview
      workflow.js              Preview, deploy, database, API client, terminal
    renderer.js                Entry point wiring everything together
```

The renderer runs sandboxed with `contextIsolation: true` and `nodeIntegration: false`. Every privileged operation goes through the explicit API exposed by the preload script. All heavy computation lives in the main process.

---

## Development

```bash
npm install
npm start          # run the app
npm run pack       # package to dist/mac-arm64/Glint.app
npm run dist       # build distributable dmg/zip
```

## Verification

- **47/47 end-to-end feature tests pass** against the packaged app, covering every feature set above (UI structure, editor, fonts, colours, performance settings, virtual scrolling, marketplace, semantic search, dead code, test impact, docstrings, AI provider handling, collaboration + relay health, API client, deploy targets, database validation, terminal, zen/liquid mode, ambient tint, command palette, git).
- Syntax checks pass on all main-process and renderer modules.
- Renderer boots with no console errors.

## Security notes

- `contextIsolation` enabled, `nodeIntegration` disabled.
- Narrow, explicit preload API surface.
- All IPC channels in `main.js` have matching handlers in `preload.js`.
- AI provider credentials are stored locally and only sent to the endpoint you configure.

## License

MIT
