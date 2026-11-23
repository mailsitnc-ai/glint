const path = require('node:path');
const fs = require('node:fs/promises');

/**
 * Model archive.
 *
 * Archived models are hidden from the pickers and never routed to, but stay
 * recoverable. This mirrors CAELIX's behaviour: a model is archived with the
 * reason it was archived, and can be brought back at any time.
 */
class ArchiveService {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'archived-models.json');
    this.archive = {};
  }

  async init() {
    await this.load();
    return this.archive;
  }

  async load() {
    try {
      this.archive = JSON.parse(await fs.readFile(this.file, 'utf-8')) || {};
    } catch {
      this.archive = {};
    }
    return this.archive;
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(this.archive, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  key(providerId, modelId) {
    return `${providerId}::${modelId}`;
  }

  isArchived(providerId, modelId) {
    return Boolean(this.archive[this.key(providerId, modelId)]);
  }

  /**
   * Archive a model.
   * @param {string} providerId
   * @param {string} modelId
   * @param {string} reason - why it was archived
   */
  async archiveModel(providerId, modelId, reason = 'Archived by user') {
    if (!providerId || !modelId) return { ok: false, error: 'A provider and model are required' };
    const key = this.key(providerId, modelId);
    this.archive[key] = {
      provider: providerId,
      id: modelId,
      reason,
      at: new Date().toISOString(),
    };
    await this.save();
    return { ok: true, entry: this.archive[key] };
  }

  /** Bring an archived model back. */
  async unarchiveModel(providerId, modelId) {
    const key = this.key(providerId, modelId);
    if (!this.archive[key]) return { ok: false, error: 'That model is not archived' };
    delete this.archive[key];
    await this.save();
    return { ok: true };
  }

  /** All archived entries, newest first. */
  list() {
    return Object.values(this.archive).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }

  /** Archived entries for one provider. */
  listForProvider(providerId) {
    return this.list().filter((entry) => entry.provider === providerId);
  }

  /** Clear the whole archive. */
  async clear() {
    this.archive = {};
    await this.save();
    return { ok: true };
  }
}

module.exports = { ArchiveService };
