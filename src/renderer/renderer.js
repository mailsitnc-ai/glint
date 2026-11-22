/* ==========================================================================
   Glint renderer entry point.
   Wires the editor engine, themes, AI, collaboration, intelligence and
   workflow modules to the UI.
   ========================================================================== */

import { EditorEngine, detectLanguage, escapeHtml, highlight as highlightModule } from './modules/editor.js';
import { ThemeManager, rgba } from './modules/themes.js';
import { AIModule } from './modules/ai.js';
import { CollaborationModule } from './modules/collaboration.js';
import { IntelligenceModule } from './modules/intelligence.js';
import { WorkflowModule } from './modules/workflow.js';

const api = window.glint;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  workspace: null,
  recent: [],
  expanded: new Set(),
  activeView: 'explorer',
  activePanel: 'problems',
  bottomPanelOpen: false,
  replaceMode: false,
  paletteIndex: 0,
  paletteItems: [],
  attachContext: false,
  chatMessages: [],
  searchResults: [],
  gitStatus: null,
  selectedDeploy: 'vercel',
};

/* ------------------------------------------------------------------ */
/* DOM refs                                                            */
/* ------------------------------------------------------------------ */

const dom = {
  workspaceName: $('workspaceName'),
  sidebar: $('sidebar'),
  sidebarBody: $('sidebarBody'),
  sidebarTitle: $('sidebarTitle'),
  tabbar: $('tabbar'),
  gutter: $('gutter'),
  codeWrap: $('codeWrap'),
  codeLayer: $('highlightCode'),
  highlightCode: $('highlightCode'),
  input: $('editorInput'),
  cursorLine: $('cursorLine'),
  ghostText: $('ghostText'),
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
  modalOverlay: $('modalOverlay'),
  modalTitle: $('modalTitle'),
  modalBody: $('modalBody'),
  aiPanel: $('aiPanel'),
  chatMessages: $('chatMessages'),
  chatInput: $('chatInput'),
  settingsPanel: $('settingsPanel'),
  settingsBody: $('settingsBody'),
  marketPanel: $('marketPanel'),
  marketBody: $('marketBody'),
  bottomPanel: $('bottomPanel'),
  panelBody: $('panelBody'),
  panelToolbar: $('panelToolbar'),
  panelTabs: $('panelTabs'),
  remoteCursors: $('remoteCursors'),
  toast: $('toast'),
};

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, isError = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle('error', isError);
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2600);
}

function setActiveView(view) {
  state.activeView = view;
  document.querySelectorAll('.activitybar .act').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  const titles = {
    explorer: 'Explorer',
    search: 'Semantic Search',
    git: 'Source Control',
    collab: 'Collaboration',
    deploy: 'Deploy',
    database: 'Database',
    api: 'API Client',
    marketplace: 'Themes',
  };
  dom.sidebarTitle.textContent = titles[view] || 'Explorer';

  // The AI panel is a separate right-hand surface.
  if (view === 'ai') {
    dom.aiPanel.classList.add('open');
    dom.sidebar.classList.remove('collapsed');
    return;
  }
  dom.aiPanel.classList.remove('open');
  dom.sidebar.classList.remove('collapsed');

  renderSidebar();
}

function openModal(title, html, onMount) {
  dom.modalTitle.textContent = title;
  dom.modalBody.innerHTML = html;
  dom.modalOverlay.classList.add('open');
  if (onMount) onMount(dom.modalBody);
}

function closeModal() {
  dom.modalOverlay.classList.remove('open');
  dom.modalBody.innerHTML = '';
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

const themeManager = new ThemeManager(api, (settings) => {
  dom.statusTheme.textContent = themeLabel(settings.theme);
  dom.statusIndent.textContent = `Spaces: ${settings.tabSize}`;
  editor.setSettings({
    fontSize: settings.fontSize,
    fontLineHeight: settings.fontLineHeight,
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap,
    virtualScroll: settings.virtualScroll,
    virtualScrollThreshold: settings.virtualScrollThreshold,
  });
  dom.input.style.tabSize = String(settings.tabSize);
  dom.input.classList.toggle('wrap', !!settings.wordWrap);
  dom.codeWrap.classList.toggle('wrap', !!settings.wordWrap);
  dom.codeWrap.classList.toggle('no-wrap', !settings.wordWrap);
});

const editor = new EditorEngine(dom, {
  onChange: (tab, before, after) => {
    collab.broadcastEdit(tab.path, before, after);
    if (ai.status.configured && ai.status.provider !== 'none') {
      requestGhostText();
    }
    markDirtyState();
  },
  onCursor: (line, column) => {
    const tab = editor.activeTab;
    if (tab) collab.broadcastCursor(tab.path, line, column);
  },
  onSave: (tab, saveAs) => saveActiveFile(saveAs),
  onFind: (replace) => toggleFindBar(true, replace),
});

const ai = new AIModule(api, {
  onStatus: (status) => renderAiStatus(status),
  onGhostText: (text) => editor.setGhostText(text),
});

const collab = new CollaborationModule(api, {
  onPeers: (peers) => renderPeers(peers),
  onRemoteEdit: async (peerId, op) => {
    const tab = editor.activeTab;
    if (!tab || op.filePath !== tab.path) return;
    const next = await collab.applyRemote(op.filePath, op, dom.input.value);
    if (next !== null && next !== undefined) {
      dom.input.value = next;
      editor.setContent(next);
    }
  },
  onRemoteCursor: (peerId, cursor) => renderRemoteCursor(peerId, cursor),
  onChat: (messages) => renderCollabChat(messages),
  onStatus: (status) => renderCollabStatus(status),
});

const intel = new IntelligenceModule(api, {
  onResults: (result) => {
    if (result.type === 'search') state.searchResults = result.results || [];
    if (result.type === 'dead-code' || result.type === 'test-impact') {
      openBottomPanel(result.type === 'dead-code' ? 'deadcode' : 'impact');
      renderPanel(result.type === 'dead-code' ? 'deadcode' : 'impact');
    }
  },
});

const workflow = new WorkflowModule(api, {
  onPreview: (preview) => renderPreviewPanel(preview),
  onDeploy: (result) => toast(result.ok ? `Deployed via ${result.provider}` : result.error || 'Deploy failed', !result.ok),
  onDatabase: (db) => renderDatabasePanel(db),
  onApi: (payload) => renderApiResponse(payload.last),
  onTerminal: (result) => appendTerminalOutput(result),
});

function themeLabel(id) {
  const found = themeManager.themes.find((t) => t.id === id);
  return found ? found.label : id || 'Glint';
}

/* ------------------------------------------------------------------ */
/* Ghost text                                                          */
/* ------------------------------------------------------------------ */

let ghostTimer = null;
function requestGhostText() {
  clearTimeout(ghostTimer);
  ghostTimer = setTimeout(async () => {
    const tab = editor.activeTab;
    if (!tab || !themeManager.settings.aiGhostText) return;
    const pos = dom.input.selectionStart;
    const value = dom.input.value;
    const prefix = value.slice(0, pos);
    const suffix = value.slice(pos);
    // Only request after a meaningful amount of typing.
    if (prefix.length - prefix.lastIndexOf('\n') < 2) return;
    ai.requestCompletion({ prefix, suffix, fileName: tab.name });
  }, 260);
}

function markDirtyState() {
  const tab = editor.activeTab;
  dom.statusLeft.textContent = tab ? (tab.dirty ? `Modified: ${tab.name}` : tab.name) : 'Ready';
  dom.statusLeft.style.color = tab?.dirty ? 'var(--accent)' : '';
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

async function openFileAtPath(filePath, name, content) {
  if (content === undefined) {
    const result = await api.readFile(filePath);
    if (!result.ok) {
      toast(`Could not read ${name}: ${result.error}`, true);
      return;
    }
    content = result.content;
  }
  editor.openTab({ path: filePath, name, content, language: detectLanguage(name) });
  api.watchFile(filePath);
}

async function saveActiveFile(saveAs = false) {
  const tab = editor.activeTab;
  if (!tab) return false;

  if (!tab.path || saveAs) {
    const result = await api.saveFileAs(tab.name, dom.input.value);
    if (result.cancelled) return false;
    if (!result.ok) {
      toast(`Save failed: ${result.error}`, true);
      return false;
    }
    tab.path = result.path;
    tab.name = result.name;
    tab.language = detectLanguage(result.name);
    editor.markSaved();
    toast(`Saved ${result.name}`);
    return true;
  }

  const result = await api.writeFile(tab.path, dom.input.value);
  if (!result.ok) {
    toast(`Save failed: ${result.error}`, true);
    return false;
  }
  editor.markSaved();
  toast(`Saved ${tab.name}`);
  return true;
}

/* ------------------------------------------------------------------ */
/* Sidebar rendering                                                   */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const view = state.activeView;

  if (view === 'search') return renderSearchSidebar();
  if (view === 'git') return renderGitSidebar();
  if (view === 'collab') return renderCollabSidebar();
  if (view === 'deploy') return renderDeploySidebar();
  if (view === 'database') return renderDatabaseSidebar();
  if (view === 'api') return renderApiSidebar();
  if (view === 'marketplace') return renderMarketplaceSidebar();

  renderExplorerSidebar();
}

function renderExplorerSidebar() {
  dom.sidebarBody.innerHTML = '';

  if (!state.workspace) {
    const div = document.createElement('div');
    div.className = 'empty-side';
    div.innerHTML = '<div class="big">📂</div><div>No folder open</div>';
    const btn = document.createElement('button');
    btn.textContent = 'Open Folder';
    btn.onclick = openFolder;
    div.appendChild(btn);
    dom.sidebarBody.appendChild(div);

    if (state.recent.length) {
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = 'Recent';
      dom.sidebarBody.appendChild(label);
      for (const p of state.recent) {
        const item = document.createElement('div');
        item.className = 'recent-item';
        const parts = p.split('/');
        item.innerHTML = `<span>🕐</span><span>${escapeHtml(parts[parts.length - 1])}</span>`;
        item.title = p;
        item.onclick = () => api.openPath(p);
        dom.sidebarBody.appendChild(item);
      }
    }
    return;
  }

  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = state.workspace.name;
  dom.sidebarBody.appendChild(label);
  renderTreeNodes(state.workspace.tree || [], dom.sidebarBody, 0);
}

function renderTreeNodes(nodes, container, depth) {
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = 'tree-item';
    row.style.paddingLeft = `${10 + depth * 13}px`;

    const isOpen = state.expanded.has(node.path);
    const chevron = node.type === 'directory'
      ? `<span class="chevron${isOpen ? ' open' : ''}">›</span>`
      : '<span class="chevron leaf">›</span>';

    const active = editor.activeTab && editor.activeTab.path === node.path;
    if (active) row.classList.add('active');

    const icon = node.type === 'directory' ? '📁' : fileIcon(node.name);
    const size = node.type === 'file' && node.size ? `<span class="size">${formatSize(node.size)}</span>` : '';

    row.innerHTML = `${chevron}<span class="ico${node.type === 'directory' ? ' dir' : ''}">${icon}</span><span class="name">${escapeHtml(node.name)}</span>${size}`;
    row.title = node.path;

    row.onclick = (e) => {
      e.stopPropagation();
      if (node.type === 'directory') {
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
  }
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return '🟨';
  if (['json', 'jsonc'].includes(ext)) return '🟩';
  if (['html', 'htm', 'xml', 'svg'].includes(ext)) return '🟧';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return '🟦';
  if (ext === 'py') return '🐍';
  if (['sh', 'bash', 'zsh'].includes(ext)) return '🐚';
  if (['yml', 'yaml', 'toml'].includes(ext)) return '⚙️';
  return '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

async function openFolder() {
  const payload = await api.openFolder();
  if (!payload) return;
  applyWorkspace(payload);
}

function applyWorkspace(payload) {
  state.workspace = { path: payload.path, name: payload.name, tree: payload.tree };
  state.recent = payload.recent || [];
  state.expanded = new Set([payload.path]);
  dom.workspaceName.textContent = `— ${payload.name}`;
  if (payload.settings) {
    themeManager.settings = { ...themeManager.settings, ...payload.settings };
    themeManager.apply();
  }
  renderSidebar();
  editor.render();
  toast(`Opened ${payload.name}`);
  refreshGitStatus();
}

/* ------------------------------------------------------------------ */
/* Sidebar views                                                       */
/* ------------------------------------------------------------------ */

function renderSearchSidebar() {
  dom.sidebarBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.padding = '10px 12px';
  wrap.innerHTML = `
    <input class="glass-input" id="semanticQuery" placeholder="Search by meaning…" />
    <div style="margin-top:8px;font-size:11.5px;color:var(--text-muted)" id="searchMeta">Type to search the project.</div>
  `;
  dom.sidebarBody.appendChild(wrap);

  const results = document.createElement('div');
  results.id = 'searchResults';
  dom.sidebarBody.appendChild(results);

  const input = $('semanticQuery');
  let timer = null;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const query = input.value.trim();
      if (!query) {
        results.innerHTML = '';
        $('searchMeta').textContent = 'Type to search the project.';
        return;
      }
      $('searchMeta').textContent = 'Searching…';
      const result = await intel.search(query);
      $('searchMeta').textContent = `${result.results?.length || 0} results in ${result.filesScanned || 0} files`;
      results.innerHTML = '';
      for (const r of result.results || []) {
        const row = document.createElement('div');
        row.className = 'result-row';
        row.innerHTML = `<span class="file">${escapeHtml(r.file)}</span><span class="line-no">${r.lineNumber}</span><span class="snippet">${escapeHtml(r.line)}</span>`;
        row.onclick = () => jumpToFile(r.absolutePath, r.file, r.lineNumber);
        results.appendChild(row);
      }
    }, 350);
  };
}

async function jumpToFile(absolutePath, fileName, lineNumber) {
  await openFileAtPath(absolutePath, fileName);
  if (lineNumber) {
    const tab = editor.activeTab;
    if (tab) {
      const lines = tab.content.split('\n');
      let offset = 0;
      for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) offset += lines[i].length + 1;
      dom.input.focus();
      dom.input.setSelectionRange(offset, offset);
      const lineHeight = editor.lineHeight();
      dom.codeWrap.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
      editor.render();
    }
  }
}

function renderGitSidebar() {
  dom.sidebarBody.innerHTML = '';
  const status = state.gitStatus;

  if (!status || !status.isRepo) {
    dom.sidebarBody.innerHTML =
      '<div class="empty-side"><div class="big">⑂</div><div>This folder is not a git repository.</div></div>';
    return;
  }

  const head = document.createElement('div');
  head.style.padding = '10px 14px';
  head.innerHTML = `<div style="font-size:13px;font-weight:600">${escapeHtml(status.branch)}</div>
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">
      ${status.counts.staged} staged · ${status.counts.unstaged} modified · ${status.counts.untracked} new
    </div>`;
  dom.sidebarBody.appendChild(head);

  const actions = document.createElement('div');
  actions.style.padding = '0 12px 10px';
  actions.innerHTML = `<button class="btn" id="btnAiCommit" style="width:100%">✦ AI Commit Message</button>`;
  dom.sidebarBody.appendChild(actions);
  $('btnAiCommit').onclick = async () => {
    const result = await ai.commitMessage();
    if (!result.ok) {
      toast(result.error || 'Could not generate a commit message', true);
      return;
    }
    openModal('AI Commit Message', `
      <div class="field full"><label>Generated message</label>
        <input class="glass-input" id="commitMessageInput" value="${escapeHtml(result.message)}" /></div>
      <div class="btn-row"><button class="btn primary" id="commitApply">Use Message</button></div>
    `, (body) => {
      body.querySelector('#commitApply').onclick = async () => {
        const message = body.querySelector('#commitMessageInput').value;
        const committed = await api.gitCommit(message);
        if (committed.ok) {
          toast('Committed');
          closeModal();
          refreshGitStatus();
        } else {
          toast(committed.error || 'Commit failed', true);
        }
      };
    });
  };

  const section = (title, files) => {
    if (!files.length) return;
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `${title} (${files.length})`;
    dom.sidebarBody.appendChild(label);
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.style.paddingLeft = '14px';
      row.innerHTML = `<span class="ico">${file.untracked ? '✚' : file.staged ? '●' : '✎'}</span>
        <span class="name">${escapeHtml(file.path.split('/').pop())}</span>
        <span class="size">${escapeHtml(file.path.split('/').slice(0, -1).join('/'))}</span>`;
      row.title = file.path;
      row.onclick = async () => {
        if (file.staged) await api.gitUnstage(file.path);
        else await api.gitStage(file.path);
        refreshGitStatus();
      };
      dom.sidebarBody.appendChild(row);
    }
  };

  section('Staged', status.staged);
  section('Modified', status.unstaged);
  section('Untracked', status.untracked);
}

async function refreshGitStatus() {
  state.gitStatus = await api.gitStatus();
  if (state.activeView === 'git') renderGitSidebar();
}

function renderCollabSidebar() {
  dom.sidebarBody.innerHTML = '';
  const peers = collab.peers;

  const box = document.createElement('div');
  box.style.padding = '12px 14px';
  box.innerHTML = `
    <div class="btn-row" style="flex-direction:column">
      <button class="btn primary" id="btnCollabStart">Start Session</button>
      <button class="btn" id="btnCollabJoin">Join Session</button>
      <button class="btn danger" id="btnCollabStop">Stop Session</button>
    </div>
    <div id="sessionInfo" style="margin-top:12px"></div>
  `;
  dom.sidebarBody.appendChild(box);

  $('btnCollabStart').onclick = async () => {
    const result = await collab.start();
    if (!result.ok) {
      toast(result.error || 'Could not start the session', true);
      return;
    }
    renderCollabSidebar();
    toast(`Session ${result.room} live on port ${result.port}`);
  };

  $('btnCollabJoin').onclick = () => {
    openModal('Join Collaboration Session', `
      <div class="field full"><label>Session URL</label>
        <input class="glass-input" id="joinUrl" placeholder="ws://192.168.1.10:41234" /></div>
      <div class="field full"><label>Your name</label>
        <input class="glass-input" id="joinName" placeholder="developer" /></div>
      <div class="btn-row"><button class="btn primary" id="joinGo">Join</button></div>
    `, (body) => {
      body.querySelector('#joinGo').onclick = async () => {
        const url = body.querySelector('#joinUrl').value.trim();
        const name = body.querySelector('#joinName').value.trim();
        const result = await collab.join(url, { name });
        if (!result.ok) {
          toast(result.error || 'Could not join', true);
          return;
        }
        closeModal();
        renderCollabSidebar();
        toast('Joined session');
      };
    });
  };

  $('btnCollabStop').onclick = async () => {
    await collab.stop();
    renderCollabSidebar();
    toast('Session ended');
  };

  if (collab.session) {
    const info = $('sessionInfo');
    info.className = 'session-box';
    info.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted)">Session URL — share with collaborators</div>
      <div class="url">${escapeHtml(collab.session.url || collab.session.room)}</div>
      <button class="btn tiny" id="copySessionUrl">Copy URL</button>
    `;
    $('copySessionUrl').onclick = () => {
      navigator.clipboard.writeText(collab.session.url || '');
      toast('URL copied');
    };
  }

  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = `Participants (${peers.length})`;
  dom.sidebarBody.appendChild(label);

  const list = document.createElement('div');
  list.className = 'peer-list';
  list.style.padding = '0 14px';
  for (const peer of peers) {
    const item = document.createElement('div');
    item.className = 'peer';
    item.innerHTML = `<div class="avatar" style="background:${peer.color}">${escapeHtml(peer.name.slice(0, 2).toUpperCase())}</div>
      <div><div class="name">${escapeHtml(peer.name)}</div><div class="state">${peer.self ? 'You' : 'Connected'}</div></div>
      ${peer.self ? '<span class="self-tag">self</span>' : ''}`;
    list.appendChild(item);
  }
  dom.sidebarBody.appendChild(list);

  const chatLabel = document.createElement('div');
  chatLabel.className = 'section-label';
  chatLabel.textContent = 'Chat';
  dom.sidebarBody.appendChild(chatLabel);

  const chatBox = document.createElement('div');
  chatBox.style.padding = '0 14px';
  chatBox.innerHTML = `
    <div id="collabChat" class="collab-chat" style="max-height:220px;overflow:auto"></div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <input class="glass-input" id="collabChatInput" placeholder="Message…" />
      <button class="btn" id="collabChatSend">Send</button>
    </div>`;
  dom.sidebarBody.appendChild(chatBox);

  const send = () => {
    const input = $('collabChatInput');
    if (!input.value.trim()) return;
    collab.sendChat(input.value.trim());
    input.value = '';
  };
  $('collabChatSend').onclick = send;
  $('collabChatInput').onkeydown = (e) => {
    if (e.key === 'Enter') send();
  };

  renderCollabChat(collab.messages);
}

function renderDeploySidebar() {
  dom.sidebarBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.padding = '12px 14px';
  wrap.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Choose a deployment target.</div>';
  dom.sidebarBody.appendChild(wrap);

  for (const target of workflow.deployTargets) {
    const item = document.createElement('div');
    item.className = 'deploy-target';
    item.innerHTML = `<div class="logo">${target.id === 'vercel' ? '▲' : target.id === 'netlify' ? '◆' : target.id === 'cloudflare' ? '☁' : target.id === 'github' ? '🐙' : '📦'}</div>
      <div class="meta"><div class="name">${escapeHtml(target.label)}</div>
      <div class="desc">${target.requires === 'token' ? 'Requires an API token' : 'No credentials required'}</div></div>`;
    item.onclick = () => openDeployDialog(target);
    wrap.appendChild(item);
  }
}

function renderDatabaseSidebar() {
  dom.sidebarBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.padding = '12px 14px';
  wrap.innerHTML = `
    <div class="field full"><label>Connection string</label>
      <input class="glass-input" id="dbConn" placeholder="sqlite:///path/to/db.sqlite or https://api.example.com" /></div>
    <div class="btn-row"><button class="btn primary" id="dbConnect">Connect</button></div>
    <div id="dbTables" style="margin-top:12px"></div>`;
  dom.sidebarBody.appendChild(wrap);

  $('dbConnect').onclick = async () => {
    const conn = $('dbConn').value.trim();
    const result = await workflow.connectDatabase(conn);
    if (!result.ok) {
      toast(result.error || 'Could not connect', true);
      return;
    }
    renderDatabaseSidebar();
    toast('Connected');
  };

  if (workflow.db.connected && workflow.db.tables?.length) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'Tables';
    dom.sidebarBody.appendChild(label);
    for (const table of workflow.db.tables) {
      const item = document.createElement('div');
      item.className = 'db-table';
      item.innerHTML = `<span>▸</span><span>${escapeHtml(table)}</span>`;
      item.onclick = async () => {
        const conn = $('dbConn').value.trim();
        await workflow.queryDatabase(conn, `SELECT * FROM ${table} LIMIT 100;`);
      };
      dom.sidebarBody.appendChild(item);
    }
  }
}

function renderApiSidebar() {
  dom.sidebarBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.padding = '12px 14px';
  wrap.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Send an HTTP request to any endpoint.</div>
    <button class="btn primary" id="openApiClient" style="width:100%">Open API Client</button>
    <div id="apiHistory" style="margin-top:14px"></div>`;
  dom.sidebarBody.appendChild(wrap);

  $('openApiClient').onclick = () => openApiClient();

  if (workflow.apiHistory.length) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'History';
    dom.sidebarBody.appendChild(label);
    for (const entry of workflow.apiHistory) {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `<span class="file">${escapeHtml(entry.method)}</span><span class="snippet">${escapeHtml(entry.url)}</span>`;
      row.onclick = () => openApiClient(entry);
      dom.sidebarBody.appendChild(row);
    }
  }
}

function renderMarketplaceSidebar() {
  dom.sidebarBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.padding = '12px 14px';
  wrap.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Browse and install community themes.</div>
    <button class="btn primary" id="openMarket" style="width:100%">Open Marketplace</button>
    <button class="btn" id="exportTheme" style="width:100%;margin-top:8px">Export Current Theme</button>`;
  dom.sidebarBody.appendChild(wrap);
  $('openMarket').onclick = openMarketplace;
  $('exportTheme').onclick = async () => {
    const result = await themeManager.exportTheme();
    if (result.ok) toast('Theme exported');
  };
}

/* ------------------------------------------------------------------ */
/* Bottom panel                                                        */
/* ------------------------------------------------------------------ */

function openBottomPanel(panel) {
  state.bottomPanelOpen = true;
  state.activePanel = panel;
  dom.bottomPanel.classList.add('open');
  document.querySelectorAll('.panel-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.panel === panel);
  });
  renderPanel(panel);
}

function closeBottomPanel() {
  state.bottomPanelOpen = false;
  dom.bottomPanel.classList.remove('open');
}

function renderPanel(panel) {
  dom.panelToolbar.style.display = 'none';
  dom.panelToolbar.innerHTML = '';
  dom.panelBody.innerHTML = '';

  switch (panel) {
    case 'problems':
      dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">No problems detected.</div>';
      break;
    case 'output':
      dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">Glint output appears here.</div>';
      break;
    case 'terminal':
      renderTerminalPanel();
      break;
    case 'preview':
      renderPreviewPanel(workflow.preview);
      break;
    case 'deadcode':
      renderDeadCodePanel();
      break;
    case 'impact':
      renderImpactPanel();
      break;
    default:
      break;
  }
}

function renderTerminalPanel() {
  dom.panelToolbar.style.display = 'flex';
  dom.panelToolbar.innerHTML = `
    <input class="glass-input" id="terminalInput" placeholder="Run a command…" style="flex:1" />
    <button class="btn primary" id="terminalRun">Run</button>`;
  dom.panelBody.innerHTML = '<div class="terminal" id="terminalOutput"></div>';

  const run = async () => {
    const input = $('terminalInput');
    const command = input.value.trim();
    if (!command) return;
    input.value = '';
    appendTerminalOutput({ command, pending: true });
    const result = await workflow.runCommand(command);
    appendTerminalOutput(result);
  };
  $('terminalRun').onclick = run;
  $('terminalInput').onkeydown = (e) => {
    if (e.key === 'Enter') run();
  };
}

function appendTerminalOutput(result) {
  const output = $('terminalOutput');
  if (!output) return;
  const block = document.createElement('div');
  block.style.marginBottom = '8px';
  block.innerHTML = `<div style="color:var(--accent)">$ ${escapeHtml(result.command || '')}</div>`;
  if (result.pending) {
    output.appendChild(block);
    return;
  }
  const text = result.output || result.error || '(no output)';
  const line = document.createElement('div');
  line.textContent = text;
  if (result.error) line.className = 'err';
  block.appendChild(line);
  output.appendChild(block);
  output.scrollTop = output.scrollHeight;
}

function renderPreviewPanel(preview) {
  if (!preview.running) {
    dom.panelToolbar.style.display = 'flex';
    dom.panelToolbar.innerHTML = '<button class="btn primary" id="previewStart">Start Preview</button>';
    dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">No preview running.</div>';
    $('previewStart').onclick = async () => {
      const result = await workflow.startPreview();
      if (!result.ok) toast(result.error || 'Could not start preview', true);
    };
    return;
  }

  dom.panelToolbar.style.display = 'flex';
  dom.panelToolbar.innerHTML = `
    <span class="preview-url">${escapeHtml(preview.url || '')}</span>
    <div class="spacer" style="flex:1"></div>
    <button class="btn" id="previewReload">Reload</button>
    <button class="btn danger" id="previewStop">Stop</button>`;
  dom.panelBody.innerHTML = `
    <iframe class="preview-frame" id="previewFrame" src="${escapeHtml(preview.url || '')}" style="height:220px;border:1px solid var(--glass-border);border-radius:10px"></iframe>
    <div class="preview-log" style="margin-top:10px"><pre>${escapeHtml((preview.log || []).join(''))}</pre></div>`;

  $('previewReload').onclick = () => {
    const frame = $('previewFrame');
    if (frame) frame.src = frame.src;
  };
  $('previewStop').onclick = async () => {
    await workflow.stopPreview();
  };
}

async function renderDeadCodePanel() {
  dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">Analysing project…</div>';
  const result = await intel.findDeadCode();
  if (!result.dead?.length) {
    dom.panelBody.innerHTML = '<div style="color:var(--success);font-size:12.5px">No dead code detected.</div>';
    return;
  }
  dom.panelBody.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
      ${result.dead.length} unused definitions out of ${result.totalDefinitions} analysed.</div>`;
  for (const item of result.dead) {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `<span class="file">${escapeHtml(item.file)}</span><span class="line-no">${item.lineNumber}</span>
      <span class="snippet">${escapeHtml(item.kind)} ${escapeHtml(item.name)}</span>`;
    row.onclick = () => jumpToFile(item.absolutePath, item.file.split('/').pop(), item.lineNumber);
    dom.panelBody.appendChild(row);
  }
}

async function renderImpactPanel() {
  dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">Analysing tests…</div>';
  const result = await intel.testImpact([]);
  if (!result.impacts?.length) {
    dom.panelBody.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px">No source files found.</div>';
    return;
  }
  const risky = result.impacts.filter((i) => i.affectedTests.length);
  dom.panelBody.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
      ${result.testFileCount} test files · ${risky.length} source files covered by tests.</div>`;
  for (const impact of risky) {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `<span class="file">${escapeHtml(impact.file)}</span>
      <span class="snippet">${impact.affectedTests.length} test(s) · ${impact.risk} risk</span>`;
    dom.panelBody.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* AI panel                                                            */
/* ------------------------------------------------------------------ */

function renderAiStatus(status) {
  const dot = dom.aiPanel.querySelector('#aiStatus .dot');
  const text = $('aiStatusText');
  if (!dot || !text) return;
  if (status.configured) {
    dot.className = 'dot ok';
    text.textContent = `${status.provider} · ${status.model}`;
  } else {
    dot.className = 'dot';
    text.textContent = 'No provider configured';
  }
}

function renderChat() {
  dom.chatMessages.innerHTML = '';
  for (const msg of state.chatMessages) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role}`;
    div.innerHTML = `<div class="who">${msg.role === 'user' ? 'You' : 'Glint AI'}</div>
      <div class="bubble">${escapeHtml(msg.content)}</div>`;
    dom.chatMessages.appendChild(div);
  }
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

async function sendChat() {
  const text = dom.chatInput.value.trim();
  if (!text) return;

  const context = {};
  if (state.attachContext && editor.activeTab) {
    context.code = dom.input.value;
    context.fileName = editor.activeTab.name;
  }

  state.chatMessages.push({ role: 'user', content: text });
  dom.chatInput.value = '';
  renderChat();

  const result = await ai.chat(text, context);
  if (!result.ok) {
    state.chatMessages.push({ role: 'assistant', content: `⚠️ ${result.error}` });
  } else {
    state.chatMessages.push({ role: 'assistant', content: result.text });
  }
  renderChat();
}

/* ------------------------------------------------------------------ */
/* Collaboration rendering                                             */
/* ------------------------------------------------------------------ */

function renderPeers(peers) {
  const badge = $('collabBadge');
  const others = peers.filter((p) => !p.self);
  if (others.length) {
    badge.style.display = '';
    badge.textContent = String(others.length);
  } else {
    badge.style.display = 'none';
  }
  if (state.activeView === 'collab') renderCollabSidebar();
}

function renderCollabStatus(status) {
  const el = $('collabStatus');
  if (status.active) {
    el.style.display = '';
    el.innerHTML = `<span class="peer-dot" style="background:var(--success)"></span> Live`;
  } else {
    el.style.display = 'none';
  }
}

function renderRemoteCursor(peerId, cursor) {
  const key = peerId;
  let el = dom.remoteCursors.querySelector(`[data-peer="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'remote-cursor';
    el.dataset.peer = key;
    dom.remoteCursors.appendChild(el);
  }
  const color = collab.colorFor(peerId);
  const name = collab.nameFor(peerId);
  const lineHeight = editor.lineHeight();
  const top = 14 + (cursor.line - 1) * lineHeight - dom.codeWrap.scrollTop;
  const left = 20 + (cursor.column - 1) * editor.charWidth() - dom.codeWrap.scrollLeft;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.innerHTML = `<div class="caret" style="background:${color}"></div>
    <div class="flag" style="background:${color}">${escapeHtml(name)}</div>`;
}

function renderCollabChat(messages) {
  const container = $('collabChat');
  if (!container) return;
  container.innerHTML = '';
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = 'collab-msg';
    const who = msg.self ? 'You' : collab.nameFor(msg.peerId);
    div.innerHTML = `<span class="who" style="color:${collab.colorFor(msg.peerId)}">${escapeHtml(who)}</span>${escapeHtml(msg.message)}`;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Settings panel                                                      */
/* ------------------------------------------------------------------ */

/** Build a colour-picker row for the settings panel. */
function colorField(id, label, hint, value) {
  return `
    <div class="field">
      <div><label for="${id}">${escapeHtml(label)}</label><div class="hint">${escapeHtml(hint)}</div></div>
      <input type="color" id="${id}" value="${escapeHtml(value)}" />
    </div>`;
}

function renderSettingsPanel() {
  const s = themeManager.settings;
  const fonts = themeManager.getFontOptions();

  dom.settingsBody.innerHTML = `
    <div class="settings-group">
      <h3>Theme</h3>
      <div class="swatches" id="settingsSwatches"></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="btnOpenMarket">Marketplace</button>
        <button class="btn" id="btnExportTheme">Export current</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Colours</h3>
      ${colorField('cAccent', 'Accent', 'Buttons, highlights, cursor', s.accent)}
      ${colorField('cBg', 'Background', 'Editor backdrop', s.bg)}
      ${colorField('cText', 'Text', 'Primary foreground colour', s.text)}
      ${colorField('cMuted', 'Muted text', 'Secondary text', s.muted)}
    </div>

    <div class="settings-group">
      <h3>Liquid glass</h3>
      <div class="field">
        <div><label>Enable glass effect</label><div class="hint">Turn off for solid surfaces</div></div>
        <button class="toggle ${s.liquidGlass ? 'on' : ''}" id="tGlass"></button>
      </div>
      <div class="field">
        <div><label>Liquid mode</label><div class="hint">Refract the desktop wallpaper behind the editor</div></div>
        <button class="toggle ${s.liquidMode ? 'on' : ''}" id="tLiquid"></button>
      </div>
      <div class="field">
        <div><label>Ambient light</label><div class="hint">Tint changes with the time of day</div></div>
        <button class="toggle ${s.ambientLight ? 'on' : ''}" id="tAmbient"></button>
      </div>
      <div class="field">
        <div><label>Wallpaper dim</label><div class="hint">Darken the wallpaper behind the UI</div></div>
        <input type="range" id="rDim" min="0" max="90" value="${s.wallpaperDim ?? 45}" />
      </div>
      <div class="field">
        <div><label>Blur</label><div class="hint">Backdrop blur strength</div></div>
        <input type="range" id="rBlur" min="0" max="60" value="${s.glassBlur}" />
      </div>
      <div class="field">
        <div><label>Surface opacity</label><div class="hint">Glass panel transparency</div></div>
        <input type="range" id="rOpacity" min="20" max="100" value="${s.glassOpacity}" />
      </div>
    </div>

    <div class="settings-group">
      <h3>Typography</h3>
      <div class="field">
        <div><label>Font family</label><div class="hint">Monospace typeface for the editor</div></div>
        <select id="sFontFamily">${fonts.map((f) => `<option value="${escapeHtml(f)}"${f === s.fontFamily ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <div><label>Import font</label><div class="hint">Load a .ttf/.otf from your Mac</div></div>
        <button class="btn tiny" id="btnImportFont">Import…</button>
      </div>
      <div class="field">
        <div><label>Font size</label><div class="hint">In pixels</div></div>
        <input type="number" id="nFontSize" min="9" max="30" value="${s.fontSize}" />
      </div>
      <div class="field">
        <div><label>Font weight</label><div class="hint">Text thickness</div></div>
        <select id="sFontWeight">
          ${['300', '400', '500', '600', '700'].map((w) => `<option value="${w}"${String(s.fontWeight) === w ? ' selected' : ''}>${w}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <div><label>Line height</label><div class="hint">Multiplier</div></div>
        <input type="number" id="nLineHeight" min="1.1" max="2.4" step="0.05" value="${s.fontLineHeight}" />
      </div>
      <div class="field">
        <div><label>Letter spacing</label><div class="hint">In pixels</div></div>
        <input type="number" id="nLetterSpacing" min="-2" max="8" step="0.2" value="${s.letterSpacing ?? 0}" />
      </div>
      <div class="field">
        <div><label>Font ligatures</label><div class="hint">Combine characters like => and !=</div></div>
        <button class="toggle ${s.fontLigatures ? 'on' : ''}" id="tLigatures"></button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Editor</h3>
      <div class="field">
        <div><label>Tab size</label><div class="hint">Spaces per indent level</div></div>
        <input type="number" id="nTabSize" min="2" max="8" value="${s.tabSize}" />
      </div>
      <div class="field">
        <div><label>Word wrap</label><div class="hint">Wrap long lines</div></div>
        <button class="toggle ${s.wordWrap ? 'on' : ''}" id="tWrap"></button>
      </div>
      <div class="field">
        <div><label>Zen mode</label><div class="hint">Hide chrome and focus on code</div></div>
        <button class="toggle ${s.zenMode ? 'on' : ''}" id="tZen"></button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Performance</h3>
      <div class="field">
        <div><label>Virtual scrolling</label><div class="hint">Only render visible lines in huge files</div></div>
        <button class="toggle ${s.virtualScroll ? 'on' : ''}" id="tVirtual"></button>
      </div>
      <div class="field">
        <div><label>Threshold</label><div class="hint">Lines before virtual scrolling kicks in</div></div>
        <input type="number" id="nThreshold" min="500" max="100000" step="500" value="${s.virtualScrollThreshold}" />
      </div>
      <div class="field">
        <div><label>Native file watching</label><div class="hint">Event-driven instead of polling</div></div>
        <button class="toggle ${s.nativeWatch ? 'on' : ''}" id="tWatch"></button>
      </div>
    </div>

    <div class="settings-group">
      <h3>AI</h3>
      <div class="field">
        <div><label>Provider</label><div class="hint">Where completions are computed</div></div>
        <select id="sAiProvider">
          ${['none', 'local', 'cloud'].map((p) => `<option value="${p}"${s.aiProvider === p ? ' selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <div><label>Local endpoint</label><div class="hint">Ollama or LM Studio base URL</div></div>
        <input type="text" id="sAiLocal" value="${escapeHtml(s.aiLocalEndpoint || '')}" />
      </div>
      <div class="field">
        <div><label>Local model</label><div class="hint">Model name</div></div>
        <input type="text" id="sAiLocalModel" value="${escapeHtml(s.aiLocalModel || '')}" />
      </div>
      <div class="field">
        <div><label>Cloud endpoint</label><div class="hint">OpenAI-compatible API base URL</div></div>
        <input type="text" id="sAiCloud" value="${escapeHtml(s.aiCloudEndpoint || '')}" />
      </div>
      <div class="field">
        <div><label>Cloud model</label><div class="hint">Model name</div></div>
        <input type="text" id="sAiCloudModel" value="${escapeHtml(s.aiCloudModel || '')}" />
      </div>
      <div class="field full">
        <label>Cloud API key</label>
        <input class="glass-input" id="sAiKey" type="password" value="${escapeHtml(s.aiCloudKey || '')}" placeholder="sk-…" />
      </div>
      <div class="field">
        <div><label>Ghost text</label><div class="hint">Inline AI suggestions while typing</div></div>
        <button class="toggle ${s.aiGhostText ? 'on' : ''}" id="tGhost"></button>
      </div>
      <div class="btn-row">
        <button class="btn" id="btnTestAi">Test connection</button>
        <button class="btn" id="btnAiModels">List models</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Collaboration</h3>
      <div class="field">
        <div><label>Display name</label><div class="hint">Shown to collaborators</div></div>
        <input type="text" id="sCollabName" value="${escapeHtml(s.collabDisplayName || '')}" placeholder="developer" />
      </div>
    </div>

    <div class="btn-row">
      <button class="btn" id="btnResetSettings">Reset to defaults</button>
      <button class="btn primary" id="btnSaveSettings">Save</button>
    </div>
  `;

  // Theme swatches
  const swatches = $('settingsSwatches');
  for (const theme of themeManager.themes) {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (theme.id === s.theme ? ' active' : '');
    sw.innerHTML = `<div class="sw-preview" style="background:${theme.bg}">
        <i style="background:${theme.accent}"></i>
        <i style="background:${theme.text};opacity:.6"></i>
        <i style="background:${theme.muted};opacity:.5"></i>
      </div><div class="sw-name">${escapeHtml(theme.label)}</div>`;
    sw.onclick = async () => {
      await themeManager.applyTheme(theme.id);
      renderSettingsPanel();
    };
    swatches.appendChild(sw);
  }

  // Live colour updates
  for (const id of ['cAccent', 'cBg', 'cText', 'cMuted']) {
    $(id).addEventListener('input', () => {
      themeManager.update({
        accent: $('cAccent').value,
        bg: $('cBg').value,
        text: $('cText').value,
        muted: $('cMuted').value,
      });
    });
  }

  $('rBlur').addEventListener('input', () => themeManager.update({ glassBlur: Number($('rBlur').value) }));
  $('rOpacity').addEventListener('input', () => themeManager.update({ glassOpacity: Number($('rOpacity').value) }));
  $('rDim').addEventListener('input', () => themeManager.update({ wallpaperDim: Number($('rDim').value) }));
  $('nFontSize').addEventListener('input', () => themeManager.update({ fontSize: Number($('nFontSize').value) }));
  $('nTabSize').addEventListener('input', () => themeManager.update({ tabSize: Number($('nTabSize').value) }));
  $('nThreshold').addEventListener('input', () => themeManager.update({ virtualScrollThreshold: Number($('nThreshold').value) }));
  $('nLineHeight').addEventListener('input', () => themeManager.update({ fontLineHeight: Number($('nLineHeight').value) }));
  $('nLetterSpacing').addEventListener('input', () => themeManager.update({ letterSpacing: Number($('nLetterSpacing').value) }));
  $('sFontFamily').addEventListener('change', () => themeManager.update({ fontFamily: $('sFontFamily').value }));
  $('sFontWeight').addEventListener('change', () => themeManager.update({ fontWeight: $('sFontWeight').value }));

  const toggle = (id, key, after) => {
    $(id).onclick = async () => {
      const value = !themeManager.settings[key];
      await themeManager.update({ [key]: value });
      if (after) after(value);
      renderSettingsPanel();
    };
  };
  toggle('tGlass', 'liquidGlass');
  toggle('tAmbient', 'ambientLight');
  toggle('tLigatures', 'fontLigatures');
  toggle('tWrap', 'wordWrap');
  toggle('tZen', 'zenMode');
  toggle('tVirtual', 'virtualScroll');
  toggle('tGhost', 'aiGhostText');
  $('tLiquid').onclick = async () => {
    const value = !themeManager.settings.liquidMode;
    await themeManager.enableLiquidMode(value);
    renderSettingsPanel();
  };

  $('btnImportFont').onclick = async () => {
    const result = await themeManager.importFont();
    if (result.ok) {
      toast(`Font imported: ${result.family}`);
      renderSettingsPanel();
    } else if (!result.cancelled) {
      toast(result.error || 'Could not import font', true);
    }
  };

  $('btnOpenMarket').onclick = openMarketplace;
  $('btnExportTheme').onclick = async () => {
    const result = await themeManager.exportTheme();
    if (result.ok) toast('Theme exported');
  };

  $('btnTestAi').onclick = async () => {
    await saveSettingsFromForm(false);
    const result = await ai.healthCheck();
    toast(result.ok ? `Provider ready: ${result.reply}` : result.error || 'Provider unreachable', !result.ok);
  };

  $('btnAiModels').onclick = async () => {
    await saveSettingsFromForm(false);
    const result = await ai.listModels();
    if (result.ok && result.models.length) {
      openModal('Available Models', `<div style="font-family:var(--font-family);font-size:12.5px">${result.models.map(escapeHtml).join('<br>')}</div>`);
    } else {
      toast(result.error || 'No models returned', !result.ok);
    }
  };

  $('btnResetSettings').onclick = async () => {
    const fresh = await api.resetSettings();
    themeManager.settings = { ...themeManager.settings, ...fresh };
    themeManager.apply();
    renderSettingsPanel();
    toast('Reset to defaults');
  };

  $('btnSaveSettings').onclick = () => saveSettingsFromForm(true);
}

async function saveSettingsFromForm(close = true) {
  const patch = {
    accent: $('cAccent').value,
    bg: $('cBg').value,
    text: $('cText').value,
    muted: $('cMuted').value,
    glassBlur: Number($('rBlur').value),
    glassOpacity: Number($('rOpacity').value),
    wallpaperDim: Number($('rDim').value),
    liquidGlass: $('tGlass').classList.contains('on'),
    ambientLight: $('tAmbient').classList.contains('on'),
    liquidMode: themeManager.settings.liquidMode,
    fontSize: Number($('nFontSize').value),
    fontFamily: $('sFontFamily').value,
    fontWeight: $('sFontWeight').value,
    fontLineHeight: Number($('nLineHeight').value),
    letterSpacing: Number($('nLetterSpacing').value),
    fontLigatures: $('tLigatures').classList.contains('on'),
    tabSize: Number($('nTabSize').value),
    wordWrap: $('tWrap').classList.contains('on'),
    zenMode: $('tZen').classList.contains('on'),
    virtualScroll: $('tVirtual').classList.contains('on'),
    virtualScrollThreshold: Number($('nThreshold').value),
    nativeWatch: $('tWatch').classList.contains('on'),
    aiProvider: $('sAiProvider').value,
    aiLocalEndpoint: $('sAiLocal').value,
    aiLocalModel: $('sAiLocalModel').value,
    aiCloudEndpoint: $('sAiCloud').value,
    aiCloudModel: $('sAiCloudModel').value,
    aiCloudKey: $('sAiKey').value,
    aiGhostText: $('tGhost').classList.contains('on'),
    collabDisplayName: $('sCollabName').value,
  };
  await themeManager.update(patch);
  if (close) {
    toast('Settings saved');
    dom.settingsPanel.classList.remove('open');
  }
  await ai.refreshStatus();
}

/* ------------------------------------------------------------------ */
/* Marketplace                                                         */
/* ------------------------------------------------------------------ */

async function openMarketplace() {
  dom.settingsPanel.classList.remove('open');
  dom.marketPanel.classList.add('open');
  await themeManager.refreshThemes();
  renderMarketplace();
}

function renderMarketplace() {
  dom.marketBody.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'market-grid';

  for (const theme of themeManager.themes) {
    const card = document.createElement('button');
    card.className = 'market-card';
    card.innerHTML = `
      <div class="preview" style="background:${theme.bg}">
        <div class="bar" style="background:${theme.accent};width:42%"></div>
        <div class="code-line" style="background:${theme.text};width:72%"></div>
        <div class="code-line" style="background:${theme.muted};width:54%"></div>
      </div>
      <div class="meta">
        <div class="name">${escapeHtml(theme.label)}</div>
        <div class="author">${escapeHtml(theme.author || 'Glint')}</div>
        <div class="tags">${(theme.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      </div>`;
    card.onclick = async () => {
      await themeManager.applyTheme(theme.id);
      toast(`${theme.label} applied`);
      renderMarketplace();
    };
    grid.appendChild(card);
  }

  dom.marketBody.appendChild(grid);

  const note = document.createElement('div');
  note.style.marginTop = '14px';
  note.style.fontSize = '11.5px';
  note.style.color = 'var(--text-muted)';
  note.textContent = 'Custom themes you export appear here. Built-in and imported themes are stored locally.';
  dom.marketBody.appendChild(note);
}

/* ------------------------------------------------------------------ */
/* Deploy / database / API dialogs                                     */
/* ------------------------------------------------------------------ */

function openDeployDialog(target) {
  openModal(`Deploy — ${target.label}`, `
    ${target.requires === 'token' ? `
      <div class="field full"><label>${escapeHtml(target.label)} token</label>
        <input class="glass-input" id="deployToken" type="password" placeholder="Paste your token" /></div>
      ${target.docs ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Get a token at ${escapeHtml(target.docs)}</div>` : ''}
    ` : '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px">This target exports locally and needs no credentials.</div>'}
    <div class="field full"><label>Build command (optional)</label>
      <input class="glass-input" id="deployBuild" placeholder="npm run build" /></div>
    <div class="btn-row"><button class="btn primary" id="deployGo">Deploy</button></div>
    <div id="deployOutput" style="margin-top:12px"></div>
  `, (body) => {
    body.querySelector('#deployGo').onclick = async () => {
      const out = body.querySelector('#deployOutput');
      out.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Deploying…</div>';
      const result = await workflow.deploy({
        target: target.id,
        token: body.querySelector('#deployToken')?.value || '',
        buildCommand: body.querySelector('#deployBuild')?.value || '',
      });
      out.innerHTML = `<pre style="font-size:11.5px">${escapeHtml(result.output || result.error || '')}</pre>`;
      if (result.ok) toast(`Deployed via ${result.provider}`);
    };
  });
}

function openApiClient(entry = null) {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  openModal('API Client', `
    <div style="display:flex;gap:6px;align-items:center">
      <select class="glass-input" id="apiMethod" style="width:92px">
        ${methods.map((m) => `<option${entry?.method === m ? ' selected' : ''}>${m}</option>`).join('')}
      </select>
      <input class="glass-input" id="apiUrl" placeholder="https://api.example.com/endpoint" value="${escapeHtml(entry?.url || '')}" />
    </div>
    <div class="field full" style="margin-top:10px">
      <label>Headers</label>
      <div class="api-headers" id="apiHeaderRows">
        <input class="glass-input" placeholder="Header" />
        <input class="glass-input" placeholder="Value" />
        <button class="btn tiny" id="apiAddHeader">+</button>
      </div>
    </div>
    <div class="field full" style="margin-top:10px">
      <label>Body</label>
      <textarea class="glass-input" id="apiBody" rows="4" style="font-family:var(--font-family);font-size:12px">${escapeHtml(entry?.body?.body || '')}</textarea>
    </div>
    <div class="btn-row"><button class="btn primary" id="apiSend">Send request</button></div>
    <div id="apiResult"></div>
  `, (body) => {
    body.querySelector('#apiAddHeader').onclick = () => {
      const rows = body.querySelector('#apiHeaderRows');
      const row = document.createElement('div');
      row.className = 'api-headers';
      row.style.marginTop = '6px';
      row.innerHTML = `<input class="glass-input" placeholder="Header" /><input class="glass-input" placeholder="Value" /><button class="btn tiny">×</button>`;
      row.querySelector('button').onclick = () => row.remove();
      rows.parentElement.appendChild(row);
    };

    body.querySelector('#apiSend').onclick = async () => {
      const headers = {};
      body.querySelectorAll('.api-headers').forEach((row) => {
        const inputs = row.querySelectorAll('input');
        if (inputs[0]?.value.trim()) headers[inputs[0].value.trim()] = inputs[1]?.value || '';
      });
      const result = await workflow.sendRequest({
        method: body.querySelector('#apiMethod').value,
        url: body.querySelector('#apiUrl').value.trim(),
        headers,
        body: body.querySelector('#apiBody').value,
      });
      renderApiResponse({ result, ...result });
    };
  });
}

function renderApiResponse(entry) {
  const container = $('apiResult');
  if (!container || !entry) return;
  const result = entry.result || entry;
  const statusClass = result.ok ? 'ok' : 'bad';
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
  container.innerHTML = `
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px">
      <span class="api-status ${statusClass}">${result.status || (result.ok ? 'OK' : 'Error')}</span>
      <span style="font-size:11.5px;color:var(--text-muted)">${result.size || 0} bytes${result.error ? ' · ' + escapeHtml(result.error) : ''}</span>
    </div>
    <div class="api-response">${escapeHtml(body || '')}</div>`;
}

function renderDatabasePanel(db) {
  const container = $('dbTables');
  if (!container) return;
  if (!db.connected) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Not connected.</div>';
    return;
  }
  let html = `<div style="font-size:12px;color:var(--success);margin-bottom:8px">Connected (${escapeHtml(db.kind)})</div>`;
  if (db.rows) {
    const rows = Array.isArray(db.rows) ? db.rows : [db.rows];
    if (rows.length && typeof rows[0] === 'object') {
      const cols = Object.keys(rows[0]);
      html += '<div class="db-grid"><table><thead><tr>';
      html += cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      html += '</tr></thead><tbody>';
      for (const row of rows.slice(0, 100)) {
        html += '<tr>' + cols.map((c) => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>';
      }
      html += '</tbody></table></div>';
    } else {
      html += `<pre style="font-size:11.5px">${escapeHtml(JSON.stringify(rows, null, 2))}</pre>`;
    }
  }
  container.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/* Find & replace                                                      */
/* ------------------------------------------------------------------ */

function toggleFindBar(show, replace = false) {
  const open = show === undefined ? !dom.findbar.classList.contains('open') : show;
  dom.findbar.classList.toggle('open', open);
  if (open) {
    if (replace) state.replaceMode = true;
    dom.replaceInput.style.display = state.replaceMode ? '' : 'none';
    $('replaceOne').style.display = state.replaceMode ? '' : 'none';
    $('replaceAll').style.display = state.replaceMode ? '' : 'none';
    dom.findInput.focus();
    dom.findInput.select();
    runFind();
  } else {
    dom.findInput.value = '';
    dom.matchCount.textContent = '0 results';
    dom.input.focus();
  }
}

function runFind() {
  const term = dom.findInput.value;
  const matches = editor.find(term);
  dom.matchCount.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

const COMMANDS = [
  { id: 'file.open-folder', label: 'File: Open Folder…', icon: '📂', cmd: '⌘O', run: openFolder },
  { id: 'file.open-file', label: 'File: Open File…', icon: '📄', cmd: '⇧⌘O', run: () => api.openFile() },
  { id: 'file.save', label: 'File: Save', icon: '💾', cmd: '⌘S', run: () => saveActiveFile(false) },
  { id: 'file.save-as', label: 'File: Save As…', icon: '💾', cmd: '⇧⌘S', run: () => saveActiveFile(true) },
  { id: 'view.sidebar', label: 'View: Toggle Sidebar', icon: '◧', cmd: '⌘B', run: () => dom.sidebar.classList.toggle('collapsed') },
  { id: 'view.panel', label: 'View: Toggle Panel', icon: '▤', cmd: '⌘J', run: () => (state.bottomPanelOpen ? closeBottomPanel() : openBottomPanel('problems')) },
  { id: 'view.zen', label: 'View: Toggle Zen Mode', icon: '◐', cmd: '⌘K', run: toggleZen },
  { id: 'view.liquid', label: 'View: Toggle Liquid Mode', icon: '≈', cmd: '⌘⌥L', run: toggleLiquid },
  { id: 'view.settings', label: 'Preferences: Customise…', icon: '🎨', cmd: '⇧⌘K', run: openSettings },
  { id: 'view.marketplace', label: 'Theme: Marketplace…', icon: '🛍', run: openMarketplace },
  { id: 'view.fonts', label: 'Preferences: Fonts…', icon: '🔤', run: openSettings },

  { id: 'ai.chat', label: 'AI: Toggle Chat Panel', icon: '✦', cmd: '⌘⌥A', run: () => setActiveView('ai') },
  { id: 'ai.explain', label: 'AI: Explain Selection', icon: '💡', cmd: '⌘⌥E', run: aiExplain },
  { id: 'ai.refactor', label: 'AI: Refactor Selection', icon: '🔧', cmd: '⌘⌥R', run: aiRefactor },
  { id: 'ai.docstring', label: 'AI: Generate Documentation', icon: '📝', cmd: '⌘⌥D', run: aiDocstring },
  { id: 'ai.commit', label: 'AI: Generate Commit Message', icon: '✍', cmd: '⌘⌥M', run: aiCommitMessage },
  { id: 'ai.ghost', label: 'AI: Toggle Ghost Text', icon: '👻', run: () => themeManager.update({ aiGhostText: !themeManager.settings.aiGhostText }) },

  { id: 'collab.start', label: 'Collaboration: Start Session…', icon: '👥', run: () => setActiveView('collab') },
  { id: 'collab.join', label: 'Collaboration: Join Session…', icon: '🔗', run: () => setActiveView('collab') },
  { id: 'collab.stop', label: 'Collaboration: Stop Session', icon: '⏹', run: () => collab.stop() },

  { id: 'intel.search', label: 'Search: Semantic Search', icon: '🔎', cmd: '⌘⇧F', run: () => setActiveView('search') },
  { id: 'intel.dead', label: 'Analyse: Find Dead Code', icon: '🧹', run: () => openBottomPanel('deadcode') },
  { id: 'intel.impact', label: 'Analyse: Test Impact', icon: '🧪', run: () => openBottomPanel('impact') },
  { id: 'intel.overview', label: 'Analyse: Project Overview', icon: '📊', run: async () => {
    const result = await intel.overview();
    openModal('Project Overview', `<pre style="font-size:12px">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`);
  } },

  { id: 'flow.preview', label: 'Run: Start Live Preview', icon: '▶', run: () => openBottomPanel('preview') },
  { id: 'flow.deploy', label: 'Deploy: Choose Target…', icon: '🚀', run: () => setActiveView('deploy') },
  { id: 'flow.database', label: 'Tools: Database Browser…', icon: '🗄', run: () => setActiveView('database') },
  { id: 'flow.api', label: 'Tools: API Client…', icon: '🔌', run: openApiClient },
  { id: 'flow.terminal', label: 'Terminal: Run Command', icon: '❯', cmd: '⌘J', run: () => openBottomPanel('terminal') },
  { id: 'git.panel', label: 'Source Control: Show Panel', icon: '⑂', run: () => setActiveView('git') },
  { id: 'git.refresh', label: 'Source Control: Refresh', icon: '⟳', run: refreshGitStatus },
  { id: 'help.github', label: 'Help: Glint on GitHub', icon: '⭐', run: () => window.open('https://github.com/mailsitnc-ai/glint') },
];

function openPalette() {
  dom.paletteOverlay.classList.add('open');
  dom.paletteInput.value = '';
  filterPalette('');
  setTimeout(() => dom.paletteInput.focus(), 30);
}

function closePalette() {
  dom.paletteOverlay.classList.remove('open');
}

function filterPalette(query) {
  const q = query.trim().toLowerCase();
  state.paletteItems = q ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : COMMANDS.slice();
  state.paletteIndex = 0;
  renderPalette();
}

function renderPalette() {
  if (!state.paletteItems.length) {
    dom.paletteList.innerHTML = '<div class="palette-empty">No matching commands</div>';
    return;
  }
  dom.paletteList.innerHTML = '';
  state.paletteItems.forEach((cmd, i) => {
    const div = document.createElement('div');
    div.className = 'palette-item' + (i === state.paletteIndex ? ' selected' : '');
    div.innerHTML = `<span class="ico">${cmd.icon || '›'}</span><span>${escapeHtml(cmd.label)}</span>${cmd.cmd ? `<span class="cmd">${cmd.cmd}</span>` : ''}`;
    div.onclick = () => {
      closePalette();
      cmd.run();
    };
    dom.paletteList.appendChild(div);
  });
}

/* ------------------------------------------------------------------ */
/* AI actions                                                          */
/* ------------------------------------------------------------------ */

async function aiExplain() {
  const tab = editor.activeTab;
  if (!tab) return toast('Open a file first', true);
  const selection = dom.input.value.slice(dom.input.selectionStart, dom.input.selectionEnd);
  const result = await ai.explain(selection || dom.input.value, tab.name);
  if (!result.ok) return toast(result.error || 'AI request failed', true);
  state.chatMessages.push({ role: 'assistant', content: result.text });
  setActiveView('ai');
  renderChat();
}

async function aiRefactor() {
  const tab = editor.activeTab;
  if (!tab) return toast('Open a file first', true);
  const selection = dom.input.value.slice(dom.input.selectionStart, dom.input.selectionEnd) || dom.input.value;
  openModal('AI Refactor', `
    <div class="field full"><label>Goal</label>
      <input class="glass-input" id="refactorGoal" value="make this faster and more readable" /></div>
    <div class="btn-row"><button class="btn primary" id="refactorGo">Refactor</button></div>
    <div id="refactorOutput" style="margin-top:12px"></div>
  `, (body) => {
    body.querySelector('#refactorGo').onclick = async () => {
      const out = body.querySelector('#refactorOutput');
      out.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Refactoring…</div>';
      const result = await ai.refactor(selection, body.querySelector('#refactorGoal').value, tab.name);
      if (!result.ok) {
        out.innerHTML = `<div style="color:#fca5a5;font-size:12px">${escapeHtml(result.error)}</div>`;
        return;
      }
      out.innerHTML = `<pre style="font-size:11.5px;max-height:260px;overflow:auto">${escapeHtml(result.text)}</pre>
        <div class="btn-row"><button class="btn primary" id="refactorApply">Apply to editor</button></div>`;
      out.querySelector('#refactorApply').onclick = () => {
        editor.setContent(result.text);
        closeModal();
        toast('Refactor applied');
      };
    };
  });
}

async function aiDocstring() {
  const tab = editor.activeTab;
  if (!tab) return toast('Open a file first', true);
  const selection = dom.input.value.slice(dom.input.selectionStart, dom.input.selectionEnd) || dom.input.value;
  const result = await ai.docstring(selection, tab.language);
  if (!result.ok) return toast(result.error || 'Could not generate documentation', true);
  openModal('Generated Documentation', `
    <pre style="font-size:12px">${escapeHtml(result.text)}</pre>
    <div class="btn-row"><button class="btn primary" id="docApply">Insert above selection</button></div>
  `, (body) => {
    body.querySelector('#docApply').onclick = () => {
      const pos = dom.input.selectionStart;
      const value = dom.input.value;
      const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
      const indent = value.slice(lineStart).match(/^\s*/)?.[0] || '';
      const doc = result.text.split('\n').map((l) => indent + l).join('\n');
      editor.setContent(value.slice(0, lineStart) + doc + '\n' + value.slice(lineStart));
      closeModal();
      toast('Documentation inserted');
    };
  });
}

async function aiCommitMessage() {
  const result = await ai.commitMessage();
  if (!result.ok) return toast(result.error || 'Could not generate a commit message', true);
  openModal('AI Commit Message', `
    <div class="field full"><label>Generated message</label>
      <input class="glass-input" id="commitMessageInput" value="${escapeHtml(result.message)}" /></div>
    <div class="btn-row"><button class="btn primary" id="commitApply">Use Message</button></div>
  `, (body) => {
    body.querySelector('#commitApply').onclick = async () => {
      const message = body.querySelector('#commitMessageInput').value;
      const committed = await api.gitCommit(message);
      if (committed.ok) {
        toast('Committed');
        closeModal();
        refreshGitStatus();
      } else {
        toast(committed.error || 'Commit failed', true);
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Toggles                                                             */
/* ------------------------------------------------------------------ */

async function toggleZen() {
  await themeManager.update({ zenMode: !themeManager.settings.zenMode });
  toast(themeManager.settings.zenMode ? 'Zen mode on' : 'Zen mode off');
}

async function toggleLiquid() {
  await themeManager.enableLiquidMode(!themeManager.settings.liquidMode);
  toast(themeManager.settings.liquidMode ? 'Liquid mode on' : 'Liquid mode off');
}

function openSettings() {
  dom.settingsPanel.classList.add('open');
  renderSettingsPanel();
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

// The editor engine owns the input handling and highlight layer rendering.

// Activity bar
document.querySelectorAll('.activitybar .act').forEach((btn) => {
  btn.onclick = () => setActiveView(btn.dataset.view);
});

// Toolbar
$('btnOpenFolder').onclick = openFolder;
$('btnPalette').onclick = openPalette;
$('btnSettings').onclick = openSettings;
$('btnZen').onclick = toggleZen;
$('btnLiquid').onclick = toggleLiquid;
$('btnMinimize').onclick = () => api.minimize();
$('btnMaximize').onclick = () => api.toggleMaximize();
$('btnClose').onclick = () => api.close();
$('btnRefreshTree').onclick = async () => {
  if (!state.workspace) return;
  const tree = await api.getTree(state.workspace.path);
  state.workspace.tree = tree;
  renderSidebar();
  toast('Refreshed');
};

// Find bar
dom.findInput.addEventListener('input', runFind);
dom.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.findNext(e.shiftKey ? -1 : 1);
    dom.matchCount.textContent = `${editor.findIndex + 1} of ${editor.findMatches.length}`;
  } else if (e.key === 'Escape') {
    toggleFindBar(false);
  }
});
$('findNext').onclick = () => {
  editor.findNext(1);
  dom.matchCount.textContent = `${editor.findIndex + 1} of ${editor.findMatches.length}`;
};
$('findPrev').onclick = () => {
  editor.findNext(-1);
  dom.matchCount.textContent = `${editor.findIndex + 1} of ${editor.findMatches.length}`;
};
$('findClose').onclick = () => toggleFindBar(false);
$('findReplaceToggle').onclick = () => {
  state.replaceMode = !state.replaceMode;
  dom.replaceInput.style.display = state.replaceMode ? '' : 'none';
  $('replaceOne').style.display = state.replaceMode ? '' : 'none';
  $('replaceAll').style.display = state.replaceMode ? '' : 'none';
  if (state.replaceMode) dom.replaceInput.focus();
};
$('replaceOne').onclick = () => {
  editor.replaceCurrent(dom.replaceInput.value);
  runFind();
};
$('replaceAll').onclick = () => {
  const count = editor.replaceAll(dom.findInput.value, dom.replaceInput.value);
  runFind();
  toast(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
};

// Palette
dom.paletteInput.addEventListener('input', (e) => filterPalette(e.target.value));
dom.paletteInput.addEventListener('keydown', (e) => {
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
    const cmd = state.paletteItems[state.paletteIndex];
    if (cmd) {
      closePalette();
      cmd.run();
    }
  } else if (e.key === 'Escape') {
    closePalette();
  }
});
dom.paletteOverlay.addEventListener('click', (e) => {
  if (e.target === dom.paletteOverlay) closePalette();
});
dom.modalOverlay.addEventListener('click', (e) => {
  if (e.target === dom.modalOverlay) closeModal();
});
$('modalClose').onclick = closeModal;

// Panel tabs
document.querySelectorAll('.panel-tab').forEach((tab) => {
  tab.onclick = () => {
    state.activePanel = tab.dataset.panel;
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderPanel(tab.dataset.panel);
  };
});

// AI panel
$('aiClose').onclick = () => dom.aiPanel.classList.remove('open');
$('chatSend').onclick = sendChat;
$('chatAttach').onclick = () => {
  state.attachContext = !state.attachContext;
  $('chatAttach').textContent = state.attachContext ? 'Attached' : 'Attach';
  $('chatContextLabel').textContent = state.attachContext
    ? editor.activeTab?.name || 'No file'
    : 'No context';
};
dom.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
document.querySelectorAll('.ai-suggestion').forEach((chip) => {
  chip.onclick = () => {
    dom.chatInput.value = chip.dataset.prompt;
    sendChat();
  };
});
$('aiConfigBtn').onclick = openSettings;

// Settings / marketplace panels
$('settingsClose').onclick = () => dom.settingsPanel.classList.remove('open');
$('marketClose').onclick = () => dom.marketPanel.classList.remove('open');

// Menu commands
api.onMenuCommand((command) => {
  switch (command) {
    case 'save': saveActiveFile(false); break;
    case 'save-as': saveActiveFile(true); break;
    case 'undo': document.execCommand('undo'); break;
    case 'redo': document.execCommand('redo'); break;
    case 'cut': document.execCommand('cut'); break;
    case 'copy': document.execCommand('copy'); break;
    case 'paste': document.execCommand('paste'); break;
    case 'select-all': dom.input.select(); break;
    case 'find': toggleFindBar(true); break;
    case 'replace': toggleFindBar(true, true); break;
    case 'command-palette': openPalette(); break;
    case 'toggle-sidebar': dom.sidebar.classList.toggle('collapsed'); break;
    case 'toggle-panel': state.bottomPanelOpen ? closeBottomPanel() : openBottomPanel('problems'); break;
    case 'toggle-zen': toggleZen(); break;
    case 'toggle-liquid': toggleLiquid(); break;
    case 'settings': openSettings(); break;
    case 'theme-marketplace': openMarketplace(); break;
    case 'toggle-ai': setActiveView('ai'); break;
    case 'ai-settings': openSettings(); break;
    case 'toggle-ghost-text': themeManager.update({ aiGhostText: !themeManager.settings.aiGhostText }); break;
    case 'ai-health': async () => {
      const result = await ai.healthCheck();
      toast(result.ok ? `Provider ready: ${result.reply}` : result.error || 'Provider unreachable', !result.ok);
    }; break;
    case 'ai-explain': aiExplain(); break;
    case 'ai-refactor': aiRefactor(); break;
    case 'ai-docstring': aiDocstring(); break;
    case 'ai-commit-message': aiCommitMessage(); break;
    case 'collab-start': setActiveView('collab'); break;
    case 'collab-join': setActiveView('collab'); break;
    case 'collab-stop': collab.stop(); break;
    case 'toggle-voice': toast('Voice chat uses the system microphone — see Collaboration panel'); break;
    case 'semantic-search': setActiveView('search'); break;
    case 'dead-code': openBottomPanel('deadcode'); break;
    case 'test-impact': openBottomPanel('impact'); break;
    case 'preview-start': workflow.startPreview(); break;
    case 'preview-stop': workflow.stopPreview(); break;
    case 'deploy': setActiveView('deploy'); break;
    case 'database': setActiveView('database'); break;
    case 'api-client': openApiClient(); break;
    default: break;
  }
});

// Events from main
api.onWorkspaceOpened((payload) => applyWorkspace(payload));

api.onFileOpened(async (payload) => {
  await openFileAtPath(payload.path, payload.name, payload.content);
});

api.onSettingsChanged((settings) => {
  themeManager.settings = { ...themeManager.settings, ...settings };
  themeManager.apply();
});

api.onFileChanged(async ({ path: filePath }) => {
  const tab = editor.tabs.find((t) => t.path === filePath);
  if (!tab) return;
  if (!tab.dirty) {
    const result = await api.readFile(filePath);
    if (result.ok) {
      tab.content = result.content;
      tab._lines = null;
      if (editor.activeTab === tab) editor.render();
      toast(`Reloaded ${tab.name}`);
    }
  } else {
    toast(`${tab.name} changed on disk`);
  }
});

api.onWorkspaceChanged(async (event) => {
  if (!state.workspace || !event?.path) return;
  if (event.type === 'directory') {
    const tree = await api.getTree(state.workspace.path);
    state.workspace.tree = tree;
    renderSidebar();
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  await themeManager.init();
  await workflow.init();
  await ai.init();
  renderSettingsPanel();
  renderSidebar();
  editor.render();

  try {
    state.recent = await api.getRecent();
    renderSidebar();
  } catch {
    /* ignore */
  }

  refreshGitStatus();
  console.log('[glint] renderer booted');
}

boot();
