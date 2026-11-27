/**
 * Shared helpers for the Glint end-to-end tests.
 *
 * Design notes:
 *  - Elements are located through `data-test` attributes first, falling back
 *    to legacy ids/classes. That way a markup refactor only needs one place
 *    updated, and the tests keep working if an id changes.
 *  - Every connection is registered so it can be closed on the way out, so a
 *    failing assertion never leaves a socket (or the Electron app) hanging.
 */

const http = require('node:http');

const DEFAULT_PORT = Number(process.env.GLINT_DEBUG_PORT || 9333);

/** Query the DevTools target list for a given debugging port. */
async function listTargets(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Could not parse DevTools target list: ${err.message}`));
        }
      });
    });
    req.on('error', (err) =>
      reject(new Error(`Could not reach the app on port ${port}: ${err.message}. Is Glint running with --remote-debugging-port=${port}?`)),
    );
    req.setTimeout(5000, () => req.destroy(new Error('DevTools target list request timed out')));
  });
}

/** Find the renderer page target. */
async function findPageTarget(port = DEFAULT_PORT) {
  const targets = await listTargets(port);
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    throw new Error(`No renderer page target found. Targets: ${targets.map((t) => `${t.type}:${t.title}`).join(', ') || 'none'}`);
  }
  return page;
}

/**
 * Connect to a DevTools target.
 * Returns a client with `evaluate`, `command`, and a `close()` that is safe
 * to call more than once.
 */
async function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  let closed = false;
  const pending = new Map();

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const resolver = pending.get(msg.id);
    if (resolver) {
      pending.delete(msg.id);
      resolver(msg);
    }
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connection failed'));
    };
  });

  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('Socket is closed'));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command "${method}" timed out`));
      }, 30000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  /** Evaluate an expression in the page and return its value. */
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.exceptionDetails) {
      const detail = result.result.exceptionDetails;
      throw new Error(detail.exception?.description || detail.text || 'Evaluation failed');
    }
    return result.result?.result?.value;
  }

  /** Close the socket cleanly. Safe to call repeatedly. */
  function close() {
    if (closed) return;
    closed = true;
    for (const resolver of pending.values()) resolver({ result: {} });
    pending.clear();
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  }

  ws.onclose = () => {
    closed = true;
    pending.clear();
  };

  await ready;
  return { ws, command, evaluate, close, get isClosed() { return closed; } };
}

/**
 * Resolve a selector using the stable data-test attribute first, then the
 * supplied fallback selectors. Returns null when nothing matches.
 */
const SELECTOR_FALLBACKS = {
  root: ['[data-test="root"]', '#root'],
  sidebar: ['[data-test="sidebar"]', '#sidebar'],
  gutter: ['[data-test="gutter"]', '#gutter'],
  'code-wrap': ['[data-test="code-wrap"]', '#codeWrap'],
  'editor-input': ['[data-test="editor-input"]', '#editorInput'],
  grain: ['[data-test="grain"]', '.grain'],
  'open-settings': ['[data-test="open-settings"]', '#btnSettings'],
  'open-palette': ['[data-test="open-palette"]', '#btnPalette'],
  'open-folder': ['[data-test="open-folder"]', '#btnOpenFolder'],
  'view-ai': ['[data-test="view-ai"]', '.act[data-view="ai"]'],
  explorer: ['[data-test="view-explorer"]', '.act[data-view="explorer"]'],
};

/** Build a JS expression that finds the first matching selector. */
function selectorExpr(key, extra = '') {
  const list = SELECTOR_FALLBACKS[key] || [key];
  const arr = JSON.stringify(list);
  return `(() => {
    const candidates = ${arr}${extra ? `, ${JSON.stringify(extra)}` : ''};
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  })()`;
}

/** Small assertion helpers with pass/fail counters. */
function createReporter() {
  const state = { pass: 0, fail: 0 };
  return {
    state,
    check(name, condition, extra = '') {
      if (condition) {
        console.log(`  PASS  ${name}`);
        state.pass++;
      } else {
        console.log(`  FAIL  ${name}${extra ? ' -> ' + extra : ''}`);
        state.fail++;
      }
      return Boolean(condition);
    },
    section(title) {
      console.log(`\n=== ${title} ===`);
    },
    finish() {
      console.log(`\n=== RESULT: ${state.pass} passed, ${state.fail} failed ===\n`);
      return state.fail === 0;
    },
  };
}

/**
 * Run a test body with guaranteed cleanup.
 * The WebSocket is always closed, even when the body throws.
 */
async function withPage(fn, port = DEFAULT_PORT) {
  let client = null;
  try {
    const target = await findPageTarget(port);
    client = await connect(target.webSocketDebuggerUrl);
    return await fn(client);
  } finally {
    if (client) client.close();
  }
}

module.exports = {
  DEFAULT_PORT,
  listTargets,
  findPageTarget,
  connect,
  selectorExpr,
  createReporter,
  withPage,
};
