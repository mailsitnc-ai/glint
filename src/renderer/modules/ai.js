/* ==========================================================================
   AI module: chat panel, inline ghost text, refactoring, commit messages.
   ========================================================================== */

export class AIModule {
  constructor(api, options = {}) {
    this.api = api;
    this.onStatus = options.onStatus || (() => {});
    this.onGhostText = options.onGhostText || (() => {});
    this.history = [];
    this.status = { configured: false, provider: 'none', endpoint: '', model: '', hasKey: false };
    this.providers = [];
    this.archived = [];
    this.omni = null;
    this.ghostTimer = null;
    this.lastGhostRequest = 0;
    this.contextFiles = [];
  }

  async init() {
    this.providers = await this.api.aiProviders();
    await this.refreshStatus();
    await this.listArchived();
    await this.omniStatus().catch(() => {});
    return this.status;
  }

  async refreshStatus() {
    this.status = await this.api.aiStatus();
    this.onStatus(this.status);
    return this.status;
  }

  get isReady() {
    return Boolean(this.status.configured);
  }

  /** Providers that can be selected in the UI. */
  async listProviders() {
    if (!this.providers) this.providers = await this.api.aiProviders();
    return this.providers;
  }

  /** Models offered by the currently selected provider. */
  async listModels() {
    return await this.api.aiModels();
  }

  /* ------------------------------------------------------------------ */
  /* Archive                                                             */
  /* ------------------------------------------------------------------ */

  /** Archive a model so it disappears from the pickers. */
  async archiveModel(providerId, modelId, reason) {
    const result = await this.api.aiArchive(providerId, modelId, reason);
    if (result.ok) this.archived = await this.listArchived();
    return result;
  }

  /** Bring an archived model back. */
  async unarchiveModel(providerId, modelId) {
    const result = await this.api.aiUnarchive(providerId, modelId);
    if (result.ok) this.archived = await this.listArchived();
    return result;
  }

  /** All archived models. */
  async listArchived() {
    const result = await this.api.aiArchived();
    this.archived = result.archived || [];
    return this.archived;
  }

  async clearArchive() {
    const result = await this.api.aiArchiveClear();
    this.archived = [];
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* OmniRoute                                                           */
  /* ------------------------------------------------------------------ */

  /** Current OmniRoute status and objectives. */
  async omniStatus() {
    this.omni = await this.api.aiOmniStatus();
    return this.omni;
  }

  /** Ranked route candidates for an objective. */
  async omniCandidates(objective) {
    return await this.api.aiOmniCandidates(objective);
  }

  /** Route a chat request through OmniRoute. */
  async omniChat(messages, options = {}) {
    return await this.api.aiOmniChat(messages, options);
  }

  /* ------------------------------------------------------------------ */
  /* Chat                                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Send a chat message. Context from the active editor is included
   * automatically so the assistant knows what you are working on.
   */
  async chat(userMessage, context = {}) {
    this.history.push({ role: 'user', content: userMessage });

    const messages = [
      {
        role: 'system',
        content:
          'You are Glint AI, an expert software engineer embedded in a code editor. ' +
          'Be concise and concrete. Prefer code over prose. Reference file names when relevant.',
      },
    ];

    // Include recent conversation for continuity.
    for (const entry of this.history.slice(-8, -1)) {
      messages.push({ role: entry.role, content: entry.content });
    }

    if (context.code) {
      messages.push({
        role: 'user',
        content:
          `Context — ${context.fileName || 'current file'}${context.selection ? ' (selection)' : ''}:\n` +
          '```\n' + context.code.slice(0, 12000) + '\n```',
      });
    }

    messages.push({ role: 'user', content: userMessage });

    const result = await this.api.aiChat(messages, { maxTokens: 2000 });
    if (!result.ok) {
      this.history.pop();
      return { ok: false, error: result.error };
    }

    this.history.push({ role: 'assistant', content: result.text });
    return { ok: true, text: result.text };
  }

  /** Explain the current selection. */
  async explain(selection, fileName, instruction) {
    return await this.api.aiExplain({ selection, code: selection, fileName, instruction });
  }

  /** Refactor the current selection with a stated goal. */
  async refactor(selection, goal, fileName) {
    return await this.api.aiRefactor({ selection, code: selection, goal, fileName });
  }

  /** Generate documentation for the current function. */
  async docstring(code, language) {
    return await this.api.aiDocstring({ code, language });
  }

  /** Generate a commit message from the current git diff. */
  async commitMessage() {
    return await this.api.aiCommitMessage();
  }

  /* ------------------------------------------------------------------ */
  /* Ghost text (inline completion)                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Request an inline completion for the current cursor position.
   * Requests are debounced and rate-limited so typing stays smooth.
   */
  requestCompletion({ prefix, suffix, fileName, force = false }) {
    if (!this.isReady) return;

    const now = Date.now();
    if (!force && now - this.lastGhostRequest < 900) return;
    this.lastGhostRequest = now;

    clearTimeout(this.ghostTimer);
    this.ghostTimer = setTimeout(async () => {
      const result = await this.api.aiCompletion({
        prefix: prefix.slice(-4000),
        suffix: suffix.slice(0, 2000),
        fileName,
        maxTokens: 48,
      });
      if (result.ok && result.text) {
        this.onGhostText(result.text);
      } else {
        this.onGhostText(null);
      }
    }, force ? 0 : 320);
  }

  cancelCompletion() {
    clearTimeout(this.ghostTimer);
    this.onGhostText(null);
  }

  /* ------------------------------------------------------------------ */
  /* Provider management                                                   */
  /* ------------------------------------------------------------------ */

  async listModels() {
    return await this.api.aiModels();
  }

  async healthCheck() {
    return await this.api.aiHealth();
  }

  clearHistory() {
    this.history = [];
  }
}
