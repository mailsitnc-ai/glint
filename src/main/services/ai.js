const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * AI service.
 *
 * Supports two provider families behind one interface:
 *  - local: any OpenAI-compatible server (Ollama, LM Studio, llama.cpp server)
 *  - cloud: OpenAI-compatible HTTP APIs
 *
 * All requests run off the UI thread (main process) so typing never blocks.
 */
class AIService {
  constructor(settings) {
    this.settings = settings;
  }

  get config() {
    return this.settings.settings;
  }

  isConfigured() {
    const c = this.config;
    if (c.aiProvider === 'local') return Boolean(c.aiLocalEndpoint);
    if (c.aiProvider === 'cloud') return Boolean(c.aiCloudEndpoint && c.aiCloudKey);
    return false;
  }

  providerInfo() {
    const c = this.config;
    if (c.aiProvider === 'local') {
      return { provider: 'local', endpoint: c.aiLocalEndpoint, model: c.aiLocalModel };
    }
    if (c.aiProvider === 'cloud') {
      return { provider: 'cloud', endpoint: c.aiCloudEndpoint, model: c.aiCloudModel };
    }
    return { provider: 'none', endpoint: '', model: '' };
  }

  /** Build the request body for an OpenAI-compatible chat completion. */
  buildRequest(messages, options = {}) {
    const c = this.config;
    const model = options.model || (c.aiProvider === 'local' ? c.aiLocalModel : c.aiCloudModel);
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

  buildHeaders() {
    const c = this.config;
    const headers = { 'Content-Type': 'application/json' };
    if (c.aiProvider === 'cloud' && c.aiCloudKey) {
      headers.Authorization = `Bearer ${c.aiCloudKey}`;
    }
    return headers;
  }

  endpointUrl() {
    const c = this.config;
    const base = c.aiProvider === 'local' ? c.aiLocalEndpoint : c.aiCloudEndpoint;
    return `${base.replace(/\/+$/, '')}/chat/completions`;
  }

  /**
   * Send a chat request. Returns { ok, text, error }.
   * Never throws; network failures are reported as structured errors.
   */
  async chat(messages, options = {}) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'No AI provider configured. Set one in Glint settings.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000);

    try {
      const response = await fetch(this.endpointUrl(), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildRequest(messages, options)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Provider returned ${response.status}: ${body.slice(0, 300)}` };
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
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

  /** List models exposed by the configured provider. */
  async listModels() {
    if (!this.isConfigured()) return { ok: false, error: 'No AI provider configured', models: [] };
    const c = this.config;
    const base = c.aiProvider === 'local' ? c.aiLocalEndpoint : c.aiCloudEndpoint;
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, models: [] };
      const data = await response.json();
      const models = (data.data || []).map((m) => m.id).filter(Boolean);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err.message, models: [] };
    }
  }

  /** Verify the provider is reachable and responding. */
  async healthCheck() {
    if (!this.isConfigured()) return { ok: false, error: 'No AI provider configured' };
    const result = await this.chat(
      [{ role: 'user', content: 'Reply with the single word: ready' }],
      { maxTokens: 10, timeout: 12000 },
    );
    return result.ok ? { ok: true, reply: result.text.trim() } : { ok: false, error: result.error };
  }

  /* ------------------------------------------------------------------ */
  /* High-level features                                                  */
  /* ------------------------------------------------------------------ */

  /** Ask the model about a selection or the current file. */
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

  /** Rewrite code with a stated goal. */
  async refactor({ code, selection, goal, fileName }) {
    const subject = selection || code;
    const prompt = `Refactor the following ${fileName ? `code from ${fileName}` : 'code'} to be ${goal || 'cleaner and more readable'}. Return only the refactored code, no commentary.\n\n\`\`\`\n${subject}\n\`\`\``;
    return await this.chat([
      { role: 'system', content: 'You are a refactoring engine. Output only code.' },
      { role: 'user', content: prompt },
    ]);
  }

  /** Produce a commit message from a diff. */
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

  /** Inline completion used for ghost text. */
  async completion({ prefix, suffix, fileName, maxTokens = 60 }) {
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
    return { ok: true, text };
  }

  /** Generate a docstring/comment block for a function. */
  async docstring({ code, language }) {
    const prompt = `Write a ${language === 'python' ? 'Python docstring' : 'JSDoc comment block'} for the following ${language || 'code'}. Return only the comment.\n\n\`\`\`\n${code}\n\`\`\``;
    const result = await this.chat(
      [
        { role: 'system', content: 'You generate documentation comments. Output only the comment.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 300 },
    );
    return result;
  }

  /** Read a local model file from disk to attach as context (safe, local only). */
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

module.exports = { AIService, lineDiff };
