const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');

/**
 * Collaboration service.
 *
 * Implements a lightweight operational-transform-free sync model:
 * each client owns a monotonically increasing sequence number, edits are
 * broadcast as operations, and the receiving side applies them by id.
 *
 * A built-in relay server is included so two machines on the same network
 * (or via a tunnel) can collaborate without any external service.
 */

/** Apply a single operation to a string. */
function applyOperation(text, op) {
  const { position, deleteCount, insert } = op;
  const safePos = Math.max(0, Math.min(position ?? text.length, text.length));
  const removed = deleteCount ? text.slice(safePos, safePos + deleteCount) : '';
  return text.slice(0, safePos) + (insert || '') + text.slice(safePos + (deleteCount || 0));
}

/** Compute a diff-based operation between two strings. */
function computeOperation(before, after) {
  if (before === after) return null;

  // Common prefix
  let start = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (start < maxPrefix && before[start] === after[start]) start++;

  // Common suffix
  let end = 0;
  const maxSuffix = Math.min(before.length - start, after.length - start);
  while (
    end < maxSuffix &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }

  const deleted = before.slice(start, before.length - end);
  const inserted = after.slice(start, after.length - end);

  return {
    position: start,
    deleteCount: deleted.length,
    insert: inserted,
  };
}

class CollaborationService {
  constructor(settings) {
    this.settings = settings;
    this.room = null;
    this.clientId = crypto.randomUUID().slice(0, 8);
    this.socket = null;
    this.documents = new Map(); // filePath -> { text, version, ops: Map }
    this.peers = new Map(); // peerId -> { id, name, color, cursor }
    this.onEvent = () => {};
    this.connected = false;
  }

  get displayName() {
    return this.settings.settings.collabDisplayName || `dev-${this.clientId}`;
  }

  /** Create a room and start the relay server. */
  async startLocalRoom(workspacePath, options = {}) {
    const roomId = options.room || `glint-${crypto.randomBytes(4).toString('hex')}`;
    this.room = {
      id: roomId,
      workspacePath,
      host: true,
      port: options.port || 0,
      createdAt: Date.now(),
    };

    const { RelayServer } = require('./relay');
    this.relay = new RelayServer({
      roomId,
      onPeerJoin: (peer) => this.onEvent({ type: 'peer-join', peer }),
      onPeerLeave: (peerId) => this.onEvent({ type: 'peer-leave', peerId }),
      onOperation: (peerId, op) => this.onEvent({ type: 'operation', peerId, op }),
      onCursor: (peerId, cursor) => this.onEvent({ type: 'cursor', peerId, cursor }),
      onChat: (peerId, message) => this.onEvent({ type: 'chat', peerId, message }),
    });

    await this.relay.listen(options.port || 0);
    this.room.port = this.relay.port;

    // Join our own room as a peer.
    this.peers.set(this.clientId, {
      id: this.clientId,
      name: this.displayName,
      color: '#38bdf8',
      cursor: null,
      self: true,
    });

    return {
      room: this.room.id,
      port: this.room.port,
      url: `ws://${this.localAddress()}:${this.room.port}`,
      clientId: this.clientId,
    };
  }

  localAddress() {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address;
      }
    }
    return '127.0.0.1';
  }

  /** Join an existing room over a websocket URL. */
  async joinRoom(url, options = {}) {
    const WebSocketImpl = require('./websocket');
    this.socket = new WebSocketImpl(url);
    this.room = { id: options.room || 'remote', host: false, url };

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 10000);
      this.socket.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });
      this.socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    this.socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.socket.send(
      JSON.stringify({
        type: 'join',
        room: this.room.id,
        name: options.name || this.displayName,
        clientId: this.clientId,
      }),
    );

    return { room: this.room.id, url, clientId: this.clientId };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'peer-join':
        this.peers.set(msg.peer.id, msg.peer);
        this.onEvent({ type: 'peer-join', peer: msg.peer });
        break;
      case 'peer-leave':
        this.peers.delete(msg.peerId);
        this.onEvent({ type: 'peer-leave', peerId: msg.peerId });
        break;
      case 'peers':
        this.peers.clear();
        for (const peer of msg.peers || []) this.peers.set(peer.id, peer);
        this.onEvent({ type: 'peers', peers: [...this.peers.values()] });
        break;
      case 'operation':
        this.onEvent({ type: 'operation', peerId: msg.peerId, op: msg.op });
        break;
      case 'cursor':
        this.onEvent({ type: 'cursor', peerId: msg.peerId, cursor: msg.cursor });
        break;
      case 'chat':
        this.onEvent({ type: 'chat', peerId: msg.peerId, message: msg.message });
        break;
      default:
        break;
    }
  }

  /** Broadcast a local edit to peers. */
  broadcastOperation(filePath, before, after) {
    const op = computeOperation(before, after);
    if (!op) return null;
    op.id = crypto.randomUUID();
    op.filePath = filePath;
    op.clientId = this.clientId;
    op.timestamp = Date.now();

    const doc = this.documents.get(filePath) || { text: after, version: 0 };
    doc.text = after;
    doc.version++;
    this.documents.set(filePath, doc);

    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify({ type: 'operation', op }));
    } else if (this.relay) {
      this.relay.broadcastOperation(op);
    }
    return op;
  }

  broadcastCursor(filePath, cursor) {
    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify({ type: 'cursor', filePath, cursor }));
    } else if (this.relay) {
      this.relay.broadcastCursor(filePath, cursor);
    }
  }

  sendChat(message) {
    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify({ type: 'chat', message }));
    } else if (this.relay) {
      this.relay.broadcastChat(message);
    }
  }

  /** Apply a remote operation locally and return the new text. */
  applyRemote(filePath, op, currentText) {
    const doc = this.documents.get(filePath) || { text: currentText, version: 0 };
    if (doc.appliedOps && doc.appliedOps.has(op.id)) return doc.text;
    doc.text = applyOperation(doc.text, op);
    doc.version++;
    doc.appliedOps = doc.appliedOps || new Set();
    doc.appliedOps.add(op.id);
    this.documents.set(filePath, doc);
    return doc.text;
  }

  getPeers() {
    return [...this.peers.values()];
  }

  async stop() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    if (this.relay) {
      await this.relay.close();
      this.relay = null;
    }
    this.connected = false;
    this.room = null;
    this.peers.clear();
  }
}

module.exports = { CollaborationService, applyOperation, computeOperation };
