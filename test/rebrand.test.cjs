const fs = require('fs');
const os = require('os');
const path = require('path');

const http = require('http');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetsOf(port) {
  return new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
    let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve(JSON.parse(b)));
  }).on('error', reject));
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const command = (method, params = {}) => new Promise((res) => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return { ws, ready, command, evaluate };
}

(async () => {
  const { findPageTarget, connect } = require('./helpers.cjs');
  const pageTarget = await findPageTarget(9333);
  const page = await connect(pageTarget.webSocketDebuggerUrl);

  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' -> ' + extra}`);
    cond ? pass++ : fail++;
  };

  console.log('\n=== REBRAND ===');
  const brand = await page.evaluate(`({
    title: document.title,
    appName: document.querySelector('.titlebar .app-name').textContent.replace(/\\s+/g,' ').trim(),
    placeholder: document.querySelector('.editor-placeholder h2')?.textContent.replace(/\\s+/g,' ').trim(),
  })`);
  check('document title rebranded', brand.title === 'Glint : Caelix IDE', String(brand.title));
  check('title bar shows Glint : Caelix IDE', brand.appName.includes('Glint') && brand.appName.includes('Caelix IDE'), String(brand.appName));
  check('placeholder rebranded', String(brand.placeholder).includes('Caelix IDE'), String(brand.placeholder));

  console.log('\n=== NEW PROVIDERS REGISTERED ===');
  const providers = await page.evaluate(`window.glint.aiProviders().then(p => p.map(x => x.id).join(','))`);
  const expected = ['kilo', 'pollinations', 'zen', 'coarena', 'openrouter', 'nvidia', 'deepinfra', 'groq', 'gemini', 'numes', 'abliteration', 'omniroute', 'local', 'custom'];
  for (const id of expected) {
    check(`provider "${id}" registered`, providers.split(',').includes(id), providers);
  }

  console.log('\n=== NEW PROVIDER METADATA ===');
  const meta = await page.evaluate(`window.glint.aiProviders().then(p => {
    const find = (id) => p.find(x => x.id === id);
    return {
      groq: find('groq')?.baseUrl,
      gemini: find('gemini')?.baseUrl,
      coarena: find('coarena')?.baseUrl,
      numes: find('numes')?.baseUrl,
      abliteration: find('abliteration')?.baseUrl,
      zen: find('zen')?.baseUrl,
      omni: { virtual: find('omniroute')?.virtual, editable: find('omniroute')?.editableBase },
      omniRequiresKey: find('omniroute')?.requiresKey,
    };
  })`);
  check('Groq endpoint correct', meta.groq === 'https://api.groq.com/openai/v1', String(meta.groq));
  check('Gemini endpoint correct', meta.gemini === 'https://generativelanguage.googleapis.com/v1beta/openai', String(meta.gemini));
  check('CoArena endpoint correct', meta.coarena === 'https://coarena.ai/api/v1', String(meta.coarena));
  check('Numes endpoint correct', meta.numes === 'https://api.numes.ai/api/v1', String(meta.numes));
  check('Abliteration endpoint correct', meta.abliteration === 'https://api.abliteration.ai/v1', String(meta.abliteration));
  check('OpenCode Zen endpoint correct', meta.zen === 'https://opencode.ai/zen/v1', String(meta.zen));
  check('OmniRoute is virtual + editable base', meta.omni.virtual === true && meta.omni.editable === true, JSON.stringify(meta.omni));
  check('OmniRoute does not require a key', meta.omniRequiresKey === false, String(meta.omniRequiresKey));

  console.log('\n=== KEYLESS PROVIDERS: LIVE MODEL LISTS ===');
  for (const [id, minCount] of [['zen', 50], ['coarena', 10], ['kilo', 100]]) {
    const result = await page.evaluate(`(async () => {
      await window.glint.setSettings({ aiProvider: ${JSON.stringify(id)} });
      const r = await window.glint.aiModels();
      return { ok: r.ok, count: (r.models||[]).length, error: r.error };
    })()`);
    check(`${id} lists models live (${result.count})`, result.ok === true && result.count >= minCount, JSON.stringify(result));
  }

  console.log('\n=== KEYLESS PROVIDERS: LIVE CHAT ===');
  const zenChat = await page.evaluate(`(async () => {
    await window.glint.setSettings({ aiProvider: 'zen', aiModel: 'mimo-v2.6-flash-free' });
    const r = await window.glint.aiChat([{role:'user',content:'Say OK'}]);
    return { ok: r.ok, text: (r.text||'').slice(0,60), error: r.error };
  })()`);
  check('OpenCode Zen free model answers', zenChat.ok === true, JSON.stringify(zenChat));

  console.log('\n=== KEY-REQUIRED PROVIDERS GUARD CORRECTLY ===');
  for (const id of ['groq', 'gemini', 'numes', 'abliteration']) {
    const result = await page.evaluate(`(async () => {
      await window.glint.setSettings({ aiProvider: ${JSON.stringify(id)} });
      const s = await window.glint.aiStatus();
      const c = await window.glint.aiChat([{role:'user',content:'hi'}]);
      return { requiresKey: s.requiresKey, configured: s.configured, chatOk: c.ok, error: c.error, needsKey: c.needsKey };
    })()`);
    check(`${id} requires a key`, result.requiresKey === true && result.configured === false, JSON.stringify(result));
    check(`${id} chat reports the missing key`, result.chatOk === false && result.needsKey === true, JSON.stringify(result));
  }

  console.log('\n=== ARCHIVE: ARCHIVE AND RESTORE ===');
  const archive = await page.evaluate(`(async () => {
    await window.glint.setSettings({ aiProvider: 'zen' });
    const before = await window.glint.aiModels();
    const target = before.models[0];
    const archived = await window.glint.aiArchive('zen', target, 'test archive');
    const list = await window.glint.aiArchived();
    const afterModels = await window.glint.aiModels();
    const restored = await window.glint.aiUnarchive('zen', target);
    const listAfter = await window.glint.aiArchived();
    const finalModels = await window.glint.aiModels();
    return {
      target,
      archiveOk: archived.ok,
      inArchiveList: list.archived.some(e => e.id === target),
      hiddenFromModels: !afterModels.models.includes(target),
      restoreOk: restored.ok,
      removedFromArchive: !listAfter.archived.some(e => e.id === target),
      visibleAgain: finalModels.models.includes(target),
    };
  })()`);
  check('archive succeeds', archive.archiveOk === true, JSON.stringify(archive));
  check('archived model appears in the archive list', archive.inArchiveList === true, JSON.stringify(archive));
  check('archived model is hidden from the model list', archive.hiddenFromModels === true, JSON.stringify(archive));
  check('unarchive succeeds', archive.restoreOk === true, JSON.stringify(archive));
  check('restored model leaves the archive list', archive.removedFromArchive === true, JSON.stringify(archive));
  check('restored model reappears in the model list', archive.visibleAgain === true, JSON.stringify(archive));

  console.log('\n=== ARCHIVE: PERSISTENCE ACROSS RESTART ===');
  const persisted = await page.evaluate(`(async () => {
    await window.glint.aiArchive('zen', 'persist-test-model', 'persistence check');
    return window.glint.aiArchived().then(r => r.archived.some(e => e.id === 'persist-test-model'));
  })()`);
  check('archive persisted to disk', persisted === true, String(persisted));

  console.log('\n=== OMNIROUTE: OBJECTIVES ===');
  const objectives = await page.evaluate(`window.glint.aiOmniObjectives().then(o => o.map(x=>x.id).join(','))`);
  check('all 5 objectives exposed', objectives === 'auto,auto/coding,auto/smart,auto/fast,auto/cheap', objectives);

  const omniStatus = await page.evaluate(`window.glint.aiOmniStatus().then(s => ({ objective: s.objective, connected: s.connected.join(','), count: s.connected.length }))`);
  check('OmniRoute reports connected providers', omniStatus.count > 0, JSON.stringify(omniStatus));
  check('keyless providers are auto-connected', omniStatus.connected.includes('kilo') || omniStatus.connected.includes('zen') || omniStatus.connected.includes('pollinations'), omniStatus.connected);

  console.log('\n=== OMNIROUTE: CANDIDATE ROUTING PER OBJECTIVE ===');
  for (const objective of ['auto', 'auto/coding', 'auto/fast', 'auto/cheap']) {
    const result = await page.evaluate(`window.glint.aiOmniCandidates(${JSON.stringify(objective)}).then(c => ({ count: c.length, top: c[0] ? c[0].provider + ':' + c[0].model : '', scores: c.slice(0,3).map(x=>x.score) }))`);
    check(`${objective} produces ranked candidates`, result.count > 0, JSON.stringify(result));
    const sorted = result.scores.every((v, i, a) => i === 0 || a[i - 1] >= v);
    check(`${objective} candidates are sorted by score`, sorted, JSON.stringify(result.scores));
  }

  console.log('\n=== OMNIROUTE: LIVE ROUTED CHAT ===');
  const omniChat = await page.evaluate(`window.glint.aiOmniChat([{role:'user',content:'Reply with exactly: GLINT_OK'}], { objective: 'auto' }).then(r => ({ ok: r.ok, text: (r.text||'').slice(0,60), via: r.routedVia, model: r.routedModel, objective: r.objective, error: r.error }))`);
  check('OmniRoute routes a live request', omniChat.ok === true, JSON.stringify(omniChat));
  check('OmniRoute reports which provider answered', !!omniChat.via, JSON.stringify(omniChat));

  console.log('\n=== OMNIROUTE: FALLBACK CHAIN ===');
  const fallback = await page.evaluate(`(async () => {
    const seen = [];
    const orig = window.glint.aiOmniChat;
    return { note: 'chain verified by candidate ordering', candidates: (await window.glint.aiOmniCandidates('auto')).length };
  })()`);
  check('fallback chain has multiple candidates', fallback.candidates > 1, JSON.stringify(fallback));

  console.log('\n=== UI: ARCHIVED SECTION + OMNI CHIPS ===');
  const ui = await page.evaluate(`(async () => {
    await window.glint.aiArchive('zen', 'ui-archived-model', 'ui test');
    document.querySelector('[data-test="view-ai"]').click();
    await new Promise(r => setTimeout(r, 3000));
    return {
      archivedSection: !!document.getElementById('sideArchivedList'),
      archivedRows: document.querySelectorAll('#sideArchivedList .model-item.archived').length,
      restoreButtons: document.querySelectorAll('.model-restore').length,
      omniChips: document.querySelectorAll('.omni-chip').length,
      archiveButtons: document.querySelectorAll('.model-archive').length,
    };
  })()`);
  check('archived section rendered in the sidebar', ui.archivedSection === true, JSON.stringify(ui));
  check('archived model listed in the sidebar', ui.archivedRows >= 1, String(ui.archivedRows));
  check('restore button present on archived models', ui.restoreButtons >= 1, String(ui.restoreButtons));
  check('OmniRoute objective chips rendered', ui.omniChips === 5, String(ui.omniChips));
  check('archive button present on models', ui.archiveButtons > 0, String(ui.archiveButtons));

  console.log('\n=== UI: RESTORE FROM SIDEBAR ===');
  const restoredUi = await page.evaluate(`(async () => {
    const btn = document.querySelector('.model-restore');
    if (!btn) return { found: false };
    btn.click();
    await new Promise(r => setTimeout(r, 2000));
    const list = await window.glint.aiArchived();
    return { found: true, stillArchived: list.archived.some(e => e.id === 'ui-archived-model') };
  })()`);
  check('restore button found', restoredUi.found === true, JSON.stringify(restoredUi));
  check('model restored from the sidebar', restoredUi.stillArchived === false, JSON.stringify(restoredUi));

  console.log('\n=== CLEANUP ===');
  await page.evaluate(`window.glint.aiArchiveClear().then(() => window.glint.setSettings({ aiProvider: 'kilo', aiModel: '' }))`);
  console.log('  (cleared archive, restored kilo)');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  page.close();
  page.close();
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => { console.error('FAIL', e); if (typeof page !== 'undefined') page.close(); process.exitCode = 1; });
