const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/**
 * Workflow service: live preview, deployments, database browser and an
 * embedded API client. Everything runs locally; deployments talk to the
 * provider's official API using a user-supplied token.
 */
class WorkflowService {
  constructor(settings) {
    this.settings = settings;
    this.previewProcess = null;
    this.previewPort = 0;
    this.previewLog = [];
    this.onPreviewOutput = () => {};
  }

  /* ------------------------------------------------------------------ */
  /* Live preview                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Detect how the project can be previewed and start it.
   * Supported: Vite, CRA, Next.js, Nuxt, static HTML server, Python http.server.
   */
  async detectPreviewCommand(root) {
    const pkgPath = path.join(root, 'package.json');
    if (await exists(pkgPath)) {
      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        const scripts = pkg.scripts || {};
        if (scripts.dev) return { command: 'npm', args: ['run', 'dev'], label: 'npm run dev' };
        if (scripts.start) return { command: 'npm', args: ['run', 'start'], label: 'npm run start' };
        if (scripts.preview) return { command: 'npm', args: ['run', 'preview'], label: 'npm run preview' };
      } catch {
        /* ignore */
      }
    }

    for (const marker of ['vite.config.js', 'vite.config.ts', 'next.config.js', 'nuxt.config.ts', 'index.html']) {
      if (await exists(path.join(root, marker))) {
        if (marker.startsWith('vite')) return { command: 'npx', args: ['vite'], label: 'vite' };
        if (marker.startsWith('next')) return { command: 'npx', args: ['next', 'dev'], label: 'next dev' };
        if (marker.startsWith('nuxt')) return { command: 'npx', args: ['nuxt', 'dev'], label: 'nuxt dev' };
        if (marker === 'index.html') {
          return { command: 'npx', args: ['--yes', 'serve', '-l', '3000', '.'], label: 'static server' };
        }
      }
    }

    return { command: 'python3', args: ['-m', 'http.server', '3000'], label: 'python http.server' };
  }

  async startPreview(root) {
    if (this.previewProcess) return { ok: true, alreadyRunning: true, port: this.previewPort };

    const detected = await this.detectPreviewCommand(root);
    const port = this.settings.settings.previewPort || 3000;

    this.previewLog = [];
    const env = { ...process.env, PORT: String(port), BROWSER: 'none', FORCE_COLOR: '0' };

    try {
      this.previewProcess = spawn(detected.command, detected.args, {
        cwd: root,
        env,
        shell: process.platform === 'win32',
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    this.previewProcess.stdout?.on('data', (d) => this.pushPreviewLog(d.toString()));
    this.previewProcess.stderr?.on('data', (d) => this.pushPreviewLog(d.toString()));
    this.previewProcess.on('error', (err) => this.pushPreviewLog(`Error: ${err.message}`));
    this.previewProcess.on('exit', (code) => {
      this.pushPreviewLog(`Preview process exited with code ${code}`);
      this.previewProcess = null;
    });

    this.previewPort = port;
    this.pushPreviewLog(`Started ${detected.label} in ${root}`);

    // Wait briefly for the server to accept connections.
    const ready = await this.waitForPort(port, 8000);
    return { ok: true, port, ready, command: detected.label, url: `http://localhost:${port}` };
  }

  pushPreviewLog(text) {
    this.previewLog.push(text);
    if (this.previewLog.length > 500) this.previewLog.shift();
    this.onPreviewOutput(text);
  }

  waitForPort(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const attempt = () => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on('error', () => {
          if (Date.now() > deadline) resolve(false);
          else setTimeout(attempt, 300);
        });
        req.on('timeout', () => {
          req.destroy();
          if (Date.now() > deadline) resolve(false);
          else setTimeout(attempt, 300);
        });
      };
      attempt();
    });
  }

  async stopPreview() {
    if (!this.previewProcess) return { ok: true, stopped: false };
    const pid = this.previewProcess.pid;
    try {
      this.previewProcess.kill('SIGTERM');
      setTimeout(() => {
        try {
          this.previewProcess?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500);
    } catch {
      /* ignore */
    }
    this.previewProcess = null;
    this.previewPort = 0;
    return { ok: true, stopped: true, pid };
  }

  getPreviewLog() {
    return this.previewLog.slice(-300);
  }

  /* ------------------------------------------------------------------ */
  /* Deploy                                                              */
  /* ------------------------------------------------------------------ */

  getDeployTargets() {
    return [
      {
        id: 'vercel',
        label: 'Vercel',
        requires: 'token',
        docs: 'https://vercel.com/account/tokens',
        env: ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'],
      },
      {
        id: 'netlify',
        label: 'Netlify',
        requires: 'token',
        docs: 'https://app.netlify.com/user/tokens',
        env: ['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID'],
      },
      {
        id: 'cloudflare',
        label: 'Cloudflare Pages',
        requires: 'token',
        docs: 'https://dash.cloudflare.com/profile/api-tokens',
        env: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
      },
      {
        id: 'github',
        label: 'GitHub Pages',
        requires: 'token',
        docs: 'https://github.com/settings/tokens',
        env: ['GITHUB_TOKEN', 'GITHUB_REPOSITORY'],
      },
      {
        id: 'local',
        label: 'Export build output',
        requires: 'none',
        docs: null,
        env: [],
      },
    ];
  }

  async deploy({ target, root, token, buildCommand }) {
    const config = this.getDeployTargets().find((t) => t.id === target);
    if (!config) return { ok: false, error: `Unknown deploy target "${target}"` };

    let buildOutput = null;
    if (buildCommand) {
      const built = await this.runCommand(buildCommand, root);
      if (!built.ok) return { ok: false, error: built.error, output: built.output };
      buildOutput = built.output;
    }

    switch (target) {
      case 'vercel': {
        if (!token) return { ok: false, error: 'A Vercel token is required' };
        const result = await this.runCommand(
          `npx --yes vercel --prod --yes --token ${JSON.stringify(token)}`,
          root,
          180000,
        );
        return { ok: result.ok, output: result.output, error: result.error, provider: 'Vercel' };
      }
      case 'netlify': {
        if (!token) return { ok: false, error: 'A Netlify token is required' };
        const result = await this.runCommand(
          `npx --yes netlify deploy --prod --auth ${JSON.stringify(token)}`,
          root,
          180000,
        );
        return { ok: result.ok, output: result.output, error: result.error, provider: 'Netlify' };
      }
      case 'cloudflare': {
        if (!token) return { ok: false, error: 'A Cloudflare API token is required' };
        const result = await this.runCommand(
          `npx --yes wrangler pages deploy dist --project-name glint --commit-dirty=true`,
          root,
          180000,
          { CLOUDFLARE_API_TOKEN: token },
        );
        return { ok: result.ok, output: result.output, error: result.error, provider: 'Cloudflare Pages' };
      }
      case 'github': {
        if (!token) return { ok: false, error: 'A GitHub token is required' };
        const result = await this.runCommand(
          `npx --yes gh-pages -d dist -t ${JSON.stringify(token)}`,
          root,
          180000,
        );
        return { ok: result.ok, output: result.output, error: result.error, provider: 'GitHub Pages' };
      }
      case 'local': {
        const outDir = path.join(root, 'glint-export');
        await fs.mkdir(outDir, { recursive: true });
        const source = path.join(root, 'dist');
        if (await exists(source)) {
          await fs.cp(source, outDir, { recursive: true });
        } else {
          await fs.writeFile(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Glint export</title><p>No build output found. Add a build step first.</p>`);
        }
        return { ok: true, provider: 'Local export', output: `Exported to ${outDir}` };
      }
      default:
        return { ok: false, error: 'Unsupported target' };
    }
  }

  runCommand(command, cwd, timeoutMs = 60000, extraEnv = {}) {
    return new Promise((resolve) => {
      execFile(
        '/bin/sh',
        ['-c', command],
        { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...extraEnv } },
        (error, stdout, stderr) => {
          const output = `${stdout}\n${stderr}`.trim();
          resolve({
            ok: !error,
            output,
            error: error ? error.message : null,
          });
        },
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* API client                                                          */
  /* ------------------------------------------------------------------ */

  async apiRequest({ method = 'GET', url, headers = {}, body, timeoutMs = 20000 }) {
    if (!url) return { ok: false, error: 'A URL is required' };

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'Invalid URL' };
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const options = {
      method: method.toUpperCase(),
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      timeout: timeoutMs,
    };

    if (body !== undefined && body !== null && body !== '') {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve) => {
      const req = client.request(parsed, options, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsedBody = text;
          try {
            parsedBody = JSON.parse(text);
          } catch {
            /* keep as text */
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            body: parsedBody,
            size: text.length,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Request timed out' });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));

      if (body !== undefined && body !== null && body !== '') {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Database browser                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Connect to a database using a connection string.
   * Supports SQLite (file path), and HTTP-based JSON stores (JSONPlaceholder
   * style) for browser-style browsing without native drivers.
   */
  async dbConnect(connectionString) {
    if (!connectionString) return { ok: false, error: 'A connection string is required' };

    if (/^sqlite:?\/\//i.test(connectionString) || /\.db$|\.sqlite3?$/i.test(connectionString)) {
      const file = connectionString.replace(/^sqlite:?\/\//i, '');
      if (!(await exists(file))) return { ok: false, error: `Database file not found: ${file}` };
      return { ok: true, kind: 'sqlite', file, tables: await this.listSqliteTables(file) };
    }

    if (/^https?:\/\//i.test(connectionString)) {
      const probe = await this.apiRequest({ method: 'GET', url: connectionString, timeoutMs: 8000 });
      if (!probe.ok) return { ok: false, error: probe.error || `HTTP ${probe.status}` };
      return { ok: true, kind: 'http', url: connectionString, data: probe.body };
    }

    return {
      ok: false,
      error: 'Unsupported connection string. Use a SQLite path or an HTTP(S) JSON endpoint.',
    };
  }

  async listSqliteTables(file) {
    // Use the sqlite3 CLI when present; otherwise report that it is required.
    return new Promise((resolve) => {
      execFile('sqlite3', [file, '.tables'], { timeout: 8000 }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(stdout.split(/\s+/).filter(Boolean));
      });
    });
  }

  async dbQuery(connectionString, query) {
    if (!query) return { ok: false, error: 'A query is required' };

    if (/^sqlite:?\/\//i.test(connectionString) || /\.db$|\.sqlite3?$/i.test(connectionString)) {
      const file = connectionString.replace(/^sqlite:?\/\//i, '');
      return new Promise((resolve) => {
        execFile('sqlite3', ['-json', file, query], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, error: stderr || error.message });
            return;
          }
          let rows = [];
          try {
            rows = JSON.parse(stdout || '[]');
          } catch {
            rows = stdout;
          }
          resolve({ ok: true, rows });
        });
      });
    }

    if (/^https?:\/\//i.test(connectionString)) {
      const separator = connectionString.includes('?') ? '&' : '?';
      return await this.apiRequest({ method: 'GET', url: `${connectionString}${separator}q=${encodeURIComponent(query)}` });
    }

    return { ok: false, error: 'Unsupported connection string' };
  }

  /* ------------------------------------------------------------------ */
  /* Terminal                                                            */
  /* ------------------------------------------------------------------ */

  async runTerminal(command, cwd) {
    return await this.runCommand(command, cwd, 120000);
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { WorkflowService };
