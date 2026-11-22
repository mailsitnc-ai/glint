/* ==========================================================================
   Workflow module: live preview, deployments, database browser, API client.
   ========================================================================== */

export class WorkflowModule {
  constructor(api, options = {}) {
    this.api = api;
    this.onPreview = options.onPreview || (() => {});
    this.onDeploy = options.onDeploy || (() => {});
    this.onDatabase = options.onDatabase || (() => {});
    this.onApi = options.onApi || (() => {});
    this.onTerminal = options.onTerminal || (() => {});

    this.preview = { running: false, port: 0, url: '', log: [] };
    this.deployTargets = [];
    this.db = { connected: false, kind: '', tables: [], rows: null, error: null };
    this.apiHistory = [];
  }

  async init() {
    this.deployTargets = await this.api.deployTargets();
    return this.deployTargets;
  }

  /* ------------------------------------------------------------------ */
  /* Live preview                                                          */
  /* ------------------------------------------------------------------ */

  async startPreview() {
    const result = await this.api.previewStart();
    if (result.ok) {
      this.preview = {
        running: true,
        port: result.port,
        url: result.url || `http://localhost:${result.port}`,
        log: await this.api.previewLog(),
        ready: result.ready,
        command: result.command,
      };
    }
    this.onPreview(this.preview);
    return result;
  }

  async stopPreview() {
    await this.api.previewStop();
    this.preview = { running: false, port: 0, url: '', log: [] };
    this.onPreview(this.preview);
    return { ok: true };
  }

  async refreshPreviewLog() {
    if (!this.preview.running) return this.preview;
    this.preview.log = await this.api.previewLog();
    this.onPreview(this.preview);
    return this.preview;
  }

  /* ------------------------------------------------------------------ */
  /* Deploy                                                                */
  /* ------------------------------------------------------------------ */

  async deploy(options) {
    const result = await this.api.deploy(options);
    this.onDeploy({ ...result, options });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Database                                                              */
  /* ------------------------------------------------------------------ */

  async connectDatabase(connectionString) {
    const result = await this.api.dbConnect(connectionString);
    if (result.ok) {
      this.db = {
        connected: true,
        kind: result.kind,
        file: result.file,
        url: result.url,
        tables: result.tables || [],
        rows: result.data ? [result.data] : null,
        error: null,
      };
    } else {
      this.db = { ...this.db, connected: false, error: result.error };
    }
    this.onDatabase(this.db);
    return result;
  }

  async queryDatabase(connectionString, query) {
    const result = await this.api.dbQuery(connectionString, query);
    if (result.ok) {
      this.db.rows = result.rows;
      this.db.error = null;
    } else {
      this.db.error = result.error;
    }
    this.onDatabase(this.db);
    return result;
  }

  disconnectDatabase() {
    this.db = { connected: false, kind: '', tables: [], rows: null, error: null };
    this.onDatabase(this.db);
  }

  /* ------------------------------------------------------------------ */
  /* API client                                                            */
  /* ------------------------------------------------------------------ */

  async sendRequest(request) {
    const result = await this.api.apiRequest(request);
    const entry = { ...request, result, at: new Date().toISOString() };
    this.apiHistory.unshift(entry);
    if (this.apiHistory.length > 25) this.apiHistory.pop();
    this.onApi({ history: this.apiHistory, last: entry });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Terminal                                                              */
  /* ------------------------------------------------------------------ */

  async runCommand(command) {
    const result = await this.api.runTerminal(command);
    this.onTerminal({ command, ...result });
    return result;
  }
}
