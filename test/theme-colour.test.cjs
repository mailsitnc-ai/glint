#!/usr/bin/env node
/**
 * Verifies that each theme's glass genuinely derives from that theme's own
 * colours.
 *
 * This guards the regression where the backdrop mesh contained hardcoded
 * hues, so every theme rendered with the same magenta wash regardless of
 * its own palette.
 *
 * Usage: node test/theme-colour.test.cjs
 */

const { withPage, createReporter } = require('./helpers.cjs');

/** Parse "r, g, b" into an array. */
function parseTriplet(value) {
  const parts = String(value || '')
    .split(',')
    .map((v) => Number(v.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

/** Hue in degrees for an RGB triplet (0..360). */
function hueOf([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return null;
  let h;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h = Math.round(h * 60);
  return (h + 360) % 360;
}

/** Shortest angular distance between two hues. */
function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Hue of a hex colour. */
function hexHue(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return hueOf([(num >> 16) & 255, (num >> 8) & 255, num & 255]);
}

async function main() {
  const reporter = createReporter();

  const ok = await withPage(async (client) => {
    const themes = await client.evaluate(`window.glint.listThemes().then((t) => t.map((x) => ({
      id: x.id, label: x.label, bg: x.bg, accent: x.accent,
    })))`);

    reporter.section('THEME COUNT');
    reporter.check('all themes are registered', themes.length >= 10, String(themes.length));

    for (const theme of themes) {
      reporter.section(`THEME: ${theme.label}`);

      const result = await client.evaluate(`(async () => {
        const themes = await window.glint.listThemes();
        const found = themes.find((x) => x.id === ${JSON.stringify(theme.id)});
        await window.glint.setSettings({
          theme: found.id, bg: found.bg, text: found.text, muted: found.muted,
          accent: found.accent, glassBlur: found.glassBlur, glassOpacity: found.glassOpacity,
          liquidMode: false, liquidGlass: true,
        });
        await new Promise((r) => setTimeout(r, 700));
        const cs = getComputedStyle(document.documentElement);
        return {
          meshAccent: cs.getPropertyValue('--mesh-accent').trim(),
          meshAccent2: cs.getPropertyValue('--mesh-accent-2').trim(),
          meshAccent3: cs.getPropertyValue('--mesh-accent-3').trim(),
          meshBg: cs.getPropertyValue('--mesh-bg').trim(),
          surface: cs.getPropertyValue('--surface').trim(),
          accentRgb: cs.getPropertyValue('--accent-rgb').trim(),
          backdrop: getComputedStyle(document.getElementById('root'), '::before').backgroundImage,
        };
      })()`);

      const meshHue = hueOf(parseTriplet(result.meshAccent) || [0, 0, 0]);
      const accentHue = hexHue(theme.accent);

      reporter.check(
        'mesh accent is a valid triplet',
        parseTriplet(result.meshAccent) !== null,
        result.meshAccent,
      );
      reporter.check(
        'mesh accent is derived from the theme accent',
        meshHue !== null && accentHue !== null && hueDistance(meshHue, accentHue) <= 40,
        `mesh hue ${meshHue} vs accent hue ${accentHue}`,
      );
      // The mesh background is the theme background lifted slightly towards
      // white, so it should stay close to the theme rather than match exactly.
      const meshBg = parseTriplet(result.meshBg);
      const bgTriplet = parseTriplet(hexTriplet(theme.bg));
      const bgClose = meshBg && bgTriplet &&
        meshBg.every((v, i) => Math.abs(v - bgTriplet[i]) <= 26);
      reporter.check(
        'mesh background stays close to the theme background',
        bgClose === true,
        `${result.meshBg} vs ${theme.bg}`,
      );
      reporter.check(
        'glass surface is a translucent white frost',
        /rgba\(255,\s*255,\s*255/.test(result.surface),
        result.surface,
      );
      // getComputedStyle resolves custom properties, so the gradient carries
      // the literal mesh value rather than the var() name. Matching that
      // literal proves the backdrop is wired to the theme mesh.
      const meshLiteral = result.meshAccent.replace(/\s/g, '');
      reporter.check(
        'backdrop is wired to the theme mesh',
        result.backdrop.replace(/\s/g, '').includes(meshLiteral),
        result.backdrop.slice(0, 80),
      );
    }

    // Restore the default theme.
    await client.evaluate(`window.glint.setSettings({
      theme: 'glint-dark', bg: '#0f0f12', text: '#e8eaed', muted: '#94a3b8',
      accent: '#7c3aed', liquidMode: false, liquidGlass: true,
    })`);

    return reporter.finish();
  });

  if (!ok) process.exitCode = 1;
}

/** "15, 15, 18" for a hex colour. */
function hexTriplet(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

main().catch((err) => {
  console.error('theme colour test failed:', err.message);
  process.exitCode = 1;
});
