const http = require('node:http');
const { WebSocketServer } = require('./websocket');

/**
 * Relay server for collaboration rooms.
 *
 * Runs on the host machine so collaborators connect over the LAN (or through
 * any tunnel). Keeps peers, operations, cursors and chat in memory.
 */
class RelayServer {
  constructor(options) {
    this.roomId = options.roomId;
    this.options = options;
    this.clients = new Map(); // socket -> peer
    this.port = 0;
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer(this.server);
    this.wss.on('message', (data, client) => this.handleMessage(data, client));
    this.wss.on('client-close', (client) => this.handleLeave(client));
  }

  async listen(port = 0) {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
    return this.port;
  }

  handleHttp(req, res) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, room: this.roomId, peers: this.clients.size }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Glint collaboration relay for room ${this.roomId}\n`);
  }

  handleMessage(data, client) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        client.name = msg.name || client.name;
        client.color = msg.color || client.color;
        this.clients.set(client, { id: client.id, name: client.name, color: client.color });
        // Send the current peer list to the joiner.
        client.send(JSON.stringify({ type: 'peers', peers: [...this.clients.values()] }));
        // Tell everyone else about the new peer.
        this.broadcast(JSON.stringify({ type: 'peer-join', peer: { id: client.id, name: client.name, color: client.color } }), client);
        if (this.options.onPeerJoin) {
          this.options.onPeerJoin({ id: client.id, name: client.name, color: client.color });
        }
        break;
      }
      case 'operation':
        this.broadcast(JSON.stringify({ type: 'operation', peerId: client.id, op: msg.op }), client);
        if (this.options.onOperation) this.options.onOperation(client.id, msg.op);
        break;
      case 'cursor':
        this.broadcast(JSON.stringify({ type: 'cursor', peerId: client.id, cursor: msg.cursor }), client);
        if (this.options.onCursor) this.options.onCursor(client.id, msg.cursor);
        break;
      case 'chat':
        this.broadcast(JSON.stringify({ type: 'chat', peerId: client.id, message: msg.message }), client);
        if (this.options.onChat) this.options.onChat(client.id, msg.message);
        break;
      default:
        break;
    }
  }

  handleLeave(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    this.broadcast(JSON.stringify({ type: 'peer-leave', peerId: client.id }));
    if (this.options.onPeerLeave) this.options.onPeerLeave(client.id);
  }

  broadcast(payload, exclude = null) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const client of this.clients.keys()) {
      if (client === exclude) continue;
      client.send(text);
    }
  }

  broadcastOperation(op) {
    this.broadcast(JSON.stringify({ type: 'operation', peerId: 'host', op }));
  }

  broadcastCursor(filePath, cursor) {
    this.broadcast(JSON.stringify({ type: 'cursor', peerId: 'host', cursor: { filePath, ...cursor } }));
  }

  broadcastChat(message) {
    this.broadcast(JSON.stringify({ type: 'chat', peerId: 'host', message }));
  }

  async close() {
    for (const client of this.clients.keys()) {
      try {
        client.socket.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

module.exports = { RelayServer };
