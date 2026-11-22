/* ==========================================================================
   Collaboration module: session lifecycle, remote cursors, chat.
   ========================================================================== */

const PEER_COLORS = ['#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

export class CollaborationModule {
  constructor(api, options = {}) {
    this.api = api;
    this.onPeers = options.onPeers || (() => {});
    this.onRemoteEdit = options.onRemoteEdit || (() => {});
    this.onRemoteCursor = options.onRemoteCursor || (() => {});
    this.onChat = options.onChat || (() => {});
    this.onStatus = options.onStatus || (() => {});

    this.peers = [];
    this.session = null;
    this.messages = [];
    this.active = false;

    this.api.onCollabEvent((event) => this.handleEvent(event));
  }

  handleEvent(event) {
    switch (event.type) {
      case 'peer-join':
        this.peers.push(event.peer);
        this.onPeers(this.peers);
        break;
      case 'peer-leave':
        this.peers = this.peers.filter((p) => p.id !== event.peerId);
        this.onPeers(this.peers);
        break;
      case 'peers':
        this.peers = event.peers || [];
        this.onPeers(this.peers);
        break;
      case 'operation':
        this.onRemoteEdit(event.peerId, event.op);
        break;
      case 'cursor':
        this.onRemoteCursor(event.peerId, event.cursor);
        break;
      case 'chat':
        this.messages.push({ peerId: event.peerId, message: event.message, self: false });
        this.onChat(this.messages);
        break;
      default:
        break;
    }
  }

  /** Host a session on this machine. */
  async start(options = {}) {
    const result = await this.api.collabStart(options);
    if (!result.ok) return result;
    this.session = result;
    this.active = true;
    this.peers = await this.api.collabPeers();
    this.onPeers(this.peers);
    this.onStatus({ active: true, session: result });
    return result;
  }

  /** Join an existing session. */
  async join(url, options = {}) {
    const result = await this.api.collabJoin(url, options);
    if (!result.ok) return result;
    this.session = result;
    this.active = true;
    this.peers = await this.api.collabPeers();
    this.onPeers(this.peers);
    this.onStatus({ active: true, session: result });
    return result;
  }

  async stop() {
    await this.api.collabStop();
    this.active = false;
    this.session = null;
    this.peers = [];
    this.onPeers(this.peers);
    this.onStatus({ active: false });
  }

  /** Broadcast a local edit. */
  broadcastEdit(filePath, before, after) {
    if (!this.active) return;
    this.api.collabOperation(filePath, before, after);
  }

  /** Broadcast the local cursor position. */
  broadcastCursor(filePath, line, column) {
    if (!this.active) return;
    this.api.collabCursor(filePath, { line, column });
  }

  /** Apply a remote operation to local content. */
  async applyRemote(filePath, op, currentText) {
    return await this.api.collabApply(filePath, op, currentText);
  }

  sendChat(message) {
    if (!this.active || !message.trim()) return;
    this.messages.push({ peerId: 'self', message, self: true });
    this.onChat(this.messages);
    this.api.collabChat(message);
  }

  colorFor(peerId) {
    const index = this.peers.findIndex((p) => p.id === peerId);
    return PEER_COLORS[(index < 0 ? 0 : index) % PEER_COLORS.length];
  }

  nameFor(peerId) {
    const peer = this.peers.find((p) => p.id === peerId);
    return peer ? peer.name : 'peer';
  }
}
