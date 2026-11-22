/* Glint renderer — runs in a sandboxed context with no Node access.
   All privileged operations go through `window.glint` (exposed by preload). */

(() => {
  'use strict';

  const api = window.glint;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  const state = {
    settings: {
      theme: 'glint-dark',
      accent: '#7c3aed',
      bg: '#0f0f12',
      text: '#e8eaed',
      muted: '#94a3b8',
      glassBlur: 22,
      glassOpacity: 62,
      fontSize: 14,
      fontFamily: 'Menlo',
      tabSize: 2,
      wordWrap: false,
      liquidGlass: true,
    },
    workspace: null, // { path, name, tree }
    tabs: [], // { path, name, content, dirty, language }
    activeIndex: -1,
    expanded: new Set(),
    findMatches: [],
    findIndex: -1,
    replaceMode: false,
    paletteIndex: 0,
    paletteItems: [],
  };

  /* ------------------------------------------------------------------ */
  /* DOM refs                                                            */
  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  const el = {
    workspaceName: $('workspaceName'),
    sidebar: $('sidebar'),
    sidebarBody: $('sidebarBody'),
    sidebarTitle: $('sidebarTitle'),
    tabbar: $('tabbar'),
    gutter: $('gutter'),
    codeWrap: $('codeWrap'),
    highlightCode: $('highlightCode'),
    editorInput: $('editorInput'),
    cursorLine: $('cursorLine'),
    placeholder: $('placeholder'),
    statusLeft: $('statusLeft'),
    statusPos: $('statusPos'),
    statusIndent: $('statusIndent'),
    statusLang: $('statusLang'),
    statusTheme: $('statusTheme'),
    findbar: $('findbar'),
    findInput: $('findInput'),
    replaceInput: $('replaceInput'),
    matchCount: $('matchCount'),
    paletteOverlay: $('paletteOverlay'),
    paletteInput: $('paletteInput'),
    paletteList: $('paletteList'),
    settingsPanel: $('settingsPanel'),
    themeSwatches: $('themeSwatches'),
    toast: $('toast'),
  };

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  const escapeHtml = (s) => {
    const amp = String.fromCharCode(38);
    return String(s)
      .replace(/&/g, amp + 'amp;')
      .replace(/</g, amp + 'lt;')
      .replace(/>/g, amp + 'gt;')
      .replace(/"/g, amp + 'quot;')
      .replace(/'/g, amp + '#39;');
  };

  let toastTimer = null;
  function toast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  const activeTab = () => (state.activeIndex >= 0 ? state.tabs[state.activeIndex] : null);

  /* ------------------------------------------------------------------ */
  /* Theme / settings                                                    */
  /* ------------------------------------------------------------------ */

  const THEMES = {
    'glint-dark': { label: 'Glint Dark', bg: '#0f0f12', text: '#e8eaed', muted: '#94a3b8', accent: '#7c3aed' },
    'glint-light': { label: 'Glint Light', bg: '#f4f5f7', text: '#1e1e1e', muted: '#5b6472', accent: '#6d28d9' },
    ocean: { label: 'Ocean', bg: '#0b1f30', text: '#e2e8f0', muted: '#7d9ab5', accent: '#38bdf8' },
    solarized: { label: 'Solarized', bg: '#fdf6e3', text: '#586e75', muted: '#93a1a1', accent: '#268bd2' },
    midnight: { label: 'Midnight', bg: '#05060a', text: '#d6deeb', muted: '#637777', accent: '#a855f7' },
  };

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return `rgba(124,58,237,${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function applySettings() {
    const s = state.settings;
    const root = document.documentElement;

    root.style.setProperty('--bg', s.bg);
    root.style.setProperty('--text', s.text);
    root.style.setProperty('--muted', s.muted);
    root.style.setProperty('--text-muted', s.muted);
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--accent-soft', hexToRgba(s.accent, 0.3));
    root.style.setProperty('--surface', hexToRgba(s.bg, s.glassOpacity / 100));
    root.style.setProperty('--surface-strong', hexToRgba(s.bg, 0.94));
    root.style.setProperty('--surface-hover', hexToRgba(s.text, 0.07));
    root.style.setProperty('--sidebar', hexToRgba(s.bg, (s.glassOpacity + 10) / 100));
    root.style.setProperty('--glass-border', hexToRgba(s.text, 0.12));
    root.style.setProperty('--tab-active', hexToRgba(s.text, 0.11));
    root.style.setProperty('--tab-hover', hexToRgba(s.text, 0.05));
    root.style.setProperty('--scrollbar', hexToRgba(s.text, 0.09));
    root.style.setProperty('--glass-blur', `${s.glassBlur}px`);
    root.style.setProperty('--font-size', `${s.fontSize}px`);
    root.style.setProperty('--font-family', `${s.fontFamily}, Monaco, Consolas, 'Courier New', monospace`);

    document.body.classList.toggle('no-glass', !s.liquidGlass);

    // Syntax colours adapt to light backgrounds for readability.
    const isLight = isLightColor(s.bg);
    root.style.setProperty('--syn-keyword', isLight ? '#7c3aed' : '#c084fc');
    root.style.setProperty('--syn-string', isLight ? '#047857' : '#86efac');
    root.style.setProperty('--syn-number', isLight ? '#b45309' : '#fbbf24');
    root.style.setProperty('--syn-comment', isLight ? '#6b7280' : '#64748b');
    root.style.setProperty('--syn-function', isLight ? '#1d4ed8' : '#60a5fa');
    root.style.setProperty('--syn-operator', isLight ? '#be185d' : '#f472b6');
    root.style.setProperty('--syn-punct', s.muted);
    root.style.setProperty('--syn-const', isLight ? '#0369a1' : '#7dd3fc');

    el.editorInput.style.tabSize = String(s.tabSize);
    el.editorInput.classList.toggle('wrap', !!s.wordWrap);
    el.codeWrap.classList.toggle('wrap', !!s.wordWrap);
    el.codeWrap.classList.toggle('no-wrap', !s.wordWrap);

    el.statusIndent.textContent = `Spaces: ${s.tabSize}`;
    el.statusTheme.textContent = (THEMES[s.theme] || {}).label || s.theme;

    // Sync the settings form.
    $('cAccent').value = s.accent;
    $('cBg').value = s.bg;
    $('cText').value = s.text;
    $('cMuted').value = s.muted;
    $('rBlur').value = s.glassBlur;
    $('rOpacity').value = s.glassOpacity;
    $('nFontSize').value = s.fontSize;
    $('sFontFamily').value = s.fontFamily;
    $('nTabSize').value = s.tabSize;
    $('tGlass').classList.toggle('on', !!s.liquidGlass);
    $('tWrap').classList.toggle('on', !!s.wordWrap);
  }

  function isLightColor(hex) {
    const clean = (hex || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return false;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  }

  function renderThemeSwatches() {
    el.themeSwatches.innerHTML = '';
    Object.entries(THEMES).forEach(([key, t]) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (state.settings.theme === key ? ' active' : '');
      sw.title = t.label;
      sw.innerHTML = `<div class="sw-bg" style="background:${t.bg}"></div><div class="sw-accent" style="background:${t.accent}"></div>`;
      sw.onclick = async () => {
        const next = { theme: key, bg: t.bg, text: t.text, muted: t.muted, accent: t.accent };
        state.settings = { ...state.settings, ...next };
        applySettings();
        await api.setSettings(next);
        renderThemeSwatches();
        toast(`${t.label} applied`);
      };
      el.themeSwatches.appendChild(sw);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Syntax highlighting                                                 */
  /* ------------------------------------------------------------------ */

  const KEYWORDS = new Set([
    'const','let','var','function','return','if','else','for','while','do','break','continue','new','class','extends','super',
    'this','typeof','instanceof','in','of','delete','void','null','undefined','true','false','async','await','yield','try','catch',
    'finally','throw','switch','case','default','import','export','from','as','static','get','set','interface','type','enum','implements',
    'public','private','protected','readonly','abstract','declare','namespace','module','require','exports','def','class','lambda','pass',
    'elif','else','None','True','False','self','and','or','not','is','global','nonlocal','with','as','raise','yield','print','func','var','let','const',
  ]);

  const CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'None', 'True', 'False', 'self']);

  function detectLanguage(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const map = {
      js: 'JavaScript', jsx: 'JavaScript React', mjs: 'JavaScript', cjs: 'JavaScript',
      ts: 'TypeScript', tsx: 'TypeScript React',
      json: 'JSON', jsonc: 'JSON',
      html: 'HTML', htm: 'HTML', xml: 'XML', svg: 'SVG',
      css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
      py: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', swift: 'Swift',
      c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cs: 'C#', php: 'PHP', lua: 'Lua',
      sh: 'Shell', bash: 'Shell', zsh: 'Shell', yml: 'YAML', yaml: 'YAML', toml: 'TOML',
      md: 'Markdown', markdown: 'Markdown', sql: 'SQL', graphql: 'GraphQL',
    };
    return map[ext] || 'Plain Text';
  }

  /** Lightweight regex tokenizer.
      Tokenises the RAW source, then HTML-escapes each token as it is emitted,
      so string/comment delimiters are matched correctly and the rendered
      output always decodes back to the exact original source text. */
  function highlight(code) {
    const source = String(code);
    if (!activeTab()) return escapeHtml(source);

    const lang = activeTab().language;
    if (lang === 'Plain Text') return escapeHtml(source);

    const tokens = [];

    const stash = (cls, text) => {
      tokens.push(`<span class="${cls}">${escapeHtml(text)}</span>`);
      return `GLINTTOKEN${tokens.length - 1}END`;
    };

    // Plain source segments are escaped as they are emitted below.

    let work = source;

    // Strings first, so comment markers such as "//" inside URLs remain strings.
    work = work.replace(/`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/g, (m) => stash('tk-string', m));

    // Line and block comments. Preserve the character before // when it is
    // needed to avoid treating URL schemes as comments.
    work = work.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*|#[^\n]*/g, (m, lead = '') => {
      if (lead && m.startsWith(lead + '//')) {
        return lead + stash('tk-comment', m.slice(lead.length));
      }
      return stash('tk-comment', m);
    });

    // Numbers.
    work = work.replace(/\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, (m) => stash('tk-number', m));

    // Keywords and constants.
    work = work.replace(/\b([A-Za-z_$][\w$]*)\b/g, (m) => {
      if (KEYWORDS.has(m)) return stash('tk-keyword', m);
      if (CONSTANTS.has(m)) return stash('tk-const', m);
      return m;
    });

    // Function calls: identifier immediately followed by an opening paren.
    work = work.replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, (m) => stash('tk-function', m));

    // Operators.
    work = work.replace(/([+\-*/%=<>!|&?:]+)/g, (m) => stash('tk-operator', m));

    // Restore stashed tokens and escape only the plain text segments.
    const parts = work.split(/GLINTTOKEN(\d+)END/);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) out += tokens[Number(parts[i])];
      else out += escapeHtml(parts[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Editor rendering                                                    */
  /* ------------------------------------------------------------------ */

  function renderEditor() {
    const tab = activeTab();

    if (!tab) {
      el.highlightCode.innerHTML = '';
      el.gutter.innerHTML = '';
      el.placeholder.style.display = 'flex';
      el.cursorLine.style.display = 'none';
      el.statusLeft.textContent = state.workspace ? state.workspace.path : 'Ready';
      el.statusPos.textContent = 'Ln 1, Col 1';
      el.statusLang.textContent = 'Plain Text';
      renderTabs();
      return;
    }

    el.placeholder.style.display = 'none';

    // Keep the textarea's value in sync without losing the caret.
    if (el.editorInput.value !== tab.content) {
      const pos = el.editorInput.selectionStart;
      el.editorInput.value = tab.content;
      try {
        el.editorInput.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    }

    const code = tab.content;
    el.highlightCode.innerHTML = highlight(code) + '\n';

    // Gutter
    const lines = code.split('\n').length;
    const activeLine = lineOf(el.editorInput.selectionStart, code);
    let gutter = '';
    for (let i = 1; i <= lines; i++) {
      gutter += `<span class="ln${i === activeLine ? ' active-ln' : ''}">${i}</span>`;
    }
    el.gutter.innerHTML = gutter;

    // Cursor line
    const lineHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) * 1.55;
    const lineTop = 14 + (activeLine - 1) * lineHeight;
    el.cursorLine.style.display = 'block';
    el.cursorLine.style.top = `${lineTop}px`;

    el.statusLang.textContent = tab.language;
    el.statusLeft.textContent = tab.dirty ? `Modified: ${tab.name}` : tab.name;
    el.statusLeft.style.color = tab.dirty ? 'var(--accent)' : '';

    syncScroll();
    renderTabs();
    updateStatusPosition();
  }

  function lineOf(index, code) {
    let line = 1;
    for (let i = 0; i < index && i < code.length; i++) {
      if (code[i] === '\n') line++;
    }
    return line;
  }

  function columnOf(index, code) {
    const lastNl = code.lastIndexOf('\n', index - 1);
    return index - lastNl;
  }

  function updateStatusPosition() {
    const tab = activeTab();
    if (!tab) return;
    const pos = el.editorInput.selectionStart;
    const line = lineOf(pos, tab.content);
    const col = columnOf(pos, tab.content);
    el.statusPos.textContent = `Ln ${line}, Col ${col}`;
  }

  function syncScroll() {
    el.gutter.scrollTop = el.codeWrap.scrollTop;
    el.gutter.style.transform = `translateY(${-el.codeWrap.scrollTop}px)`;
    const lineHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) * 1.55;
    const activeLine = lineOf(el.editorInput.selectionStart, activeTab() ? activeTab().content : '');
    el.cursorLine.style.top = `${14 + (activeLine - 1) * lineHeight - el.codeWrap.scrollTop}px`;
    el.cursorLine.style.left = `-${el.codeWrap.scrollLeft}px`;
    el.cursorLine.style.right = '0px';
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  function renderTabs() {
    el.tabbar.innerHTML = '';
    if (!state.tabs.length) {
      el.tabbar.innerHTML = '<div class="tab-empty">No editor open</div>';
      return;
    }
    state.tabs.forEach((tab, i) => {
      const div = document.createElement('div');
      div.className = 'tab' + (i === state.activeIndex ? ' active' : '');
      div.innerHTML =
        `<span class="tab-name">${escapeHtml(tab.name)}</span>` +
        (tab.dirty ? '<span class="dirty">●</span>' : '') +
        '<button class="tab-close" title="Close">✕</button>';
      div.querySelector('.tab-close').onclick = (e) => {
        e.stopPropagation();
        closeTab(i);
      };
      div.onclick = () => selectTab(i);
      el.tabbar.appendChild(div);
    });
  }

  function selectTab(index) {
    if (index < 0 || index >= state.tabs.length) return;
    state.activeIndex = index;
    renderEditor();
    el.editorInput.focus();
  }

  function closeTab(index) {
    const tab = state.tabs[index];
    if (tab && tab.dirty) {
      const choice = window.confirm(`Save changes to ${tab.name} before closing?`);
      if (choice) {
        // Proceed with save then close.
        saveActiveFile().then(() => {
          state.tabs.splice(index, 1);
          if (state.activeIndex >= state.tabs.length) state.activeIndex = state.tabs.length - 1;
          renderEditor();
        });
        return;
      }
    }
    state.tabs.splice(index, 1);
    if (state.activeIndex >= state.tabs.length) state.activeIndex = state.tabs.length - 1;
    if (state.activeIndex < 0) state.activeIndex = -1;
    renderEditor();
  }

  async function openFileAtPath(filePath, name, content) {
    const existing = state.tabs.findIndex((t) => t.path === filePath);
    if (existing >= 0) {
      selectTab(existing);
      return;
    }
    let text = content;
    if (text === undefined) {
      const result = await api.readFile(filePath);
      if (!result.ok) {
        toast(`Could not read ${name}: ${result.error}`, true);
        return;
      }
      text = result.content;
    }
    state.tabs.push({
      path: filePath,
      name,
      content: text,
      dirty: false,
      language: detectLanguage(name),
    });
    if (filePath) await api.watchFile(filePath);
    state.activeIndex = state.tabs.length - 1;
    renderEditor();
    el.editorInput.focus();
  }

  async function saveActiveFile() {
    const tab = activeTab();
    if (!tab) return false;
    if (!tab.path) {
      // Untitled: force Save As.
      return saveActiveFileAs();
    }
    const result = await api.writeFile(tab.path, el.editorInput.value);
    if (!result.ok) {
      toast(`Save failed: ${result.error}`, true);
      return false;
    }
    tab.content = el.editorInput.value;
    tab.dirty = false;
    renderEditor();
    toast(`Saved ${tab.name}`);
    return true;
  }

  async function saveActiveFileAs() {
    const tab = activeTab();
    if (!tab) return false;
    const result = await api.saveFileAs(tab.name, el.editorInput.value);
    if (result.cancelled) return false;
    if (!result.ok) {
      toast(`Save failed: ${result.error}`, true);
      return false;
    }
    tab.path = result.path;
    tab.name = result.name;
    tab.language = detectLanguage(result.name);
    tab.content = el.editorInput.value;
    tab.dirty = false;
    renderEditor();
    toast(`Saved ${result.name}`);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* File tree                                                           */
  /* ------------------------------------------------------------------ */

  function renderSidebar() {
    el.sidebarBody.innerHTML = '';

    if (!state.workspace) {
      const recent = state.recent || [];
      const div = document.createElement('div');
      div.className = 'empty-side';
      div.innerHTML = '<div class="big">📂</div><div>No folder open</div>';
      const btn = document.createElement('button');
      btn.textContent = 'Open Folder';
      btn.onclick = openFolder;
      div.appendChild(btn);

      if (recent.length) {
        const label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = 'Recent';
        el.sidebarBody.appendChild(label);
      }
      el.sidebarBody.appendChild(div);

      if (recent.length) {
        recent.forEach((p) => {
          const item = document.createElement('div');
          item.className = 'recent-item';
          const parts = p.split('/');
          item.innerHTML = `<span>🕐</span><span class="path">${escapeHtml(p.replace(/\/[^/]*$/, ''))}</span><span>${escapeHtml(parts[parts.length - 1])}</span>`;
          item.title = p;
          item.onclick = () => openFolderByPath(p);
          el.sidebarBody.appendChild(item);
        });
      }
      return;
    }

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = state.workspace.name;
    el.sidebarBody.appendChild(label);

    renderTreeNodes(state.workspace.tree || [], el.sidebarBody, 0);
  }

  function renderTreeNodes(nodes, container, depth) {
    nodes.forEach((node) => {
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.style.paddingLeft = `${10 + depth * 13}px`;

      const isOpen = state.expanded.has(node.path);
      const chevron = node.type === 'directory'
        ? `<span class="chevron${isOpen ? ' open' : ''}">›</span>`
        : '<span class="chevron leaf">›</span>';

      const active = activeTab() && activeTab().path === node.path;
      if (active) row.classList.add('active');

      const icon = node.type === 'directory' ? '📁' : fileIcon(node.name);
      const size = node.type === 'file' && node.size ? `<span class="size">${formatSize(node.size)}</span>` : '';

      row.innerHTML = `${chevron}<span class="ico${node.type === 'directory' ? ' dir' : ''}">${icon}</span><span class="name">${escapeHtml(node.name)}</span>${size}`;
      row.title = node.path;

      row.onclick = (e) => {
        if (node.type === 'directory') {
          e.stopPropagation();
          if (state.expanded.has(node.path)) state.expanded.delete(node.path);
          else state.expanded.add(node.path);
          renderSidebar();
        } else {
          openFileAtPath(node.path, node.name);
        }
      };

      container.appendChild(row);

      if (node.type === 'directory' && isOpen) {
        renderTreeNodes(node.children || [], container, depth + 1);
      }
    });
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return '🟨';
    if (['json', 'jsonc'].includes(ext)) return '🟩';
    if (['html', 'htm', 'xml', 'svg'].includes(ext)) return '🟧';
    if (['css', 'scss', 'sass', 'less'].includes(ext)) return '🟦';
    if (['md', 'markdown', 'txt'].includes(ext)) return '📄';
    if (['py'].includes(ext)) return '🐍';
    if (['sh', 'bash', 'zsh'].includes(ext)) return '🐚';
    if (['yml', 'yaml', 'toml'].includes(ext)) return '⚙️';
    return '📄';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  }

  async function openFolderByPath(dirPath) {
    const tree = await api.getTree(dirPath);
    const parts = dirPath.split('/');
    state.workspace = { path: dirPath, name: parts[parts.length - 1] || dirPath, tree };
    state.expanded = new Set([dirPath]);
    el.workspaceName.textContent = `— ${state.workspace.name}`;
    renderSidebar();
    renderEditor();
    toast(`Opened ${state.workspace.name}`);
  }

  async function openFolder() {
    const payload = await api.openFolder();
    if (!payload) return;
    state.workspace = { path: payload.path, name: payload.name, tree: payload.tree };
    state.recent = payload.recent || [];
    state.expanded = new Set([payload.path]);
    el.workspaceName.textContent = `— ${payload.name}`;
    renderSidebar();
    renderEditor();
    toast(`Opened ${payload.name}`);
  }

  /* ------------------------------------------------------------------ */
  /* Find & replace                                                       */
  /* ------------------------------------------------------------------ */

  function toggleFindBar(show, replace = false) {
    const open = show === undefined ? !el.findbar.classList.contains('open') : show;
    el.findbar.classList.toggle('open', open);
    if (open) {
      if (replace) state.replaceMode = true;
      el.replaceInput.style.display = state.replaceMode ? '' : 'none';
      $('replaceOne').style.display = state.replaceMode ? '' : 'none';
      $('replaceAll').style.display = state.replaceMode ? '' : 'none';
      el.findInput.focus();
      el.findInput.select();
      runFind();
    } else {
      state.findMatches = [];
      state.findIndex = -1;
      el.matchCount.textContent = '0 results';
      clearFindHighlights();
      el.editorInput.focus();
    }
  }

  function clearFindHighlights() {
    el.highlightCode.innerHTML = highlight(activeTab() ? activeTab().content : '') + '\n';
  }

  function runFind() {
    const term = el.findInput.value;
    state.findMatches = [];
    state.findIndex = -1;
    clearFindHighlights();
    if (!term) {
      el.matchCount.textContent = '0 results';
      return;
    }
    const tab = activeTab();
    if (!tab) return;

    const content = el.editorInput.value;
    const lower = content.toLowerCase();
    const needle = term.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      state.findMatches.push({ start: idx, end: idx + term.length });
      idx = lower.indexOf(needle, idx + term.length);
    }

    el.matchCount.textContent = `${state.findMatches.length} result${state.findMatches.length === 1 ? '' : 's'}`;

    if (state.findMatches.length) {
      // Highlight all occurrences in the rendered code layer.
      const escaped = escapeHtml(content);
      let result = '';
      let cursor = 0;
      state.findMatches.forEach((m, i) => {
        result += escaped.slice(cursor, m.start);
        result += `<span class="find-highlight${i === 0 ? ' current' : ''}">${escaped.slice(m.start, m.end)}</span>`;
        cursor = m.end;
      });
      result += escaped.slice(cursor);
      el.highlightCode.innerHTML = result + '\n';
      state.findIndex = 0;
    }
  }

  function findNext(dir = 1) {
    if (!state.findMatches.length) return;
    state.findIndex = (state.findIndex + dir + state.findMatches.length) % state.findMatches.length;
    const m = state.findMatches[state.findIndex];
    el.editorInput.focus();
    el.editorInput.setSelectionRange(m.start, m.end);
    el.matchCount.textContent = `${state.findIndex + 1} of ${state.findMatches.length}`;
    runFindAndMove();
  }

  function runFindAndMove() {
    const term = el.findInput.value;
    if (!term || !activeTab()) return;
    const content = el.editorInput.value;
    const lower = content.toLowerCase();
    const needle = term.toLowerCase();
    const matches = [];
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      matches.push({ start: idx, end: idx + term.length });
      idx = lower.indexOf(needle, idx + term.length);
    }
    state.findMatches = matches;
    const escaped = escapeHtml(content);
    let result = '';
    let cursor = 0;
    matches.forEach((m, i) => {
      result += escaped.slice(cursor, m.start);
      result += `<span class="find-highlight${i === state.findIndex ? ' current' : ''}">${escaped.slice(m.start, m.end)}</span>`;
      cursor = m.end;
    });
    result += escaped.slice(cursor);
    el.highlightCode.innerHTML = result + '\n';
  }

  function replaceCurrent() {
    const term = el.findInput.value;
    if (!term || !state.findMatches.length) return;
    const m = state.findMatches[state.findIndex];
    if (!m) return;
    const content = el.editorInput.value;
    const next = content.slice(0, m.start) + el.replaceInput.value + content.slice(m.end);
    setEditorValue(next);
    runFind();
    findNext(0);
  }

  function replaceAll() {
    const term = el.findInput.value;
    if (!term || !activeTab()) return;
    const content = el.editorInput.value;
    const count = state.findMatches.length;
    const next = content.split(term).join(el.replaceInput.value);
    setEditorValue(next);
    runFind();
    toast(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
  }

  function setEditorValue(value) {
    const tab = activeTab();
    if (!tab) return;
    el.editorInput.value = value;
    tab.content = value;
    tab.dirty = true;
    renderEditor();
  }

  /* ------------------------------------------------------------------ */
  /* Command palette                                                     */
  /* ------------------------------------------------------------------ */

  const COMMANDS = [
    { id: 'file.open-folder', label: 'File: Open Folder…', icon: '📂', cmd: '⌘O', run: openFolder },
    { id: 'file.open-file', label: 'File: Open File…', icon: '📄', cmd: '⇧⌘O', run: openFile },
    { id: 'file.save', label: 'File: Save', icon: '💾', cmd: '⌘S', run: saveActiveFile },
    { id: 'file.save-as', label: 'File: Save As…', icon: '💾', cmd: '⇧⌘S', run: saveActiveFileAs },
    { id: 'view.sidebar', label: 'View: Toggle Sidebar', icon: '◧', cmd: '⌘B', run: toggleSidebar },
    { id: 'view.find', label: 'Edit: Find', icon: '🔍', cmd: '⌘F', run: () => toggleFindBar(true) },
    { id: 'view.replace', label: 'Edit: Replace', icon: '🔄', cmd: '⇧⌘F', run: () => toggleFindBar(true, true) },
    { id: 'view.settings', label: 'Preferences: Customise Colours…', icon: '🎨', cmd: '⇧⌘K', run: openSettings },
    { id: 'theme.dark', label: 'Theme: Glint Dark', icon: '🌙', run: () => applyTheme('glint-dark') },
    { id: 'theme.light', label: 'Theme: Glint Light', icon: '☀️', run: () => applyTheme('glint-light') },
    { id: 'theme.ocean', label: 'Theme: Ocean', icon: '🌊', run: () => applyTheme('ocean') },
    { id: 'theme.solarized', label: 'Theme: Solarized', icon: '🌅', run: () => applyTheme('solarized') },
    { id: 'theme.midnight', label: 'Theme: Midnight', icon: '🌌', run: () => applyTheme('midnight') },
    { id: 'help.github', label: 'Help: Glint on GitHub', icon: '⭐', run: () => window.open('https://github.com/mailsitnc-ai/glint') },
  ];

  async function applyTheme(theme) {
    const t = THEMES[theme];
    if (!t) return;
    const patch = { theme, bg: t.bg, text: t.text, muted: t.muted, accent: t.accent };
    state.settings = { ...state.settings, ...patch };
    applySettings();
    await api.setSettings(patch);
    renderThemeSwatches();
    toast(`${t.label} applied`);
  }

  function openPalette() {
    el.paletteOverlay.classList.add('open');
    el.paletteInput.value = '';
    el.paletteIndex = 0;
    filterPalette('');
    setTimeout(() => el.paletteInput.focus(), 30);
  }

  function closePalette() {
    el.paletteOverlay.classList.remove('open');
  }

  function filterPalette(query) {
    const q = query.trim().toLowerCase();
    state.paletteItems = q
      ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q))
      : COMMANDS.slice();
    state.paletteIndex = 0;
    renderPalette();
  }

  function renderPalette() {
    if (!state.paletteItems.length) {
      el.paletteList.innerHTML = '<div class="palette-empty">No matching commands</div>';
      return;
    }
    el.paletteList.innerHTML = '';
    state.paletteItems.forEach((cmd, i) => {
      const div = document.createElement('div');
      div.className = 'palette-item' + (i === state.paletteIndex ? ' selected' : '');
      div.innerHTML = `<span class="ico">${cmd.icon || '›'}</span><span>${escapeHtml(cmd.label)}</span>${cmd.cmd ? `<span class="cmd">${cmd.cmd}</span>` : ''}`;
      div.onclick = () => {
        closePalette();
        cmd.run();
      };
      el.paletteList.appendChild(div);
    });
  }

  function runSelectedPaletteItem() {
    const cmd = state.paletteItems[state.paletteIndex];
    if (!cmd) return;
    closePalette();
    cmd.run();
  }

  /* ------------------------------------------------------------------ */
  /* Settings panel                                                      */
  /* ------------------------------------------------------------------ */

  function openSettings() {
    el.settingsPanel.classList.add('open');
    renderThemeSwatches();
  }

  function closeSettings() {
    el.settingsPanel.classList.remove('open');
  }

  async function saveSettingsFromForm() {
    const patch = {
      accent: $('cAccent').value,
      bg: $('cBg').value,
      text: $('cText').value,
      muted: $('cMuted').value,
      glassBlur: Number($('rBlur').value),
      glassOpacity: Number($('rOpacity').value),
      fontSize: Number($('nFontSize').value),
      fontFamily: $('sFontFamily').value,
      tabSize: Number($('nTabSize').value),
      liquidGlass: $('tGlass').classList.contains('on'),
      wordWrap: $('tWrap').classList.contains('on'),
    };
    state.settings = { ...state.settings, ...patch };
    applySettings();
    await api.setSettings(patch);
    renderThemeSwatches();
    toast('Settings saved');
    closeSettings();
  }

  /* ------------------------------------------------------------------ */
  /* Layout helpers                                                      */
  /* ------------------------------------------------------------------ */

  function toggleSidebar() {
    el.sidebar.classList.toggle('collapsed');
  }

  async function openFile() {
    const payload = await api.openFile();
    if (!payload) return;
    await openFileAtPath(payload.path, payload.name, payload.content);
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */

  // Editor input
  el.editorInput.addEventListener('input', () => {
    const tab = activeTab();
    if (!tab) return;
    tab.content = el.editorInput.value;
    tab.dirty = true;
    renderEditor();
  });

  el.editorInput.addEventListener('keyup', updateStatusPosition);
  el.editorInput.addEventListener('click', updateStatusPosition);
  el.editorInput.addEventListener('select', updateStatusPosition);

  // Keyboard handling inside the editor
  el.editorInput.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) saveActiveFileAs();
      else saveActiveFile();
      return;
    }

    if (meta && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      toggleFindBar(true, e.shiftKey);
      return;
    }

    if (meta && e.key.toLowerCase() === 'p' && e.shiftKey) {
      e.preventDefault();
      openPalette();
      return;
    }

    if (e.key === 'Escape') {
      if (el.findbar.classList.contains('open')) {
        toggleFindBar(false);
        return;
      }
    }

    // Tab key inserts spaces (indent) instead of leaving the editor.
    if (e.key === 'Tab' && !meta) {
      e.preventDefault();
      const start = el.editorInput.selectionStart;
      const end = el.editorInput.selectionEnd;
      const indent = ' '.repeat(state.settings.tabSize);
      const value = el.editorInput.value;
      const next = value.slice(0, start) + indent + value.slice(end);
      el.editorInput.value = next;
      el.editorInput.setSelectionRange(start + indent.length, start + indent.length);
      const tab = activeTab();
      if (tab) {
        tab.content = next;
        tab.dirty = true;
      }
      renderEditor();
    }
  });

  // Scrolling keeps gutter + cursor line aligned
  el.codeWrap.addEventListener('scroll', syncScroll);

  // Find bar
  el.findInput.addEventListener('input', runFind);
  el.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findNext(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleFindBar(false);
    }
  });
  $('findNext').onclick = () => findNext(1);
  $('findPrev').onclick = () => findNext(-1);
  $('findClose').onclick = () => toggleFindBar(false);
  $('findReplaceToggle').onclick = () => {
    state.replaceMode = !state.replaceMode;
    el.replaceInput.style.display = state.replaceMode ? '' : 'none';
    $('replaceOne').style.display = state.replaceMode ? '' : 'none';
    $('replaceAll').style.display = state.replaceMode ? '' : 'none';
    if (state.replaceMode) el.replaceInput.focus();
  };
  $('replaceOne').onclick = replaceCurrent;
  $('replaceAll').onclick = replaceAll;

  // Palette
  el.paletteInput.addEventListener('input', (e) => filterPalette(e.target.value));
  el.paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.paletteIndex = Math.min(state.paletteIndex + 1, state.paletteItems.length - 1);
      renderPalette();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.paletteIndex = Math.max(state.paletteIndex - 1, 0);
      renderPalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSelectedPaletteItem();
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });
  el.paletteOverlay.addEventListener('click', (e) => {
    if (e.target === el.paletteOverlay) closePalette();
  });

  // Toolbar buttons
  $('btnOpenFolder').onclick = openFolder;
  $('btnPalette').onclick = openPalette;
  $('btnSettings').onclick = openSettings;
  $('btnToggleSidebar').onclick = toggleSidebar;
  $('btnMinimize').onclick = () => api.minimize();
  $('btnMaximize').onclick = () => api.toggleMaximize();
  $('btnClose').onclick = () => api.close();
  api.onFileChanged(async (filePath) => {
    const index = state.tabs.findIndex((tab) => tab.path === filePath);
    if (index < 0) return;
    if (!state.tabs[index].dirty) {
      const result = await api.readFile(filePath);
      if (result.ok) {
        state.tabs[index].content = result.content;
        if (index === state.activeIndex) renderEditor();
        toast(`Reloaded ${state.tabs[index].name}`);
      }
    } else {
      toast(`${state.tabs[index].name} changed on disk`);
    }
  });
  $('btnRefreshTree').onclick = async () => {
    if (!state.workspace) return;
    const tree = await api.getTree(state.workspace.path);
    state.workspace.tree = tree;
    renderSidebar();
    toast('Refreshed');
  };

  // Settings panel
  $('settingsClose').onclick = closeSettings;
  $('btnSaveSettings').onclick = saveSettingsFromForm;
  $('btnResetSettings').onclick = async () => {
    const fresh = await api.resetSettings();
    state.settings = { ...state.settings, ...fresh };
    applySettings();
    renderThemeSwatches();
    toast('Reset to defaults');
  };
  $('tGlass').onclick = () => {
    $('tGlass').classList.toggle('on');
    applySettings();
  };
  $('tWrap').onclick = () => {
    $('tWrap').classList.toggle('on');
    applySettings();
  };
  ['cAccent', 'cBg', 'cText', 'cMuted'].forEach((id) => {
    $(id).addEventListener('input', () => {
      state.settings = {
        ...state.settings,
        accent: $('cAccent').value,
        bg: $('cBg').value,
        text: $('cText').value,
        muted: $('cMuted').value,
      };
      applySettings();
    });
  });
  ['rBlur', 'rOpacity', 'nFontSize', 'nTabSize'].forEach((id) => {
    $(id).addEventListener('input', () => {
      state.settings = {
        ...state.settings,
        glassBlur: Number($('rBlur').value),
        glassOpacity: Number($('rOpacity').value),
        fontSize: Number($('nFontSize').value),
        tabSize: Number($('nTabSize').value),
      };
      applySettings();
    });
  });
  $('sFontFamily').addEventListener('change', () => {
    state.settings = { ...state.settings, fontFamily: $('sFontFamily').value };
    applySettings();
  });

  // Menu commands coming from the main process
  api.onMenuCommand((command) => {
    switch (command) {
      case 'save': saveActiveFile(); break;
      case 'save-as': saveActiveFileAs(); break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'copy': document.execCommand('copy'); break;
      case 'paste': document.execCommand('paste'); break;
      case 'select-all': el.editorInput.select(); break;
      case 'find': toggleFindBar(true); break;
      case 'replace': toggleFindBar(true, true); break;
      case 'command-palette': openPalette(); break;
      case 'toggle-sidebar': toggleSidebar(); break;
      case 'toggle-panel': toggleSidebar(); break;
      case 'settings': openSettings(); break;
      default: break;
    }
  });

  // Events pushed from main
  api.onWorkspaceOpened((payload) => {
    state.workspace = { path: payload.path, name: payload.name, tree: payload.tree };
    state.recent = payload.recent || [];
    state.expanded = new Set([payload.path]);
    el.workspaceName.textContent = `— ${payload.name}`;
    renderSidebar();
    renderEditor();
  });

  api.onFileOpened(async (payload) => {
    await openFileAtPath(payload.path, payload.name, payload.content);
  });

  api.onSettingsChanged((settings) => {
    state.settings = { ...state.settings, ...settings };
    applySettings();
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function boot() {
    try {
      const settings = await api.getSettings();
      state.settings = { ...state.settings, ...settings };
    } catch (err) {
      console.error('[glint] failed to load settings', err);
    }

    applySettings();
    renderThemeSwatches();
    renderSidebar();
    renderTabs();

    try {
      state.recent = await api.getRecent();
      if (state.recent && state.recent.length) renderSidebar();
    } catch (err) {
      console.error('[glint] failed to load recent', err);
    }

    console.log('[glint] renderer booted');
  }

  boot();
})();
