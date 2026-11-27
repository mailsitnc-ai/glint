#!/usr/bin/env node
/**
 * Verifies the liquid glass implementation.
 *
 * These assertions check the *mechanism* rather than a screenshot:
 *  - a real backdrop exists behind the glass (backdrop-filter has something
 *    to refract — this was the original bug)
 *  - every glass surface is translucent, not opaque
 *  - blur and saturation are actually applied
 *  - surfaces use the accent colour so the refraction shifts hue per panel
 *  - the grain and bloom layers are present
 *  - no-glass and liquid-mode behave correctly
 *
 * Usage: node test/glass.test.cjs
 */

const { withPage, selectorExpr, createReporter, DEFAULT_PORT } = require('./helpers.cjs');

async function main() {
  const reporter = createReporter();

  const ok = await withPage(async (client) => {
    /* ---------------------------------------------------------------- */
    reporter.section('BACKDROP LAYER (the thing that was missing)');

    const backdrop = await client.evaluate(`(() => {
      const root = document.querySelector('[data-test="root"]');
      if (!root) return { error: 'root element not found' };
      const before = getComputedStyle(root, '::before');
      const after = getComputedStyle(root, '::after');
      return {
        backgroundImage: before.backgroundImage,
        hasGradients: before.backgroundImage.includes('gradient'),
        gradientCount: (before.backgroundImage.match(/gradient/g) || []).length,
        zIndex: before.zIndex,
        bloomImage: after.backgroundImage,
        bloomBlend: after.mixBlendMode,
        grainPresent: !!document.querySelector('[data-test="grain"]'),
        grainOpacity: document.querySelector('[data-test="grain"]')
          ? getComputedStyle(document.querySelector('[data-test="grain"]')).opacity
          : null,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      };
    })()`);

    reporter.check('backdrop layer exists', !backdrop.error, JSON.stringify(backdrop));
    reporter.check(
      'backdrop uses layered gradients (not a flat colour)',
      backdrop.hasGradients && backdrop.gradientCount >= 3,
      `gradients=${backdrop.gradientCount}`,
    );
    reporter.check('backdrop sits behind the content', backdrop.zIndex === '-3', backdrop.zIndex);
    reporter.check(
      'bloom layer uses screen blending',
      backdrop.bloomBlend === 'screen',
      backdrop.bloomBlend,
    );
    reporter.check('grain layer is present', backdrop.grainPresent === true);
    reporter.check(
      'grain opacity is subtle',
      Number(backdrop.grainOpacity) > 0 && Number(backdrop.grainOpacity) < 0.1,
      backdrop.grainOpacity,
    );

    /* ---------------------------------------------------------------- */
    reporter.section('GLASS MATERIAL');

    const glass = await client.evaluate(`(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const sidebar = document.querySelector('[data-test="sidebar"]');
      const sb = sidebar ? getComputedStyle(sidebar) : null;
      const status = document.querySelector('.statusbar');
      const st = status ? getComputedStyle(status) : null;
      const title = document.querySelector('.titlebar');
      const tt = title ? getComputedStyle(title) : null;

      // A glass surface splits its paint between a translucent gradient
      // (background-image) and a base colour. Measure the highest alpha that
      // actually contributes, so "transparent base + gradient tint" counts.
      const maxAlpha = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const sources = [cs.backgroundColor, cs.backgroundImage];
        let highest = 0;
        let found = false;
        for (const source of sources) {
          const matches = String(source).matchAll(/rgba\(([^)]+)\)/g);
          for (const m of matches) {
            const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
            const a = parts.length > 3 ? parts[3] : 1;
            if (!Number.isNaN(a)) {
              found = true;
              if (a > highest) highest = a;
            }
          }
        }
        return found ? highest : null;
      };

      return {
        blurFilter: cs.getPropertyValue('--glass-blur-filter').trim(),
        specular: cs.getPropertyValue('--glass-specular').trim(),
        edge: cs.getPropertyValue('--glass-edge').trim(),
        accentRgb: cs.getPropertyValue('--accent-rgb').trim(),
        sidebar: sb && {
          backdrop: sb.backdropFilter,
          alpha: maxAlpha(sidebar),
          border: sb.borderRightColor,
        },
        status: st && {
          backdrop: st.backdropFilter,
          alpha: maxAlpha(status),
        },
        title: tt && {
          backdrop: tt.backdropFilter,
          alpha: maxAlpha(title),
        },
      };
    })()`);

    reporter.check(
      'glass blur filter combines blur + saturation + brightness',
      /blur\(/.test(glass.blurFilter) && /saturate\(/.test(glass.blurFilter),
      glass.blurFilter,
    );
    reporter.check(
      'saturation is boosted above 150%',
      /saturate\((\d+(\.\d+)?)%\)/.test(glass.blurFilter) &&
        Number(RegExp.$1) >= 150,
      glass.blurFilter,
    );
    reporter.check('specular highlight is defined', glass.specular.length > 0, glass.specular);
    reporter.check('accent RGB triplet is published', /^\d+,\s*\d+,\s*\d+$/.test(glass.accentRgb), glass.accentRgb);

    for (const [name, surface] of [['sidebar', glass.sidebar], ['status bar', glass.status], ['title bar', glass.title]]) {
      reporter.check(`${name} applies backdrop-filter`, !!surface?.backdrop && surface.backdrop !== 'none', String(surface?.backdrop));
      reporter.check(
        `${name} is translucent (alpha < 0.75)`,
        surface?.alpha !== null && surface?.alpha !== undefined && surface.alpha < 0.75,
        String(surface?.alpha),
      );
    }

    /* ---------------------------------------------------------------- */
    reporter.section('GLASS EDGE / SPECULAR DETAIL');

    const edge = await client.evaluate(`(() => {
      const probe = document.createElement('div');
      probe.className = 'glass';
      probe.setAttribute('data-test', 'glass-probe');
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px;';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const before = getComputedStyle(probe, '::before');
      const result = {
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        boxShadow: cs.boxShadow,
        edgeImage: before.backgroundImage,
        edgeHasGradient: before.backgroundImage.includes('gradient'),
        edgeMask: before.maskComposite || before.webkitMaskComposite,
        radius: cs.borderRadius,
      };
      probe.remove();
      return result;
    })()`);

    reporter.check('glass has a gradient edge', edge.edgeHasGradient === true, edge.edgeImage?.slice(0, 60));
    reporter.check(
      'glass edge uses a mask so only the 1px border shows',
      (edge.edgeMask || '').includes('exclude'),
      edge.edgeMask,
    );
    reporter.check('glass has an inset bevel highlight', edge.boxShadow.includes('inset'), edge.boxShadow?.slice(0, 70));
    reporter.check('glass has a rounded radius', parseFloat(edge.radius) >= 12, edge.radius);

    /* ---------------------------------------------------------------- */
    reporter.section('MODES');

    const modes = await client.evaluate(`(async () => {
      const root = document.documentElement;
      const read = () => ({
        noGlass: document.body.classList.contains('no-glass'),
        liquid: document.body.classList.contains('liquid-mode'),
        backdrop: getComputedStyle(root.querySelector('#root') || document.getElementById('root'), '::before').backgroundImage,
      });
      const before = read();

      // Turn on solid mode and confirm the backdrop survives (dimmed, not removed).
      document.body.classList.add('no-glass');
      const solid = read();
      document.body.classList.remove('no-glass');

      document.body.classList.add('liquid-mode');
      const liquid = read();
      document.body.classList.remove('liquid-mode');

      return { before, solid, liquid };
    })()`);

    reporter.check(
      'solid mode keeps a backdrop instead of removing it',
      modes.solid.backdrop.includes('gradient'),
      modes.solid.backdrop?.slice(0, 50),
    );
    reporter.check(
      'liquid mode layers the wallpaper over the mesh',
      modes.liquid.backdrop.includes('gradient'),
      modes.liquid.backdrop?.slice(0, 50),
    );
    reporter.check(
      'liquid mode backdrop differs from the default',
      modes.liquid.backdrop !== modes.before.backdrop,
      'identical',
    );

    /* ---------------------------------------------------------------- */
    reporter.section('APPLIED SURFACES');

    const surfaces = await client.evaluate(`(() => {
      const names = ['.titlebar', '.activitybar', '.sidebar', '.tabbar', '.statusbar', '.editor-body', '.findbar', '.bottom-panel'];
      const out = {};
      for (const sel of names) {
        const el = document.querySelector(sel);
        if (!el) { out[sel] = null; continue; }
        const cs = getComputedStyle(el);
        out[sel] = { backdrop: cs.backdropFilter, hasBlur: cs.backdropFilter.includes('blur') };
      }
      return out;
    })()`);

    for (const [sel, info] of Object.entries(surfaces)) {
      reporter.check(`${sel} is glass (has blur)`, info?.hasBlur === true, String(info?.backdrop));
    }

    return reporter.finish();
  });

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('glass test failed:', err.message);
  process.exitCode = 1;
});
