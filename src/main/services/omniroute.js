const { getProvider, OMNI_OBJECTIVES } = require('./providers');

/**
 * OmniRoute.
 *
 * Routes a request across the providers you have connected, choosing models
 * by objective (coding / quality / speed / cheapest) and falling back through
 * the candidates when one fails — the same chain CAELIX uses.
 *
 * If a self-hosted OmniRoute base URL is configured it is tried first.
 */

/** Regexes used to score models against an objective. */
const RE = {
  bad: /embedding|rerank|tts|stt|whisper|moderation|image|audio|video|tts-?/i,
  nochat: /instruct-embed|preview-?free|bge|gte-?/i,
  vision: /vision|vl\b|multimodal/i,
  coding: /coder|codestral|devstral|starcoder|deepseek-coder|qwen.*coder|codellama|code-?/i,
  fast: /flash|mini|haiku|small|fast|tiny|lite|nano|8b|7b|3b/i,
  smart: /opus|sonnet|gpt-?5|gpt-?6|gpt-?4o|o3|405b|ultra|pro|reasoner|thinking|max/i,
};

/** Score a model against an objective. Returns -1 when the model is ineligible. */
function scoreObjective(objective, modelId, provider) {
  const id = String(modelId);
  if (RE.bad.test(id) || RE.nochat.test(id) || RE.vision.test(id)) return -1;

  const obj = String(objective || 'auto').replace(/^auto\/?/, '') || 'auto';
  let score = 1;

  if (obj === 'coding' && RE.coding.test(id)) {
    score += 5 + (/coder|codestral|devstral/i.test(id) ? 2 : 0);
  }
  if (obj === 'fast' && RE.fast.test(id)) score += 5;
  if (obj === 'smart' && RE.smart.test(id)) {
    score += 5 + (/(pro|opus|gpt-?5|gpt-?6|o3|405b|ultra)/i.test(id) ? 2 : 0);
  }
  if (obj === 'cheap') {
    const isFree = id.endsWith(':free') || id.endsWith('-free');
    score += (isFree ? 6 : 0) + (RE.fast.test(id) ? 2 : 0);
  }
  if (obj === 'auto') {
    score += (RE.smart.test(id) ? 2 : 0) + (RE.fast.test(id) ? 1 : 0);
  }
  if (obj === 'fast' && provider?.id === 'groq') score += 3;

  return score;
}

class OmniRouteService {
  /**
   * @param {object} deps
   * @param {import('./ai').AIService} deps.ai
   * @param {import('./archive').ArchiveService} deps.archive
   * @param {Function} deps.getSettings
   * @param {Function} deps.onEvent
   */
  constructor({ ai, archive, getSettings, onEvent }) {
    this.ai = ai;
    this.archive = archive;
    this.getSettings = getSettings;
    this.onEvent = onEvent || (() => {});
    this.modelCache = new Map(); // providerId -> { at, models }
    this.skipped = new Set(); // providers that failed auth during this request
  }

  /** Mark a provider as unusable for the current routing attempt. */
  skipProvider(providerId) {
    this.skipped.add(providerId);
  }

  /** Clear the skip list. */
  resetSkipped() {
    this.skipped.clear();
  }

  objectives() {
    return OMNI_OBJECTIVES;
  }

  /** Providers whose model list is reachable. */
  connectedProviders() {
    const settings = this.getSettings();
    const all = [
      'kilo', 'pollinations', 'zen', 'coarena', 'openrouter',
      'nvidia', 'deepinfra', 'groq', 'gemini', 'numes', 'abliteration', 'local',
    ];
    return all.filter((id) => {
      const provider = getProvider(id);
      if (!provider) return false;
      if (provider.auth === 'none') return true;
      if (provider.auth === 'optional') {
        // These expose their catalogue without a key.
        return ['kilo', 'pollinations', 'zen', 'coarena'].includes(provider.id);
      }
      return Boolean(settings[provider.keyField]);
    });
  }

  /**
   * Providers that can actually answer a chat right now.
   * Some providers expose a public model list but still need a key to chat
   * (CoArena is one), so they are excluded from the routing chain.
   */
  chatCapableProviders() {
    const settings = this.getSettings();
    return this.connectedProviders().filter((id) => {
      const provider = getProvider(id);
      if (!provider) return false;
      if (provider.chatNeedsKey) return Boolean(settings[provider.keyField]);
      if (provider.auth === 'none') return true;
      if (provider.auth === 'optional') return true;
      return Boolean(settings[provider.keyField]);
    });
  }

  /** List models for one provider, using the shared AI service. */
  async modelsFor(providerId) {
    const cached = this.modelCache.get(providerId);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.models;

    const result = await this.ai.listModelsFor(providerId);
    if (!result.ok) return [];

    const provider = getProvider(providerId);
    const models = result.models
      .filter((m) => !this.archive.isArchived(providerId, m))
      // Respect a provider's own model allowlist (e.g. Pollinations only
      // exposes a single model on its anonymous tier).
      .filter((m) => !provider?.allowedModels || provider.allowedModels.includes(m))
      .map((id) => ({ id, provider: providerId }));

    this.modelCache.set(providerId, { at: Date.now(), models });
    return models;
  }

  /**
   * Rank candidate models across connected providers for an objective.
   * Returns [{ provider, model, score }] best first.
   */
  async routeCandidates(objective = 'auto') {
    const providers = this.chatCapableProviders();
    const candidates = [];

    for (const providerId of providers) {
      const models = await this.modelsFor(providerId);
      const provider = getProvider(providerId);
      const ranked = models
        .map((m) => ({ ...m, s: scoreObjective(objective, m.id, provider) }))
        .filter((m) => m.s >= 0)
        .sort((a, b) => b.s - a.s);

      // Take the best few from each provider so routing can still fall back.
      ranked.slice(0, 3).forEach((m, i) => {
        candidates.push({
          provider: m.provider,
          model: m.id,
          score: m.s - i * 0.5 - (provider?.auth === 'optional' ? 1 : 0),
        });
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Route a chat request through the candidate chain.
   * Each failure rolls on to the next candidate.
   */
  async routeChat(messages, options = {}) {
    const settings = this.getSettings();
    const objective = options.objective || settings.omnirouteObjective || 'auto';

    // A self-hosted OmniRoute server is tried first.
    const selfHosted = settings.omnirouteBase;
    if (selfHosted) {
      try {
        const result = await this.ai.chatFor({
          providerId: 'omniroute',
          baseOverride: selfHosted,
          model: options.model || objective,
          messages,
          options,
        });
        if (result.ok) return { ...result, routedVia: 'omniroute-server', objective };
        this.onEvent({ type: 'route-fail', provider: 'omniroute', error: result.error });
      } catch (err) {
        this.onEvent({ type: 'route-fail', provider: 'omniroute', error: String(err.message) });
      }
    }

    this.resetSkipped();
    const candidates = (await this.routeCandidates(objective)).filter((c) => !this.skipped.has(c.provider));
    if (!candidates.length) {
      return {
        ok: false,
        error: 'OmniRoute has no connected providers yet. Add a key, or use a keyless provider.',
      };
    }

    let lastError = null;
    for (const candidate of candidates) {
      const provider = getProvider(candidate.provider);
      const result = await this.ai.chatFor({
        providerId: candidate.provider,
        model: candidate.model,
        messages,
        options,
      });
      if (result.ok) {
        return {
          ...result,
          routedVia: candidate.provider,
          routedModel: candidate.model,
          objective,
        };
      }
      lastError = result.error;
      this.onEvent({
        type: 'route-fail',
        provider: candidate.provider,
        model: candidate.model,
        error: String(result.error || '').slice(0, 160),
      });
      // A hard abort (user cancelled) should not keep rolling.
      if (result.aborted) break;
      // An auth failure means this provider is unusable right now — keep
      // rolling so the request still reaches a working provider.
      if (result.status === 401 || result.status === 403) {
        this.skipProvider(candidate.provider);
        continue;
      }
    }

    return {
      ok: false,
      error: lastError || 'OmniRoute could not route this request',
      objective,
      tried: candidates.length,
    };
  }

  /** Objective choices with the current selection. */
  status() {
    const settings = this.getSettings();
    return {
      objective: settings.omnirouteObjective || 'auto',
      objectives: OMNI_OBJECTIVES,
      connected: this.connectedProviders(),
      chatCapable: this.chatCapableProviders(),
      selfHosted: Boolean(settings.omnirouteBase),
    };
  }

  invalidate() {
    this.modelCache.clear();
  }
}

module.exports = { OmniRouteService, scoreObjective, RE };
