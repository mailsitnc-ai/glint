# Glint test suite

End-to-end tests that drive the running app through the Chromium DevTools
Protocol. They exercise the real renderer, the real IPC bridge and real file
system operations — not mocks.

## Requirements

The app must be running with a remote debugging port:

```bash
# from the repo root
npm run pack
./dist/mac-arm64/Glint.app/Contents/MacOS/Glint --remote-debugging-port=9333
```

The port can be overridden with `GLINT_DEBUG_PORT`.

## Running

```bash
npm test              # core + glass + rebrand
npm run test:core     # editor, terminal, intelligence, workflow, collaboration
npm run test:glass    # liquid glass implementation
npm run test:rebrand  # branding, providers, archive, OmniRoute
npm run screenshot -- ai /tmp/glint.png
```

## Layout

| File | Purpose |
|------|---------|
| `helpers.cjs` | Shared CDP client, selector resolution, reporter, cleanup helpers |
| `core.test.cjs` | Core editor features (25 assertions) |
| `glass.test.cjs` | Liquid glass implementation (31 assertions) |
| `rebrand.test.cjs` | Branding, 14 providers, model archive, OmniRoute (65 assertions) |
| `screenshot.cjs` | Captures a view and reports the applied glass state |

## Selector resilience

Elements are located through `data-test` attributes first, with legacy ids and
classes as fallbacks (see `SELECTOR_FALLBACKS` in `helpers.cjs`). Adding a
`data-test` attribute to a new element and one line to that map is enough to
make it available to tests — a class or id rename does not break them.

Current hooks in `src/renderer/index.html`:

`root`, `grain`, `sidebar`, `gutter`, `code-wrap`, `editor-input`,
`open-folder`, `open-palette`, `open-settings`, `view-explorer`,
`view-search`, `view-git`, `view-collab`, `view-deploy`, `view-database`,
`view-api`, `view-marketplace`, `view-ai`.

## Cleanup

`helpers.cjs` exposes `withPage()`, which always closes the WebSocket in a
`finally` block — including when an assertion throws. `connect()` returns a
client whose `close()` is idempotent and safe to call more than once, and
resolves any in-flight commands before closing. Every test script sets
`process.exitCode` rather than calling `process.exit()`, so Node can flush
output and close its own handles cleanly.

## Known external failures

`rebrand.test.cjs` asserts that OpenCode Zen's anonymous free model answers.
That tier is rate-limited per IP by OpenCode, so the assertion fails once the
shared address has exhausted its quota. This is an external condition, not a
Glint defect — the provider correctly surfaces the upstream `429`.

CoArena's server has also been observed refusing connections (`HTTP 000`)
from time to time; the model-listing assertion fails while it is down and
recovers when it returns.
