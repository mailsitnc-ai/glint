const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * Git service: repository status, diffs and commit helpers.
 * All operations use the system git binary and never touch the network.
 */
class GitService {
  constructor() {
    this.cache = new Map();
  }

  run(args, cwd, timeoutMs = 20000) {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout || '',
          stderr: stderr || '',
          error: error ? error.message : null,
        });
      });
    });
  }

  async isRepo(root) {
    if (!root) return false;
    const result = await this.run(['rev-parse', '--is-inside-work-tree'], root, 8000);
    return result.ok && result.stdout.trim() === 'true';
  }

  async status(root) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository', isRepo: false };

    const [branch, porcelain] = await Promise.all([
      this.run(['rev-parse', '--abbrev-ref', 'HEAD'], root),
      this.run(['status', '--porcelain=v1', '--untracked-files=all'], root),
    ]);

    const files = porcelain.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const index = line[0];
        const worktree = line[1];
        const filePath = line.slice(3).trim();
        return {
          path: filePath,
          status:
            index === '?' && worktree === '?'
              ? 'untracked'
              : index !== ' ' && worktree !== ' '
                ? 'conflicted'
                : index !== ' '
                  ? 'staged'
                  : 'modified',
          staged: index !== ' ' && index !== '?',
          untracked: index === '?',
        };
      });

    const staged = files.filter((f) => f.staged);
    const unstaged = files.filter((f) => !f.staged && !f.untracked);
    const untracked = files.filter((f) => f.untracked);

    return {
      ok: true,
      isRepo: true,
      branch: branch.stdout.trim() || 'HEAD',
      files,
      staged,
      unstaged,
      untracked,
      counts: { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length },
    };
  }

  async diff(root, filePath, staged = false) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (filePath) args.push('--', filePath);
    const result = await this.run(args, root);
    return { ok: result.ok, diff: result.stdout, error: result.error };
  }

  async stagedDiff(root) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    const result = await this.run(['diff', '--cached'], root);
    return { ok: result.ok, diff: result.stdout, error: result.error };
  }

  /** Full diff of the working tree, used as AI commit-message context. */
  async fullDiff(root) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository', diff: '' };
    const [staged, unstaged] = await Promise.all([
      this.run(['diff', '--cached'], root),
      this.run(['diff'], root),
    ]);
    let diff = '';
    if (staged.stdout.trim()) diff += `# Staged changes\n${staged.stdout}\n`;
    if (unstaged.stdout.trim()) diff += `# Unstaged changes\n${unstaged.stdout}\n`;

    if (!diff.trim()) {
      const untracked = await this.run(['ls-files', '--others', '--exclude-standard'], root);
      if (untracked.stdout.trim()) {
        diff += `# New files\n${untracked.stdout
          .split('\n')
          .filter(Boolean)
          .map((f) => `+ ${f} (new file)`)
          .join('\n')}\n`;
      }
    }

    return { ok: true, diff };
  }

  async stage(root, filePath) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    const result = await this.run(['add', '--', filePath], root);
    return { ok: result.ok, error: result.error };
  }

  async unstage(root, filePath) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    const result = await this.run(['restore', '--staged', '--', filePath], root);
    return { ok: result.ok, error: result.error };
  }

  async commit(root, message) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    if (!message || !message.trim()) return { ok: false, error: 'A commit message is required' };
    const result = await this.run(['commit', '-m', message], root, 60000);
    return {
      ok: result.ok,
      output: `${result.stdout}\n${result.stderr}`.trim(),
      error: result.error,
    };
  }

  async log(root, limit = 20) {
    if (!(await this.isRepo(root))) return { ok: false, error: 'Not a git repository' };
    const result = await this.run(
      ['log', `-${limit}`, '--pretty=format:%h|%an|%ar|%s'],
      root,
    );
    if (!result.ok) return { ok: false, error: result.error };
    const commits = result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, when, ...subject] = line.split('|');
        return { hash, author, when, subject: subject.join('|') };
      });
    return { ok: true, commits };
  }
}

module.exports = { GitService };
