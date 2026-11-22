/* ==========================================================================
   Intelligence module: semantic search, dead code, test impact, overview.
   ========================================================================== */

export class IntelligenceModule {
  constructor(api, options = {}) {
    this.api = api;
    this.onResults = options.onResults || (() => {});
    this.lastQuery = '';
    this.searching = false;
  }

  /** Run a semantic search across the workspace. */
  async search(query, options = {}) {
    if (!query || !query.trim()) {
      this.onResults({ type: 'search', results: [], query: '' });
      return { ok: true, results: [] };
    }
    this.searching = true;
    this.lastQuery = query;
    const result = await this.api.semanticSearch(query, options);
    this.searching = false;
    this.onResults({ type: 'search', ...result, query });
    return result;
  }

  /** Find definitions that are never referenced. */
  async findDeadCode() {
    const result = await this.api.findDeadCode();
    this.onResults({ type: 'dead-code', ...result });
    return result;
  }

  /** Analyse which tests a change could affect. */
  async testImpact(changedFiles = []) {
    const result = await this.api.testImpact(changedFiles);
    this.onResults({ type: 'test-impact', ...result });
    return result;
  }

  /** Project statistics. */
  async overview() {
    const result = await this.api.projectOverview();
    this.onResults({ type: 'overview', ...result });
    return result;
  }

  /** Generate documentation for a function without any provider. */
  async localDocstring(code, language) {
    return await this.api.localDocstring(code, language);
  }
}
