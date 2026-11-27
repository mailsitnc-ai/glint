#!/usr/bin/env node
/**
 * Capture a screenshot of the running Glint app for visual review.
 *
 * Usage:
 *   node test/screenshot.cjs [view] [outputPath]
 *
 * Views: main | ai | settings | palette | terminal | explorer
 *
 * Requires Glint to be running with a remote debugging port:
 *   Glint.app/Contents/MacOS/Glint --remote-debugging-port=9333
 */

const fs = require('node:fs');
const path = require('node:path');
const { withPage, selectorExpr, DEFAULT_PORT } = require('./helpers.cjs');

const VIEWS = {
  main: '',
  ai: `document.querySelector('[data-test="view-ai"]')?.click();`,
  explorer: `document.querySelector('[data-test="view-explorer"]')?.click();`,
  settings: `document.querySelector('[data-test="open-settings"]')?.click();`,
  palette: `document.querySelector('[data-test="open-palette"]')?.click();`,
  terminal: `document.querySelector('.panel-tab[data-panel="terminal"]')?.click();`,
};

/** Dismiss any overlay so the requested view is visible in the capture. */
const DISMISS = `document.getElementById('paletteOverlay')?.classList.remove('open');
document.getElementById('modalOverlay')?.classList.remove('open');`;

async function main() {
  const view = process.argv[2] || 'main';
  const out = process.argv[3] || path.join(process.cwd(), `glint-${view}.png`);

  if (!VIEWS[view]) {
    console.error(`Unknown view "${view}". Options: ${Object.keys(VIEWS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const ok = await withPage(async (client) => {
    const action = VIEWS[view];

    await client.evaluate(`(async () => {
      ${DISMISS}
      ${action}
      await new Promise((r) => setTimeout(r, 900));
      return true;
    })()`);

    // Report what the renderer actually applied, so a screenshot can be
    // sanity-checked against the computed styles.
    const style = await client.evaluate(`(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const backdrop = getComputedStyle(document.getElementById('root'), '::before');
      const sidebar = document.querySelector('[data-test="sidebar"]');
      return {
        backdrop: backdrop.backgroundImage.slice(0, 90),
        backdropVisible: backdrop.backgroundImage !== 'none',
        accentRgb: cs.getPropertyValue('--accent-rgb').trim(),
        surface: cs.getPropertyValue('--surface').trim(),
        glassEdge: cs.getPropertyValue('--glass-edge').trim(),
        glassBlur: cs.getPropertyValue('--glass-blur').trim(),
        sidebarBackdrop: sidebar ? getComputedStyle(sidebar).backdropFilter : null,
        grainPresent: !!document.querySelector('[data-test="grain"]'),
        mode: document.body.className,
      };
    })()`);

    const shot = await client.command('Page.captureScreenshot', { format: 'png' });
    if (!shot.result?.data) {
      throw new Error('Page.captureScreenshot returned no data');
    }
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log(JSON.stringify(style, null, 2));
    console.log(`screenshot saved: ${out} (${fs.statSync(out).size} bytes)`);
    return true;
  });

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('screenshot failed:', err.message);
  process.exitCode = 1;
});
