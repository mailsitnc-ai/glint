const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-core-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'function calculateTotal(items) {\n  return items.reduce((a, b) => a + b, 0);\n}\n\nconst unusedHelper = () => 42;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n\nA test project.\n');
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'app.test.js'), "import { calculateTotal } from '../app.js';\n\ntest('totals', () => {\n  expect(calculateTotal([1,2])).toBe(3);\n});\n");
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'util.py'), 'def unused_function():\n    return 1\n\ndef used_function():\n    return 2\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'testproj', version: '1.0.0' }, null, 2));

  const { findPageTarget, connect } = require('./helpers.cjs');
  const pageTarget = await findPageTarget(9333);
  const page = await connect(pageTarget.webSocketDebuggerUrl);

  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' -> ' + extra}`);
    cond ? pass++ : fail++;
  };

  console.log('\n=== UI STRUCTURE ===');
  const views = await page.evaluate(`Array.from(document.querySelectorAll('.activitybar .act')).map(b=>b.dataset.view).join(',')`);
  check('activity bar has all views', views === 'explorer,search,git,collab,deploy,database,api,marketplace,ai', views);
  const panelTabs = await page.evaluate(`Array.from(document.querySelectorAll('.panel-tab')).map(b=>b.dataset.panel).join(',')`);
  check('bottom panel has all tabs', panelTabs === 'problems,output,terminal,preview,deadcode,impact', panelTabs);

  console.log('\n=== WORKSPACE + EDITOR ===');
  const opened = await page.evaluate(`window.glint.openPath(${JSON.stringify(dir)}).then(p => p.name)`);
  check('workspace opened', opened === path.basename(dir), String(opened));
  await wait(900);
  // Switch back to the Explorer view so the tree is visible.
  await page.evaluate(`document.querySelector('[data-test="view-explorer"]').click()`);
  await wait(600);
  const treeNames = await page.evaluate(`Array.from(document.querySelectorAll('.tree-item .name')).map(n=>n.textContent).join(',')`);
  check('explorer shows project files', String(treeNames).includes('app.js'), String(treeNames));

  await page.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.tree-item'));
    const t = items.find(i => i.querySelector('.name')?.textContent === 'app.js');
    if (t) t.click();
    return true;
  })()`);
  await wait(800);
  const tabName = await page.evaluate(`document.querySelector('.tab .tab-name')?.textContent || ''`);
  check('file opens in a tab', tabName === 'app.js', String(tabName));
  const kw = await page.evaluate(`document.querySelectorAll('#highlightCode .tk-keyword').length`);
  check('syntax highlighting active', kw >= 2, String(kw));
  const gutter = await page.evaluate(`document.querySelectorAll('.gutter .ln').length`);
  check('line numbers rendered', gutter === 6, String(gutter));

  console.log('\n=== TERMINAL ===');
  const term = await page.evaluate(`(async () => {
    document.querySelector('.panel-tab[data-panel="terminal"]').click();
    await new Promise(r => setTimeout(r, 400));
    const input = document.getElementById('terminalInput');
    input.value = 'echo core-works';
    document.getElementById('terminalRun').click();
    await new Promise(r => setTimeout(r, 2500));
    return {
      panelOpen: document.getElementById('bottomPanel').classList.contains('open'),
      output: document.getElementById('terminalOutput').textContent,
    };
  })()`);
  check('terminal panel opens', term.panelOpen === true, JSON.stringify(term).slice(0, 100));
  check('terminal runs commands', String(term.output).includes('core-works'), JSON.stringify(term).slice(0, 160));

  console.log('\n=== INTELLIGENCE ===');
  const search = await page.evaluate(`window.glint.semanticSearch('calculate total sum').then(r => ({ count: r.results.length, first: r.results[0]?.file }))`);
  check('semantic search returns results', search.count > 0, JSON.stringify(search));
  const dead = await page.evaluate(`window.glint.findDeadCode().then(r => ({ count: r.dead.length, names: r.dead.map(d=>d.name).join(',') }))`);
  check('dead code detected', dead.count > 0 && String(dead.names).includes('unusedHelper'), JSON.stringify(dead));
  const impact = await page.evaluate(`window.glint.testImpact([]).then(r => ({ tests: r.testFileCount, covered: r.impacts.filter(i=>i.affectedTests.length).length }))`);
  check('test impact analysis works', impact.tests >= 1 && impact.covered >= 1, JSON.stringify(impact));
  const doc = await page.evaluate(`window.glint.localDocstring('function add(a, b) { return a + b; }', 'JavaScript')`);
  check('docstring generated locally', doc.ok === true && doc.text.includes('@param'), JSON.stringify(doc).slice(0, 100));

  console.log('\n=== AI PROVIDER HANDLING ===');
  const aiStatus = await page.evaluate(`window.glint.aiStatus()`);
  check('AI status reports a provider', aiStatus && typeof aiStatus.configured === 'boolean', JSON.stringify(aiStatus).slice(0, 120));
  const aiNoKey = await page.evaluate(`(async () => {
    await window.glint.setSettings({ aiProvider: 'groq', groqKey: '' });
    const r = await window.glint.aiChat([{role:'user',content:'hi'}]);
    await window.glint.setSettings({ aiProvider: 'kilo' });
    return { ok: r.ok, error: r.error };
  })()`);
  check('AI errors gracefully without a key', aiNoKey.ok === false && !!aiNoKey.error, JSON.stringify(aiNoKey));
  const aiFallback = await page.evaluate(`window.glint.aiDocstring({ code: 'function x(){return 1}', language: 'JavaScript' }).then(r => ({ ok: r.ok, local: r.local }))`);
  check('docstring falls back to local generator', aiFallback.ok === true, JSON.stringify(aiFallback));

  console.log('\n=== COLLABORATION ===');
  const collab = await page.evaluate(`window.glint.collabStart({ workspacePath: ${JSON.stringify(dir)} }).then(r => ({ ok: r.ok, port: r.port, error: r.error }))`);
  check('collaboration session starts', collab.ok === true && collab.port > 0, JSON.stringify(collab));
  const stopped = await page.evaluate(`window.glint.collabStop().then(r => r.ok)`);
  check('collaboration session stops', stopped === true, String(stopped));

  console.log('\n=== WORKFLOW ===');
  const apiResult = await page.evaluate(`window.glint.apiRequest({ method: 'GET', url: 'https://api.github.com/zen' }).then(r => ({ ok: r.ok, status: r.status, hasStatus: typeof r.status === 'number' }))`);
  check('API client performs a real request', apiResult.hasStatus === true, JSON.stringify(apiResult));
  const targets = await page.evaluate(`window.glint.deployTargets().then(t => t.map(x=>x.id).join(','))`);
  check('deploy targets listed', targets.includes('vercel') && targets.includes('github'), targets);
  const dbBad = await page.evaluate(`window.glint.dbConnect('not-a-db').then(r => ({ ok: r.ok, error: r.error }))`);
  check('database rejects bad connection strings', dbBad.ok === false && !!dbBad.error, JSON.stringify(dbBad));

  console.log('\n=== UI MODES ===');
  const zen = await page.evaluate(`(async () => {
    document.getElementById('btnZen').click();
    await new Promise(r => setTimeout(r, 400));
    const on = document.body.classList.contains('zen-mode');
    document.getElementById('btnZen').click();
    await new Promise(r => setTimeout(r, 400));
    return { on, off: !document.body.classList.contains('zen-mode') };
  })()`);
  check('zen mode toggles on and off', zen.on === true && zen.off === true, JSON.stringify(zen));

  const ambient = await page.evaluate(`window.glint.ambientTint()`);
  check('ambient tint computed', ambient && /^#[0-9a-f]{6}$/i.test(ambient.color), JSON.stringify(ambient));

  console.log('\n=== COMMAND PALETTE ===');
  const palette = await page.evaluate(`(async () => {
    document.querySelector('[data-test="open-palette"]').click();
    await new Promise(r => setTimeout(r, 200));
    const input = document.getElementById('paletteInput');
    input.value = 'dead code';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const items = Array.from(document.querySelectorAll('.palette-item')).map(i=>i.textContent);
    document.getElementById('paletteOverlay').classList.remove('open');
    return items;
  })()`);
  check('command palette filters commands', palette.some((t) => t.includes('Dead Code')), JSON.stringify(palette));

  console.log('\n=== GIT ===');
  const git = await page.evaluate(`window.glint.gitStatus().then(r => ({ ok: r.ok, isRepo: r.isRepo }))`);
  check('git status handles non-repo gracefully', git.ok === false && git.isRepo === false, JSON.stringify(git));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  fs.rmSync(dir, { recursive: true, force: true });
  page.close();
  page.close();
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error('FAIL', e); if (typeof page !== 'undefined') page.close(); process.exitCode = 1; });
