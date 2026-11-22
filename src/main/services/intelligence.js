const path = require('node:path');
const fs = require('node:fs/promises');

/**
 * Intelligence service.
 *
 * Static analysis that runs entirely locally:
 *  - semantic-ish search using TF-IDF style scoring over project symbols
 *  - dead code detection by cross-referencing definitions and usages
 *  - test impact analysis by mapping source files to the tests that touch them
 *  - docstring generation templates per language
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'return', 'function', 'const', 'let', 'var', 'class',
  'import', 'export', 'from', 'as', 'async', 'await', 'new', 'this', 'try', 'catch',
  'finally', 'throw', 'def', 'self', 'public', 'private', 'protected', 'static', 'void',
  'int', 'string', 'boolean', 'float', 'double', 'type', 'interface', 'enum', 'struct',
  'fn', 'pub', 'mut', 'impl', 'package', 'with', 'not', 'and', 'or', 'in', 'is', 'none',
  'true', 'false', 'null', 'undefined', 'pass', 'raise', 'elif', 'print', 'end',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.py', '.rb', '.rs', '.go',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.lua', '.sh',
  '.yml', '.yaml', '.toml', '.md', '.html', '.css', '.scss',
]);

/** Extract identifiers, splitting camelCase and snake_case into words. */
function words(identifier) {
  return String(identifier)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract likely definition names from a source line. */
function extractDefinitions(line, language) {
  const defs = [];

  if (language === 'python') {
    const m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/);
    if (m) defs.push({ name: m[1], kind: 'function', line });
    const c = line.match(/^\s*class\s+([A-Za-z_][\w]*)/);
    if (c) defs.push({ name: c[1], kind: 'class', line });
  } else if (language === 'Rust') {
    const m = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/);
    if (m) defs.push({ name: m[1], kind: 'function', line });
    const s = line.match(/^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/);
    if (s) defs.push({ name: s[1], kind: 'struct', line });
    const e = line.match(/^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/);
    if (e) defs.push({ name: e[1], kind: 'enum', line });
  } else if (language === 'Go') {
    const m = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/);
    if (m) defs.push({ name: m[1], kind: 'function', line });
    const t = line.match(/^\s*type\s+([A-Za-z_][\w]*)/);
    if (t) defs.push({ name: t[1], kind: 'type', line });
  } else {
    const fn = line.match(/(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/);
    if (fn) defs.push({ name: fn[1], kind: 'function', line });
    const arrow = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/);
    if (arrow) defs.push({ name: arrow[1], kind: 'function', line });
    const cls = line.match(/(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (cls) defs.push({ name: cls[1], kind: 'class', line });
    const iface = line.match(/(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/);
    if (iface) defs.push({ name: iface[1], kind: 'type', line });
    const cvar = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (cvar && !defs.some((d) => d.name === cvar[1])) {
      defs.push({ name: cvar[1], kind: 'variable', line });
    }
  }

  return defs;
}

class IntelligenceService {
  constructor() {
    this.cache = new Map();
  }

  languageOf(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
      '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python', '.rb': 'Ruby',
      '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift',
      '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP',
      '.md': 'Markdown', '.json': 'JSON', '.html': 'HTML', '.css': 'CSS', '.sh': 'Shell',
    };
    return map[ext] || 'Plain Text';
  }

  /** Walk the workspace and collect all source files. */
  async collectFiles(root, limit = 4000) {
    const files = [];
    const stack = [root];
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'node_modules', '.next', '.venv', '__pycache__', '.glint', 'coverage']);

    while (stack.length && files.length < limit) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(full);
        }
      }
    }
    return files;
  }

  async readSource(filePath) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Semantic-ish search: scores files by term overlap and symbol matches,
   * then returns the most relevant lines with their file context.
   */
  async search(root, query, options = {}) {
    const limit = options.limit || 30;
    const files = await this.collectFiles(root);
    const terms = words(query).filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
    if (!terms.length) return { ok: true, results: [], filesScanned: files.length };

    const lowerTerms = terms.map((t) => t.toLowerCase());
    const results = [];
    let symbolHits = 0;

    for (const file of files) {
      const content = await this.readSource(file);
      if (!content) continue;
      const lines = content.split('\n');
      const lower = content.toLowerCase();
      const rel = path.relative(root, file);
      const language = this.languageOf(file);

      // File-level relevance
      let fileScore = 0;
      for (const term of lowerTerms) {
        const occurrences = lower.split(term).length - 1;
        if (occurrences > 0) fileScore += Math.min(occurrences, 12);
      }
      if (fileScore === 0) continue;

      // Symbol match bonus
      const definitions = [];
      lines.forEach((line, i) => {
        for (const def of extractDefinitions(line, language)) {
          const defWords = words(def.name).map((w) => w.toLowerCase());
          if (lowerTerms.some((t) => defWords.includes(t))) {
            fileScore += 6;
            symbolHits++;
            definitions.push({ ...def, lineNumber: i + 1 });
          }
        }
      });

      for (let i = 0; i < lines.length; i++) {
        const lineLower = lines[i].toLowerCase();
        let lineScore = 0;
        for (const term of lowerTerms) {
          if (lineLower.includes(term)) lineScore += 1;
        }
        if (lineScore === 0) continue;
        results.push({
          file: rel,
          absolutePath: file,
          lineNumber: i + 1,
          line: lines[i].trim().slice(0, 300),
          score: lineScore + fileScore * 0.25,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    // Deduplicate by file, keeping the best line per file up to the limit.
    const seen = new Map();
    const unique = [];
    for (const r of results) {
      const count = seen.get(r.file) || 0;
      if (count >= 4) continue;
      seen.set(r.file, count + 1);
      unique.push(r);
      if (unique.length >= limit) break;
    }

    return {
      ok: true,
      results: unique,
      filesScanned: files.length,
      symbolHits,
      terms,
    };
  }

  /** Find definitions that are never referenced elsewhere. */
  async findDeadCode(root, options = {}) {
    const files = await this.collectFiles(root);
    const definitions = [];
    const usageCount = new Map();

    // Pass 1: collect definitions
    for (const file of files) {
      const content = await this.readSource(file);
      if (!content) continue;
      const language = this.languageOf(file);
      const rel = path.relative(root, file);
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        for (const def of extractDefinitions(line, language)) {
          if (def.name.startsWith('_') && !options.includePrivate) continue;
          definitions.push({
            name: def.name,
            kind: def.kind,
            file: rel,
            absolutePath: file,
            lineNumber: i + 1,
            line: line.trim().slice(0, 200),
          });
        }
      });
    }

    // Pass 2: count usages across the whole project
    for (const file of files) {
      const content = await this.readSource(file);
      if (!content) continue;
      const rel = path.relative(root, file);
      for (const def of definitions) {
        if (def.file === rel && def.lineNumber) continue;
        const pattern = new RegExp(`\\b${def.name.replace(/[$]/g, '\\$')}\\b`, 'g');
        const count = (content.match(pattern) || []).length;
        if (count > 0) usageCount.set(def.name, (usageCount.get(def.name) || 0) + count);
      }
    }

    const dead = definitions
      .filter((d) => !usageCount.get(d.name))
      .map((d) => ({ ...d, reason: 'No references found in the project' }));

    return { ok: true, dead, totalDefinitions: definitions.length };
  }

  /**
   * Map source files to tests that reference them, and estimate the impact
   * of a change to each source file.
   */
  async testImpact(root, changedFiles = []) {
    const files = await this.collectFiles(root);
    const testFiles = files.filter((f) => {
      const rel = path.relative(root, f).toLowerCase();
      return (
        /(^|\/)(tests?|__tests__|spec)(\/|$)/.test(rel) ||
        /\.(test|spec)\.[a-z]+$/.test(rel) ||
        /(^|\/)test_[^/]+\.py$/.test(rel) ||
        /_test\.(py|go|rb)$/.test(rel)
      );
    });

    const sourceFiles = files.filter((f) => !testFiles.includes(f));
    const impacts = [];

    for (const changed of changedFiles.length ? changedFiles : sourceFiles) {
      const changedRel = path.relative(root, changed);
      const changedBase = path.basename(changed).replace(/\.[^.]+$/, '');
      const affected = [];

      for (const test of testFiles) {
        const content = await this.readSource(test);
        const testRel = path.relative(root, test);
        let score = 0;
        const reasons = [];

        // Direct import/reference of the changed module
        if (content.includes(changedRel) || content.includes(`./${path.basename(changed)}`)) {
          score += 10;
          reasons.push('imports the changed module');
        }
        if (content.includes(changedBase)) {
          score += 4;
          reasons.push(`mentions "${changedBase}"`);
        }

        // Directory proximity (tests usually live near their source)
        const testDir = path.dirname(test);
        const changedDir = path.dirname(changed);
        if (testDir === changedDir) {
          score += 3;
          reasons.push('lives alongside the changed file');
        } else if (testDir.startsWith(changedDir) || changedDir.startsWith(testDir)) {
          score += 1;
        }

        if (score > 0) {
          affected.push({ test: testRel, absolutePath: test, score, reasons });
        }
      }

      affected.sort((a, b) => b.score - a.score);
      impacts.push({
        file: changedRel,
        affectedTests: affected,
        risk: affected.length === 0 ? 'none' : affected.length > 3 ? 'high' : 'medium',
      });
    }

    return { ok: true, impacts, testFileCount: testFiles.length };
  }

  /** Generate a documentation comment for a function without calling an AI. */
  generateDocstring(code, language) {
    const lines = code.split('\n');
    const signature = lines[0] || '';
    const nameMatch = signature.match(/(?:function\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_][\w]*)|fn\s+([A-Za-z_][\w]*)|func\s+([A-Za-z_][\w]*))/);
    const name = nameMatch ? nameMatch.slice(1).find(Boolean) : 'function';

    const params = [];
    const paramMatch = signature.match(/\(([^)]*)\)/);
    if (paramMatch) {
      for (const raw of paramMatch[1].split(',')) {
        const p = raw.trim().split(/[:=]/)[0].trim().replace(/^\*+/, '');
        if (p && !['self', 'this'].includes(p)) params.push(p);
      }
    }

    const returnsMatch = code.match(/->\s*([A-Za-z_$][\w$<>\[\]| ]*)/);
    const returns = returnsMatch ? returnsMatch[1].trim() : null;

    const body = [];
    const bodyLines = lines.slice(1).filter((l) => l.trim() && !l.trim().startsWith('//'));
    const inferred = [];
    for (const line of bodyLines) {
      if (/console\.(log|error|warn)/.test(line)) inferred.push('logs output');
      else if (/throw\s+/.test(line)) inferred.push('may throw on invalid input');
      else if (/return\s+/.test(line)) inferred.push('returns a computed result');
      else if (/\bawait\b/.test(line)) inferred.push('performs asynchronous work');
      else if (/\bfetch\b|\baxios\b/.test(line)) inferred.push('performs network I/O');
      else if (/\.map\(|\.filter\(|\.reduce\(/.test(line)) inferred.push('transforms a collection');
      else if (/for\s*\(|while\s*\(/.test(line)) inferred.push('iterates over data');
    }

    const summary = inferred.length
      ? `${name} ${inferred.slice(0, 2).join(' and ')}.`
      : `${name} implementation.`;

    if (language === 'Python') {
      const out = ['"""', summary];
      if (params.length) {
        out.push('');
        out.push('Args:');
        for (const p of params) out.push(`    ${p}: Description of ${p}.`);
      }
      if (returns) {
        out.push('');
        out.push('Returns:');
        out.push(`    ${returns}: The result.`);
      }
      out.push('"""');
      return out.join('\n');
    }

    const out = ['/**', ` * ${summary}`];
    if (params.length) {
      out.push(' *');
      for (const p of params) out.push(` * @param {*} ${p} - Description of ${p}.`);
    }
    if (returns) out.push(` * @returns {${returns}} The result.`);
    out.push(' */');
    return out.join('\n');
  }

  /** Analyse the project and return a summary of its shape. */
  async projectOverview(root) {
    const files = await this.collectFiles(root);
    const byLanguage = {};
    let totalLines = 0;
    let totalSize = 0;

    for (const file of files) {
      const language = this.languageOf(file);
      byLanguage[language] = (byLanguage[language] || 0) + 1;
      const content = await this.readSource(file);
      totalLines += content.split('\n').length;
      totalSize += Buffer.byteLength(content);
    }

    const dead = await this.findDeadCode(root);
    const impact = await this.testImpact(root);

    return {
      ok: true,
      files: files.length,
      lines: totalLines,
      bytes: totalSize,
      byLanguage,
      deadCodeCount: dead.dead.length,
      testFiles: impact.testFileCount,
    };
  }
}

module.exports = { IntelligenceService, extractDefinitions, words, STOP_WORDS };
