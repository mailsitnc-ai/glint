/* ==========================================================================
   Editor core: virtual scrolling, syntax highlighting, tabs, buffer state.
   ========================================================================== */

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','break','continue','new','class','extends','super',
  'this','typeof','instanceof','in','of','delete','void','null','undefined','true','false','async','await','yield','try','catch',
  'finally','throw','switch','case','default','import','export','from','as','static','get','set','interface','type','enum','implements',
  'public','private','protected','readonly','abstract','declare','namespace','module','require','exports','def','lambda','pass',
  'elif','None','True','False','self','and','or','not','is','global','nonlocal','with','raise','print','func','pub','mut','impl',
  'package','struct','trait','fn','match','use','mut','ref','where','move','dyn','crate','super','unsafe','async','move',
  'SELECT','FROM','WHERE','INSERT','UPDATE','DELETE','JOIN','GROUP','ORDER','HAVING','LIMIT','VALUES','SET','INTO','TABLE',
]);

const CONSTANTS = new Set([
  'true','false','null','undefined','NaN','Infinity','None','True','False','self','this','SELECT','FROM','WHERE',
]);

const LANGUAGE_BY_EXT = {
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

export function detectLanguage(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return LANGUAGE_BY_EXT[ext] || 'Plain Text';
}

export function escapeHtml(s) {
  const amp = String.fromCharCode(38);
  return String(s)
    .replace(/&/g, amp + 'amp;')
    .replace(/</g, amp + 'lt;')
    .replace(/>/g, amp + 'gt;')
    .replace(/"/g, amp + 'quot;')
    .replace(/'/g, amp + '#39;');
}

/**
 * Single-pass tokenizer. Operates on raw source and escapes each token as it
 * is emitted, so the rendered output always decodes back to the exact source.
 */
export function highlight(code, language = 'JavaScript') {
  const source = String(code);
  if (language === 'Plain Text') return escapeHtml(source);

  const tokenPattern =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|<[A-Za-z][\w:-]*|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_$][\w$]*\b|[+\-*/%=<>!|&?:]+/g;

  let result = '';
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(source)) !== null) {
    result += escapeHtml(source.slice(cursor, match.index));
    const token = match[0];
    let cls = '';

    if (token.startsWith('//') || token.startsWith('/*') || token.startsWith('#')) {
      cls = 'tk-comment';
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      cls = 'tk-string';
    } else if (token.startsWith('<')) {
      cls = 'tk-tag';
    } else if (/^\d/.test(token)) {
      cls = 'tk-number';
    } else if (KEYWORDS.has(token)) {
      cls = CONSTANTS.has(token) ? 'tk-const' : 'tk-keyword';
    } else if (/^[A-Za-z_$]/.test(token)) {
      const after = source.slice(match.index + token.length);
      if (/^\s*\(/.test(after)) cls = 'tk-function';
    } else {
      cls = 'tk-operator';
    }

    const safe = escapeHtml(token);
    result += cls ? `<span class="${cls}">${safe}</span>` : safe;
    cursor = match.index + token.length;
  }

  result += escapeHtml(source.slice(cursor));
  return result;
}

/**
 * Editor engine.
 *
 * Virtual scrolling: for very large files only the visible window of lines is
 * rendered into the DOM, keeping interaction fast regardless of file size.
 */
export class EditorEngine {
  constructor(dom, options = {}) {
    this.dom = dom;
    this.onChange = options.onChange || (() => {});
    this.onCursor = options.onCursor || (() => {});
    this.onSave = options.onSave || (() => {});
    this.settings = {
      virtualScroll: true,
      virtualScrollThreshold: 5000,
      fontSize: 14,
      fontLineHeight: 1.55,
      tabSize: 2,
      wordWrap: false,
      ...options.settings,
    };

    this.tabs = [];
    this.activeIndex = -1;
    this.findMatches = [];
    this.findIndex = -1;
    this.ghostText = null;
    this.remoteCursors = new Map();

    this.bindEvents();
  }

  /* ------------------------------------------------------------------ */
  /* Accessors                                                            */
  /* ------------------------------------------------------------------ */

  get activeTab() {
    return this.activeIndex >= 0 ? this.tabs[this.activeIndex] : null;
  }

  get lines() {
    const tab = this.activeTab;
    if (!tab) return [''];
    if (!tab._lines) tab._lines = tab.content.split('\n');
    return tab._lines;
  }

  setSettings(settings) {
    Object.assign(this.settings, settings);
    this.render();
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                 */
  /* ------------------------------------------------------------------ */

  openTab(tab) {
    const existing = this.tabs.findIndex((t) => t.path === tab.path);
    if (existing >= 0) {
      this.selectTab(existing);
      return existing;
    }
    this.tabs.push({
      path: tab.path,
      name: tab.name,
      content: tab.content ?? '',
      dirty: false,
      language: tab.language || detectLanguage(tab.name),
      _lines: null,
    });
    this.selectTab(this.tabs.length - 1);
    return this.tabs.length - 1;
  }

  selectTab(index) {
    if (index < 0 || index >= this.tabs.length) return;
    this.activeIndex = index;
    this.render();
    this.dom.input.focus();
  }

  closeTab(index) {
    const tab = this.tabs[index];
    if (tab?.dirty) {
      const choice = window.confirm(`Save changes to ${tab.name} before closing?`);
      if (choice) {
        this.onSave(tab, true);
        this.removeTab(index);
        return;
      }
    }
    this.removeTab(index);
  }

  removeTab(index) {
    this.tabs.splice(index, 1);
    if (this.activeIndex >= this.tabs.length) this.activeIndex = this.tabs.length - 1;
    if (this.activeIndex < 0) this.activeIndex = -1;
    this.render();
  }

  getContent() {
    return this.dom.input.value;
  }

  setContent(value) {
    const tab = this.activeTab;
    if (!tab) return;
    this.dom.input.value = value;
    tab.content = value;
    tab._lines = null;
    tab.dirty = true;
    this.render();
  }

  markSaved() {
    const tab = this.activeTab;
    if (!tab) return;
    tab.content = this.dom.input.value;
    tab.dirty = false;
    this.render();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                            */
  /* ------------------------------------------------------------------ */

  render() {
    this.renderTabs();
    this.renderEditor();
  }

  renderTabs() {
    const bar = this.dom.tabbar;
    bar.innerHTML = '';
    if (!this.tabs.length) {
      bar.innerHTML = '<div class="tab-empty">No editor open</div>';
      return;
    }
    this.tabs.forEach((tab, i) => {
      const div = document.createElement('div');
      div.className = 'tab' + (i === this.activeIndex ? ' active' : '');
      div.innerHTML =
        `<span class="tab-name">${escapeHtml(tab.name)}</span>` +
        (tab.dirty ? '<span class="dirty">●</span>' : '') +
        '<button class="tab-close" title="Close">✕</button>';
      div.querySelector('.tab-close').onclick = (e) => {
        e.stopPropagation();
        this.closeTab(i);
      };
      div.onclick = () => this.selectTab(i);
      bar.appendChild(div);
    });
  }

  renderEditor() {
    const tab = this.activeTab;
    const { gutter, codeLayer, input, placeholder, cursorLine } = this.dom;

    if (!tab) {
      codeLayer.innerHTML = '';
      gutter.innerHTML = '';
      placeholder.style.display = 'flex';
      cursorLine.style.display = 'none';
      this.dom.statusLeft.textContent = 'Ready';
      this.dom.statusPos.textContent = 'Ln 1, Col 1';
      this.dom.statusLang.textContent = 'Plain Text';
      return;
    }

    placeholder.style.display = 'none';

    // Keep the textarea value in sync without disturbing the caret.
    if (input.value !== tab.content) {
      const pos = input.selectionStart;
      input.value = tab.content;
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    }

    const lineCount = this.lines.length;
    const useVirtual =
      this.settings.virtualScroll && lineCount > this.settings.virtualScrollThreshold;

    if (useVirtual) {
      this.renderVirtualWindow();
    } else {
      this.renderAllLines();
    }

    this.updateCursorLine();
    this.updateStatus();
    this.renderGhostText();
  }

  /** Render every line (normal files). */
  renderAllLines() {
    const tab = this.activeTab;
    const lines = this.lines;
    const html = lines.map((line) => highlight(line, tab.language)).join('\n');
    this.dom.codeLayer.innerHTML = html;
    this.dom.codeLayer.dataset.virtual = 'false';
    this.renderGutter(1, lines.length);
  }

  /**
   * Render only the visible slice of lines for very large files.
   * A spacer above and below keeps the scrollbar honest.
   */
  renderVirtualWindow() {
    const tab = this.activeTab;
    const lines = this.lines;
    const total = lines.length;

    const viewportHeight = this.dom.codeWrap.clientHeight || 600;
    const lineHeight = this.lineHeight();
    const visibleCount = Math.ceil(viewportHeight / lineHeight) + 4;
    const scrollTop = this.dom.codeWrap.scrollTop;

    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - 2);
    const end = Math.min(total, start + visibleCount);

    const slice = lines.slice(start, end);
    const html = slice.map((line) => highlight(line, tab.language)).join('\n');

    const topPad = start * lineHeight;
    const bottomPad = Math.max(0, (total - end) * lineHeight);

    this.dom.codeLayer.innerHTML = html;
    this.dom.codeLayer.dataset.virtual = 'true';
    this.dom.codeLayer.style.paddingTop = `${14 + topPad}px`;
    this.dom.codeLayer.style.paddingBottom = `${14 + bottomPad}px`;

    this.renderGutter(start + 1, end, start);
  }

  renderGutter(start, end, offset = 0) {
    let html = '';
    for (let i = start; i <= end; i++) {
      const active = i === this.currentLineNumber();
      html += `<span class="ln${active ? ' active-ln' : ''}">${i}</span>`;
    }
    this.dom.gutter.innerHTML = html;
    this.dom.gutter.dataset.offset = String(offset);
  }

  lineHeight() {
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 14;
    const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-line-height')) || 1.55;
    return size * ratio;
  }

  currentLineNumber() {
    const tab = this.activeTab;
    if (!tab) return 1;
    return this.lineNumberAt(this.dom.input.selectionStart);
  }

  lineNumberAt(index) {
    const tab = this.activeTab;
    if (!tab) return 1;
    const before = tab.content.slice(0, index);
    let line = 1;
    for (let i = 0; i < before.length; i++) if (before[i] === '\n') line++;
    return line;
  }

  columnAt(index) {
    const tab = this.activeTab;
    if (!tab) return 1;
    const lastNl = tab.content.lastIndexOf('\n', index - 1);
    return index - lastNl;
  }

  updateCursorLine() {
    const tab = this.activeTab;
    const { cursorLine, codeWrap } = this.dom;
    if (!tab) {
      cursorLine.style.display = 'none';
      return;
    }
    const line = this.currentLineNumber();
    const lineHeight = this.lineHeight();
    const top = 14 + (line - 1) * lineHeight - codeWrap.scrollTop;
    cursorLine.style.display = 'block';
    cursorLine.style.top = `${top}px`;
    cursorLine.style.height = `${lineHeight}px`;
  }

  updateStatus() {
    const tab = this.activeTab;
    if (!tab) return;
    const pos = this.dom.input.selectionStart;
    this.dom.statusPos.textContent = `Ln ${this.lineNumberAt(pos)}, Col ${this.columnAt(pos)}`;
    this.dom.statusLang.textContent = tab.language;
    this.dom.statusLeft.textContent = tab.dirty ? `Modified: ${tab.name}` : tab.name;
    this.dom.statusLeft.style.color = tab.dirty ? 'var(--accent)' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Ghost text (AI inline completion)                                     */
  /* ------------------------------------------------------------------ */

  setGhostText(text) {
    this.ghostText = text || null;
    this.renderGhostText();
  }

  renderGhostText() {
    const el = this.dom.ghostText;
    if (!el) return;
    if (!this.ghostText || !this.activeTab) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    const pos = this.dom.input.selectionStart;
    const before = this.dom.input.value.slice(0, pos);
    const linesBefore = before.split('\n');
    const line = linesBefore.length - 1;
    const column = linesBefore[linesBefore.length - 1].length;
    const lineHeight = this.lineHeight();
    const top = 14 + line * lineHeight - this.dom.codeWrap.scrollTop;
    const left = 20 + column * this.charWidth();

    el.style.display = 'block';
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.textContent = this.ghostText;
  }

  charWidth() {
    // Approximate monospace advance width.
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 14;
    return size * 0.6;
  }

  acceptGhostText() {
    if (!this.ghostText) return false;
    const pos = this.dom.input.selectionStart;
    const value = this.dom.input.value;
    const next = value.slice(0, pos) + this.ghostText + value.slice(pos);
    this.dom.input.value = next;
    this.dom.input.setSelectionRange(pos + this.ghostText.length, pos + this.ghostText.length);
    this.setGhostText(null);
    this.setContent(next);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Find and replace                                                      */
  /* ------------------------------------------------------------------ */

  find(term) {
    this.findMatches = [];
    this.findIndex = -1;
    this.findTerm = term;
    if (!term) {
      this.render();
      return [];
    }
    const content = this.dom.input.value;
    const lower = content.toLowerCase();
    const needle = term.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      this.findMatches.push({ start: idx, end: idx + term.length });
      idx = lower.indexOf(needle, idx + term.length);
    }
    this.render();
    return this.findMatches;
  }

  findNext(dir = 1) {
    if (!this.findMatches.length) return null;
    this.findIndex = (this.findIndex + dir + this.findMatches.length) % this.findMatches.length;
    const match = this.findMatches[this.findIndex];
    this.dom.input.focus();
    this.dom.input.setSelectionRange(match.start, match.end);
    this.render();
    return match;
  }

  replaceCurrent(replacement) {
    if (!this.findMatches.length) return false;
    const match = this.findMatches[this.findIndex];
    if (!match) return false;
    const value = this.dom.input.value;
    const next = value.slice(0, match.start) + replacement + value.slice(match.end);
    this.dom.input.value = next;
    this.setContent(next);
    this.find(this.findTerm || '');
    return true;
  }

  replaceAll(term, replacement) {
    if (!term) return 0;
    const count = this.findMatches.length;
    const next = this.dom.input.value.split(term).join(replacement);
    this.dom.input.value = next;
    this.setContent(next);
    this.find(term);
    return count;
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                               */
  /* ------------------------------------------------------------------ */

  bindEvents() {
    const { input, codeWrap } = this.dom;

    input.addEventListener('input', () => {
      const tab = this.activeTab;
      if (!tab) return;
      const before = tab.content;
      tab.content = input.value;
      tab._lines = null;
      tab.dirty = true;
      this.onChange(tab, before, tab.content);
      this.render();
    });

    const cursorHandler = () => {
      this.updateCursorLine();
      this.updateStatus();
      this.onCursor(this.currentLineNumber(), this.columnAt(input.selectionStart));
    };
    input.addEventListener('keyup', cursorHandler);
    input.addEventListener('click', cursorHandler);
    input.addEventListener('select', cursorHandler);

    input.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.onSave(this.activeTab, e.shiftKey);
        return;
      }
      if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.onFind(e.shiftKey);
        return;
      }
      if (meta && e.key.toLowerCase() === 'p' && e.shiftKey) {
        e.preventDefault();
        this.onPalette?.();
        return;
      }
      if (meta && e.key === 'Enter') {
        if (this.ghostText) {
          e.preventDefault();
          this.acceptGhostText();
        }
        return;
      }
      if (e.key === 'Escape' && this.ghostText) {
        this.setGhostText(null);
        return;
      }

      if (e.key === 'Tab' && !meta) {
        e.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const indent = ' '.repeat(this.settings.tabSize);
        const value = input.value;
        const next = value.slice(0, start) + indent + value.slice(end);
        input.value = next;
        input.setSelectionRange(start + indent.length, start + indent.length);
        const tab = this.activeTab;
        if (tab) {
          tab.content = next;
          tab._lines = null;
          tab.dirty = true;
        }
        this.render();
      }
    });

    codeWrap.addEventListener('scroll', () => {
      this.updateCursorLine();
      this.renderGhostText();
      // Re-render the virtual window when scrolling.
      const tab = this.activeTab;
      if (tab && this.settings.virtualScroll && this.lines.length > this.settings.virtualScrollThreshold) {
        this.renderVirtualWindow();
      }
    });
  }
}
