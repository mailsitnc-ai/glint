const fs = require('node:fs/promises');
const { getProvider, listProviders } = require('./providers');

/**
 * AI service.
 *
 * Talks to any provider in the registry through one OpenAI-compatible code
 * path, with provider-specific auth, headers and rate-limit policy applied
 * automatically. Heavy work runs in the main process so typing never blocks.
 */
class AIService {
  constructor(settings, archive = null) {
    this.settings = settings;
    this.archive = archive;
    this.lastRequestAt = new Map(); // providerId -> timestamp
    this.rateLimitState = new Map();
  }

  /** True when a model has been archived and should be hidden. */
  isArchived(providerId, modelId) {
    return Boolean(this.archive?.isArchived(providerId, modelId));
  }

  get config() {
    return this.settings.settings;
  }

  get provider() {
    return getProvider(this.config.aiProvider) || getProvider('none');
  }

  /** Resolve the API key for the active provider. */
  get apiKey() {
    const provider = this.provider;
    if (!provider || !provider.keyField) return '';
    return this.config[provider.keyField] || '';
  }

  /** Resolve the key for any provider, not just the active one. */
  keyFor(provider) {
    if (!provider || !provider.keyField) return '';
    return this.config[provider.keyField] || '';
  }

  /** True when a provider has the credentials it needs. */
  providerReady(provider) {
    if (!provider) return false;
    if (provider.auth === 'none' || provider.auth === 'optional') return true;
    return Boolean(this.keyFor(provider));
  }

  /**
   * A provider is usable when it needs no key, or when a key is present.
   * The active provider always wins over the legacy local/cloud flags.
   */
  isConfigured() {
    const provider = this.provider;
    if (!provider) return false;
    if (provider.auth === 'none') return true;
    if (provider.auth === 'optional') return true;
    return Boolean(this.apiKey);
  }

  /** True when a key is present (not required, but improves limits/quality). */
  hasKey() {
    return Boolean(this.apiKey);
  }

  providerInfo() {
    const provider = this.provider;
    if (!provider) return { provider: 'none', endpoint: '', model: '', hasKey: false };
    return {
      provider: provider.id,
      label: provider.label,
      endpoint: this.endpointUrl(),
      model: this.config.aiModel || provider.defaultModel,
      hasKey: this.hasKey(),
      requiresKey: provider.auth === 'required',
      supportsFIM: provider.supportsFIM,
    };
  }

  /** Base URL for the active provider, allowing a per-user override. */
  baseUrl(provider = this.provider, override = null) {
    if (!provider) return '';
    const custom = override !== null ? override : this.config.aiEndpoint;
    if (custom && (provider.editableBase || this.config.aiProvider === 'custom' || this.config.aiUseCustomEndpoint)) {
      return custom.replace(/\/+$/, '');
    }
    return provider.baseUrl;
  }

  endpointUrl(provider = this.provider, override = null) {
    const base = this.baseUrl(provider, override);
    if (!base) return '';
    return `${base}/chat/completions`;
  }

  modelsUrl(provider = this.provider, override = null) {
    const base = this.baseUrl(provider, override);
    if (!base) return '';
    return `${base}/models`;
  }

  buildHeaders(provider = this.provider) {
    const headers = { 'Content-Type': 'application/json' };
    const key = provider === this.provider ? this.apiKey : this.keyFor(provider);

    if (key) {
      if (provider.authHeader === 'both') {
        // Pollinations accepts either header.
        headers.Authorization = `Bearer ${key}`;
        headers['X-Api-Key'] = key;
      } else {
        headers.Authorization = `Bearer ${key}`;
      }
    }

    if (provider.extraHeaders) {
      Object.assign(headers, provider.extraHeaders);
    }

    return headers;
  }

  buildRequest(messages, options = {}, provider = this.provider) {
    // Only apply the user's chosen model for the active provider. When routing
    // across providers (OmniRoute), each provider must use its own model id.
    const isActive = provider === this.provider;
    // An explicit model always wins. For the active provider the user's chosen
    // model applies; otherwise fall back to the provider's own default.
    const model = options.model || (isActive && this.config.aiModel) || provider.defaultModel;
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens ?? 1200;
    return {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...(options.extra || {}),
    };
  }

  /**
   * Enforce provider rate limits.
   * Returns { allowed, waitMs, reason }.
   */
  checkRateLimit(providerId = this.provider.id) {
    const provider = getProvider(providerId);
    const limit = provider?.rateLimit;
    if (!limit) return { allowed: true, waitMs: 0 };

    const now = Date.now();
    const state = this.rateLimitState.get(providerId) || { count: 0, windowStart: now };

    if (limit.minIntervalMs) {
      const last = this.lastRequestAt.get(providerId) || 0;
      const elapsed = now - last;
      if (elapsed < limit.minIntervalMs) {
        return {
          allowed: false,
          waitMs: limit.minIntervalMs - elapsed,
          reason: `${provider.label} allows one request every ${Math.round(limit.minIntervalMs / 1000)}s on the anonymous tier`,
        };
      }
    }

    if (limit.requestsPerDay && now - state.windowStart > 86400000) {
      state.count = 0;
      state.windowStart = now;
    }
    if (limit.requestsPerDay && state.count >= limit.requestsPerDay) {
      return {
        allowed: false,
        waitMs: state.windowStart + 86400000 - now,
        reason: `${provider.label} limit is ${limit.requestsPerDay} requests per day`,
      };
    }

    if (limit.requestsPerHour && now - state.windowStart > 3600000) {
      state.count = 0;
      state.windowStart = now;
    }
    if (limit.requestsPerHour && state.count >= limit.requestsPerHour) {
      return {
        allowed: false,
        waitMs: state.windowStart + 3600000 - now,
        reason: `${provider.label} anonymous limit is ${limit.requestsPerHour} requests per hour`,
      };
    }

    if (limit.requestsPerMinute && now - state.windowStart > 60000) {
      state.count = 0;
      state.windowStart = now;
    }
    if (limit.requestsPerMinute && state.count >= limit.requestsPerMinute) {
      return {
        allowed: false,
        waitMs: state.windowStart + 60000 - now,
        reason: `${provider.label} limit is ${limit.requestsPerMinute} requests per minute`,
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  recordRequest(providerId = this.provider.id) {
    const provider = getProvider(providerId);
    const now = Date.now();
    this.lastRequestAt.set(providerId, now);

    const limit = provider?.rateLimit;
    if (!limit) return;

    const state = this.rateLimitState.get(providerId) || { count: 0, windowStart: now };
    if (limit.requestsPerMinute && now - state.windowStart > 60000) {
      state.count = 0;
      state.windowStart = now;
    }
    if (limit.requestsPerHour && now - state.windowStart > 3600000) {
      state.count = 0;
      state.windowStart = now;
    }
    if (limit.requestsPerDay && now - state.windowStart > 86400000) {
      state.count = 0;
      state.windowStart = now;
    }
    state.count++;
    this.rateLimitState.set(providerId, state);
  }

  /**
   * Send a chat request. Returns { ok, text, error }.
   * Never throws; network and rate-limit failures become structured errors.
   */
  async chat(messages, options = {}) {
    return await this.chatFor({
      providerId: options.providerId || this.provider.id,
      model: options.model,
      messages,
      options,
    });
  }

  /**
   * Chat against a specific provider regardless of the active selection.
   * Used by OmniRoute to try each candidate in turn.
   */
  async chatFor({ providerId, model, messages, options = {}, baseOverride = null }) {
    // An explicit model (e.g. an OmniRoute candidate) always wins over the
    // user's global selection.
    if (model) options = { ...options, model };

    const provider = getProvider(providerId);
    if (!provider) return { ok: false, error: `Unknown provider "${providerId}"` };

    if (!this.providerReady(provider)) {
      return {
        ok: false,
        error: `${provider.label} needs an API key. Add one in Glint settings.`,
        needsKey: true,
      };
    }

    if (provider.virtual && provider.id === 'omniroute') {
      return { ok: false, error: 'OmniRoute is handled by the router service' };
    }

    const limit = this.checkRateLimit(provider.id);
    if (!limit.allowed) {
      return {
        ok: false,
        error: `${limit.reason}. Try again in ${Math.ceil(limit.waitMs / 1000)}s.`,
        rateLimited: true,
        waitMs: limit.waitMs,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000);

    try {
      const response = await fetch(this.endpointUrl(provider, baseOverride), {
        method: 'POST',
        headers: this.buildHeaders(provider),
        body: JSON.stringify(this.buildRequest(messages, options, provider), provider),
        signal: controller.signal,
      });

      this.recordRequest(provider.id);

      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false,
          error: `${provider.label} returned ${response.status}: ${body.slice(0, 300)}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      let text = message?.content ?? '';

      // Reasoning models may return only a reasoning trace with empty content.
      if (!text && message?.reasoning) text = message.reasoning;
      if (!text && typeof data?.choices?.[0]?.text === 'string') text = data.choices[0].text;

      return { ok: true, text: typeof text === 'string' ? text : JSON.stringify(text), raw: data };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { ok: false, error: 'Request timed out' };
      }
      return { ok: false, error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fill-in-the-middle completion — the correct primitive for inline ghost
   * text, where the model is given both the code before and after the cursor.
   */
  async fim({ prompt, suffix, model, maxTokens = 60 }) {
    const provider = this.provider;
    if (!provider?.supportsFIM) {
      return { ok: false, error: `${provider?.label || 'This provider'} does not support FIM completions` };
    }
    if (!this.hasKey()) {
      return { ok: false, error: 'FIM completions require an API key for this provider.', needsKey: true };
    }

    const limit = this.checkRateLimit();
    if (!limit.allowed) {
      return { ok: false, error: limit.reason, rateLimited: true, waitMs: limit.waitMs };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${this.baseUrl()}${provider.fimEndpoint || '/fim/completions'}`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: model || this.config.aiFimModel || 'mistralai/codestral',
          prompt,
          suffix,
          max_tokens: maxTokens,
          temperature: 0.15,
          stop: ['\n\n\n'],
        }),
        signal: controller.signal,
      });

      this.recordRequest();

      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `FIM failed (${response.status}): ${body.slice(0, 250)}` };
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.text ?? data?.completion ?? '';
      return { ok: true, text: String(text).replace(/\s+$/, '') };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, error: 'FIM request timed out' };
      return { ok: false, error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** List models exposed by the configured provider. */
  async listModels() {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Configure a provider first', models: [] };
    }
    return await this.listModelsFor(this.provider.id);
  }

  /** List models for any provider by id. */
  async listModelsFor(providerId) {
    const provider = getProvider(providerId);
    if (!provider) return { ok: false, error: `Unknown provider "${providerId}"`, models: [] };

    if (provider.virtual && provider.id === 'omniroute') {
      const { OMNI_OBJECTIVES } = require('./providers');
      return {
        ok: true,
        models: OMNI_OBJECTIVES.map((o) => o.id),
        total: OMNI_OBJECTIVES.length,
        virtual: true,
      };
    }

    if (!this.providerReady(provider)) {
      return { ok: false, error: `${provider.label} needs an API key`, models: [] };
    }

    const base = this.baseUrl(provider);
    if (!base) return { ok: false, error: `${provider.label} needs an endpoint`, models: [] };

    // Retry once on a transient network failure before giving up.
    let response = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(this.modelsUrl(provider), {
          headers: this.buildHeaders(provider),
          signal: AbortSignal.timeout(12000),
        });
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (!response) {
      return { ok: false, error: lastErr?.message || 'Provider unreachable', models: [] };
    }

    try {
      if (!response.ok) {
        return { ok: false, error: `Could not list models (HTTP ${response.status})`, models: [] };
      }
      const data = await response.json();
      const models = (data.data || data.models || [])
        .map((m) => (typeof m === 'string' ? m : m.id || m.name))
        .filter(Boolean)
        .filter((id) => !this.isArchived(provider.id, id));
      return { ok: true, models, total: models.length };
    } catch (err) {
      return { ok: false, error: err.message, models: [] };
    }
  }

  /** Verify the provider is reachable and responding. */
  async healthCheck() {
    if (!this.isConfigured()) {
      const provider = this.provider;
      return {
        ok: false,
        error: provider?.auth === 'required' ? `${provider.label} needs an API key` : 'No provider configured',
      };
    }
    const result = await this.chat(
      [{ role: 'user', content: 'Reply with the single word: ready' }],
      { maxTokens: 12, timeout: 20000 },
    );
    return result.ok ? { ok: true, reply: result.text.trim().slice(0, 80) } : { ok: false, error: result.error };
  }

  /** Report the remaining anonymous quota for the active provider. */
  quotaStatus() {
    const provider = this.provider;
    const limit = provider?.rateLimit;
    const state = this.rateLimitState.get(provider?.id) || { count: 0, windowStart: Date.now() };
    if (!limit) return { limited: false };
    if (limit.minIntervalMs) {
      const last = this.lastRequestAt.get(provider.id) || 0;
      const elapsed = Date.now() - last;
      return {
        limited: true,
        kind: 'interval',
        used: state.count,
        limit: null,
        nextAllowedInMs: Math.max(0, limit.minIntervalMs - elapsed),
        label: `One request every ${Math.round(limit.minIntervalMs / 1000)}s`,
      };
    }
    if (limit.requestsPerHour) {
      return {
        limited: true,
        kind: 'hour',
        used: state.count,
        limit: limit.requestsPerHour,
        resetsInMs: Math.max(0, state.windowStart + 3600000 - Date.now()),
        label: `${state.count}/${limit.requestsPerHour} per hour`,
      };
    }
    if (limit.requestsPerDay) {
      return {
        limited: true,
        kind: 'day',
        used: state.count,
        limit: limit.requestsPerDay,
        resetsInMs: Math.max(0, state.windowStart + 86400000 - Date.now()),
        label: `${state.count}/${limit.requestsPerDay} per day`,
      };
    }
    if (limit.requestsPerMinute) {
      return {
        limited: true,
        kind: 'minute',
        used: state.count,
        limit: limit.requestsPerMinute,
        resetsInMs: Math.max(0, state.windowStart + 60000 - Date.now()),
        label: `${state.count}/${limit.requestsPerMinute} per minute`,
      };
    }
    return { limited: false };
  }

  /* ------------------------------------------------------------------ */
  /* High-level features                                                  */
  /* ------------------------------------------------------------------ */

  async explain({ code, selection, fileName, instruction }) {
    const subject = selection ? 'the selected code' : `the file ${fileName || 'untitled'}`;
    const prompt = instruction
      ? `Explain ${subject}:\n\n${instruction}\n\n\`\`\`\n${selection || code}\n\`\`\``
      : `Explain ${subject}:\n\n\`\`\`\n${selection || code}\n\`\`\``;
    return await this.chat([
      { role: 'system', content: 'You are a concise senior engineer. Explain clearly and briefly.' },
      { role: 'user', content: prompt },
    ]);
  }

  async refactor({ code, selection, goal, fileName }) {
    const subject = selection || code;
    const prompt = `Refactor the following ${fileName ? `code from ${fileName}` : 'code'} to be ${goal || 'cleaner and more readable'}. Return only the refactored code, no commentary.\n\n\`\`\`\n${subject}\n\`\`\``;
    return await this.chat([
      { role: 'system', content: 'You are a refactoring engine. Output only code.' },
      { role: 'user', content: prompt },
    ]);
  }

  async commitMessage({ diff, branch }) {
    const prompt = `Write a concise conventional-commit message (type, optional scope, short summary) for this diff${branch ? ` on branch ${branch}` : ''}:\n\n${diff.slice(0, 6000)}`;
    const result = await this.chat(
      [
        { role: 'system', content: 'You write git commit messages. Output only the single commit message line.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 120, temperature: 0.3 },
    );
    if (!result.ok) return result;
    const line = result.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .find((l) => !l.startsWith('```'));
    return { ok: true, text: line || result.text.trim() };
  }

  /**
   * Inline completion used for ghost text.
   * Uses FIM when the provider supports it, otherwise falls back to chat.
   */
  async completion({ prefix, suffix, fileName, maxTokens = 60 }) {
    const provider = this.provider;

    // Preferred path: native fill-in-the-middle.
    if (provider?.supportsFIM && this.hasKey()) {
      const fim = await this.fim({
        prompt: prefix.slice(-4000),
        suffix: suffix.slice(0, 2000),
        maxTokens,
      });
      if (fim.ok) return { ok: true, text: fim.text, mode: 'fim' };
    }

    // Fallback: prompt a chat model to continue the code.
    const prompt = `Complete the code. Return only the completion text.\n\nFile: ${fileName || 'untitled'}\n\n<PRE>\n${prefix}\n<SUFFIX>\n${suffix}\n\nCompletion:`;
    const result = await this.chat(
      [
        { role: 'system', content: 'You are a code completion engine. Output only code. No fences, no explanation.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens, temperature: 0.15 },
    );
    if (!result.ok) return result;
    let text = result.text.trim();
    text = text.replace(/^```[\w-]*\n?/, '').replace(/```$/, '').trimEnd();
    return { ok: true, text, mode: 'chat' };
  }

  async docstring({ code, language }) {
    const prompt = `Write a ${language === 'python' ? 'Python docstring' : 'JSDoc comment block'} for the following ${language || 'code'}. Return only the comment.\n\n\`\`\`\n${code}\n\`\`\``;
    return await this.chat(
      [
        { role: 'system', content: 'You generate documentation comments. Output only the comment.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 300 },
    );
  }

  async readContext(filePath, maxBytes = 200000) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > maxBytes) {
        const handle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(maxBytes);
        await handle.read(buffer, 0, maxBytes, 0);
        await handle.close();
        return buffer.toString('utf-8');
      }
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }
}

/** Generate a diff between two strings (simple LCS-based line diff). */
function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out.join('\n');
}

module.exports = { AIService, lineDiff, listProviders };
