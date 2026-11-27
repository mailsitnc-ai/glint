/* ==========================================================================
   Theme + settings module: colour customisation, fonts, marketplace,
   per-project themes, liquid mode and ambient light.
   ========================================================================== */

const SYSTEM_FONTS = [
  'Menlo',
  'Monaco',
  'SF Mono',
  'Courier New',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Iosevka',
  'Hack',
  'Ubuntu Mono',
  'Consolas',
  'Cascadia Code',
  'system-ui',
  'ui-monospace',
];

export class ThemeManager {
  constructor(api, onChange) {
    this.api = api;
    this.onChange = onChange || (() => {});
    this.settings = {};
    this.themes = [];
    this.customFonts = [];
    this.ambientTimer = null;
  }

  async init() {
    this.settings = await this.api.getSettings();
    this.themes = await this.api.listThemes();
    this.customFonts = await this.api.listFonts();
    this.apply();
    this.startAmbientLoop();
    return this.settings;
  }

  /* ------------------------------------------------------------------ */
  /* Applying appearance                                                    */
  /* ------------------------------------------------------------------ */

  apply() {
    const s = this.settings;
    const root = document.documentElement;

    root.style.setProperty('--bg', s.bg);
    root.style.setProperty('--text', s.text);
    root.style.setProperty('--text-muted', s.muted);
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--accent-rgb', rgbTriplet(s.accent));
    root.style.setProperty('--accent-soft', rgba(s.accent, 0.3));
    root.style.setProperty('--accent-contrast', contrastColor(s.accent));

    // The backdrop mesh is derived entirely from the theme's own colours, so
    // a theme never inherits another theme's hue. Each mesh blob is a
    // lightened / desaturated relative of the accent or background, which
    // keeps the result pastel and airy rather than neon.
    const backdrop = buildBackdropPalette(s);
    root.style.setProperty('--mesh-accent', backdrop.accent);
    root.style.setProperty('--mesh-accent-2', backdrop.accent2);
    root.style.setProperty('--mesh-accent-3', backdrop.accent3);
    root.style.setProperty('--mesh-bg', backdrop.bg);
    root.style.setProperty('--mesh-bg-2', backdrop.bg2);
    root.style.setProperty('--mesh-light', backdrop.light);

    // Liquid glass surfaces: translucent white tint over the backdrop rather
    // than a flat tint of the background colour, so the blur actually reads.
    // A near-white tint keeps the material frosted and light in every
    // theme; the colour comes from the backdrop behind it, not the surface.
    // rgbaTriplet takes an "r, g, b" string, which is what the glass tokens
    // use. rgba() expects a hex value, so they must not be mixed up.
    const tint = '255, 255, 255';
    const opacity = s.glassOpacity / 100;
    root.style.setProperty('--glass-tint', tint);
    root.style.setProperty('--surface', rgbaTriplet(tint, opacity * 0.28));
    root.style.setProperty('--surface-strong', rgbaTriplet(tint, opacity * 0.42));
    root.style.setProperty('--surface-hover', rgbaTriplet(tint, 0.14));
    root.style.setProperty('--sidebar', rgbaTriplet(tint, opacity * 0.22));
    root.style.setProperty('--glass-edge', rgbaTriplet(tint, 0.42));
    root.style.setProperty('--glass-edge-strong', rgbaTriplet(tint, 0.62));
    root.style.setProperty('--glass-specular', rgbaTriplet(tint, 0.92));
    root.style.setProperty('--glass-inner', rgbaTriplet(tint, 0.22));
    root.style.setProperty('--glass-border', rgbaTriplet(tint, 0.34));
    root.style.setProperty('--tab-active', rgbaTriplet(tint, 0.22));
    root.style.setProperty('--tab-hover', rgbaTriplet(tint, 0.10));
    root.style.setProperty('--scrollbar', rgbaTriplet(tint, 0.18));
    root.style.setProperty('--glass-blur', `${s.glassBlur}px`);
    root.style.setProperty('--font-size', `${s.fontSize}px`);
    root.style.setProperty('--font-weight', String(s.fontWeight || 400));
    root.style.setProperty('--font-line-height', String(s.fontLineHeight || 1.55));
    root.style.setProperty('--letter-spacing', `${s.letterSpacing || 0}px`);
    root.style.setProperty('--font-ligatures', s.fontLigatures ? 'normal' : 'none');
    root.style.setProperty(
      '--font-family',
      `${s.fontFamily || 'Menlo'}, Monaco, Consolas, 'Courier New', monospace`,
    );

    document.body.classList.toggle('no-glass', !s.liquidGlass);
    document.body.classList.toggle('liquid-mode', !!s.liquidMode);
    document.body.classList.toggle('zen-mode', !!s.zenMode);
    root.style.setProperty('--wallpaper-dim', String((s.wallpaperDim ?? 45) / 100));

    // Syntax colours adapt to light backgrounds for readability.
    const light = isLight(s.bg);
    root.style.setProperty('--syn-keyword', light ? '#7c3aed' : '#c084fc');
    root.style.setProperty('--syn-string', light ? '#047857' : '#86efac');
    root.style.setProperty('--syn-number', light ? '#b45309' : '#fbbf24');
    root.style.setProperty('--syn-comment', light ? '#6b7280' : '#64748b');
    root.style.setProperty('--syn-function', light ? '#1d4ed8' : '#60a5fa');
    root.style.setProperty('--syn-operator', light ? '#be185d' : '#f472b6');
    root.style.setProperty('--syn-punct', s.muted);
    root.style.setProperty('--syn-const', light ? '#0369a1' : '#7dd3fc');

    this.onChange(this.settings);
  }

  /* ------------------------------------------------------------------ */
  /* Ambient light                                                         */
  /* ------------------------------------------------------------------ */

  startAmbientLoop() {
    clearInterval(this.ambientTimer);
    this.ambientTimer = setInterval(() => this.updateAmbient(), 60000);
    this.updateAmbient();
  }

  async updateAmbient() {
    if (!this.settings.ambientLight) {
      document.documentElement.style.setProperty('--ambient-tint', 'transparent');
      document.documentElement.style.setProperty('--ambient-intensity', '0');
      return;
    }
    const ambient = await this.api.ambientTint();
    if (!ambient || !ambient.color) return;
    document.documentElement.style.setProperty('--ambient-tint', ambient.color);
    document.documentElement.style.setProperty('--ambient-intensity', String(ambient.intensity));
  }

  /* ------------------------------------------------------------------ */
  /* Liquid mode (wallpaper)                                               */
  /* ------------------------------------------------------------------ */

  async enableLiquidMode(enable) {
    this.settings.liquidMode = enable;
    if (enable) {
      const result = await this.api.captureWallpaper();
      if (result.ok) {
        const url = `file://${encodeURI(result.path)}`;
        document.documentElement.style.setProperty('--wallpaper', `url("${url}")`);
      } else if (!this.settings.liquidMode) {
        // Wallpaper capture is unavailable; keep liquid mode but without image.
        document.documentElement.style.setProperty('--wallpaper', 'none');
      }
    }
    this.apply();
    await this.api.setSettings({ liquidMode: enable });
  }

  /* ------------------------------------------------------------------ */
  /* Themes                                                                */
  /* ------------------------------------------------------------------ */

  async applyTheme(themeId) {
    const theme = this.themes.find((t) => t.id === themeId);
    if (!theme) return null;
    const patch = {
      theme: theme.id,
      bg: theme.bg,
      text: theme.text,
      muted: theme.muted,
      accent: theme.accent,
      glassBlur: theme.glassBlur,
      glassOpacity: theme.glassOpacity,
    };
    this.settings = { ...this.settings, ...patch };
    this.apply();
    await this.api.setSettings(patch);
    return theme;
  }

  async update(patch) {
    this.settings = { ...this.settings, ...patch };
    this.apply();
    const saved = await this.api.setSettings(patch);
    if (saved) this.settings = { ...this.settings, ...saved };
    return this.settings;
  }

  async refreshThemes() {
    this.themes = await this.api.listThemes();
    return this.themes;
  }

  async exportTheme(name) {
    const result = await this.api.exportTheme(name);
    if (result.ok) await this.refreshThemes();
    return result;
  }

  async removeTheme(id) {
    const result = await this.api.removeTheme(id);
    if (result.ok) await this.refreshThemes();
    return result;
  }

  async importFont() {
    const result = await this.api.importFont();
    if (result.ok) {
      this.customFonts = await this.api.listFonts();
      await this.update({ fontFamily: result.family });
    }
    return result;
  }

  getFontOptions() {
    const custom = this.customFonts.map((f) => f.family);
    return [...new Set([...SYSTEM_FONTS, ...custom])];
  }
}

/* -------------------------------------------------------------------- */
/* Colour helpers                                                       */
/* -------------------------------------------------------------------- */

/**
 * Derive the liquid-glass backdrop palette from a theme.
 *
 * The reference treatment is a soft, light, frosted field — not saturated
 * neon. So each blob is the theme colour pushed towards white and slightly
 * desaturated. Dark themes therefore produce deep, muted jewel tones while
 * light themes produce the pale periwinkle of the reference.
 */
export function buildBackdropPalette(settings) {
  const accent = hexToRgb(settings.accent);
  const bg = hexToRgb(settings.bg);
  const light = isLight(settings.bg);

  // Blend a colour towards white by `amount` (0..1).
  const toward = (c, amount) => ({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount),
  });

  // Blend two colours together.
  const mix = (a, b, amount) => ({
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  });

  if (light) {
    // Light theme: pale, luminous, close to the reference image.
    const a = toward(accent, 0.62);
    const b = toward(mix(accent, bg, 0.55), 0.55);
    const c = toward(bg, 0.42);
    const bgLift = toward(bg, 0.18);
    const bg2 = toward(c, 0.3);
    return {
      accent: `${a.r}, ${a.g}, ${a.b}`,
      accent2: `${b.r}, ${b.g}, ${b.b}`,
      accent3: `${c.r}, ${c.g}, ${c.b}`,
      bg: `${bgLift.r}, ${bgLift.g}, ${bgLift.b}`,
      bg2: `${bg2.r}, ${bg2.g}, ${bg2.b}`,
      light: '255, 255, 255',
    };
  }

  // Dark theme: deep and muted, but still clearly coloured rather than black.
  const a = toward(accent, 0.30);
  const b = toward(mix(accent, bg, 0.6), 0.22);
  const c = toward(bg, 0.14);
  return {
    accent: `${a.r}, ${a.g}, ${a.b}`,
    accent2: `${b.r}, ${b.g}, ${b.b}`,
    accent3: `${c.r}, ${c.g}, ${c.b}`,
    bg: `${bg.r}, ${bg.g}, ${bg.b}`,
    bg2: `${c.r}, ${c.g}, ${c.b}`,
    light: '255, 255, 255',
  };
}

/** "124, 58, 237" — for use inside rgba() in CSS. */
export function rgbTriplet(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 124, g: 58, b: 237 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Build an rgba() string from an "r, g, b" triplet. */
export function rgbaTriplet(triplet, alpha) {
  return `rgba(${triplet},${alpha})`;
}

export function isLight(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function contrastColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#111111' : '#ffffff';
}
