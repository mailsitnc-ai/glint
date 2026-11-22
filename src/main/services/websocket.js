const crypto = require('node:crypto');
const net = require('node:net');
const { EventEmitter } = require('node:events');

/**
 * Minimal RFC6455 WebSocket client and server.
 *
 * Implemented in-tree so Glint has zero runtime dependencies and can
 * collaborate on a local network without pulling in a websocket package.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  const length = data.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | opcode;
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) masked[i] = data[i] ^ mask[i % 4];

  return Buffer.concat([header, mask, masked]);
}

/** Decode frames out of a growing buffer. */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    let maskKey = null;
    if (masked) {
      if (buffer.length - offset < headerLength + 4) break;
      maskKey = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      headerLength += 4;
    }

    if (buffer.length - offset < headerLength + length) break;

    const payload = Buffer.from(buffer.subarray(offset + headerLength, offset + headerLength + length));
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }

    frames.push({ fin, opcode, payload });
    offset += headerLength + length;
  }

  return { frames, rest: buffer.subarray(offset) };
}

/** Client-side websocket wrapper. */
class WebSocketClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.buffer = Buffer.alloc(0);
    this.socket = null;
    this.handshakeDone = false;
  }

  connect() {
    const parsed = new URL(this.url);
    const secure = parsed.protocol === 'wss:';
    const port = parsed.port || (secure ? 443 : 80);
    const key = crypto.randomBytes(16).toString('base64');

    this.socket = net.connect({ host: parsed.hostname, port: Number(port) }, () => {
      const request =
        `GET ${parsed.pathname || '/'} HTTP/1.1\r\n` +
        `Host: ${parsed.hostname}:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n';
      this.socket.write(request);
    });

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      if (!this.handshakeDone) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headers = this.buffer.subarray(0, headerEnd).toString();
        if (!/101/i.test(headers.split('\r\n')[0])) {
          this.emit('error', new Error('WebSocket handshake failed'));
          this.socket.destroy();
          return;
        }
        this.buffer = this.buffer.subarray(headerEnd + 4);
        this.handshakeDone = true;
        this.readyState = 1;
        this.emit('open');
      }

      const { frames, rest } = decodeFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          this.emit('close');
          this.socket.end();
        } else if (frame.opcode === 0x9) {
          this.socket.write(encodeFrame(frame.payload, 0xa));
        } else if (frame.opcode === 0x1 || frame.opcode === 0x2 || frame.opcode === 0x0) {
          this.emit('message', frame.payload.toString('utf-8'));
        }
      }
    });

    this.socket.on('error', (err) => this.emit('error', err));
    this.socket.on('close', () => {
      this.readyState = 3;
      this.emit('close');
    });
  }

  send(data) {
    if (this.readyState !== 1) return false;
    this.socket.write(encodeFrame(data, 0x1));
    return true;
  }

  close() {
    try {
      if (this.readyState === 1) this.socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      this.socket.end();
    } catch {
      /* ignore */
    }
    this.readyState = 3;
  }
}

/** Server-side websocket handling on top of a raw TCP server. */
class WebSocketServer extends EventEmitter {
  constructor(httpServer) {
    super();
    this.clients = new Set();
    httpServer.on('upgrade', (req, socket) => this.handleUpgrade(req, socket));
  }

  handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const client = new SocketClient(socket);
    this.clients.add(client);
    client.on('message', (data) => this.emit('message', data, client));
    client.on('close', () => {
      this.clients.delete(client);
      this.emit('client-close', client);
    });
  }

  broadcast(data) {
    const frame = encodeFrame(data, 0x1);
    for (const client of this.clients) {
      try {
        client.socket.write(frame);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Wraps an upgraded TCP socket into a frame-oriented client. */
class SocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.id = crypto.randomUUID().slice(0, 8);
    this.name = `peer-${this.id}`;
    this.color = '#38bdf8';

    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { frames, rest } = decodeFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          this.emit('close');
          socket.end();
        } else if (frame.opcode === 0x9) {
          socket.write(encodeFrame(frame.payload, 0xa));
        } else if (frame.opcode === 0x1 || frame.opcode === 0x0) {
          this.emit('message', frame.payload.toString('utf-8'));
        }
      }
    });

    socket.on('error', () => this.emit('close'));
    socket.on('close', () => this.emit('close'));
  }

  send(data) {
    try {
      this.socket.write(encodeFrame(data, 0x1));
    } catch {
      /* ignore */
    }
  }
}

module.exports = { WebSocketClient, WebSocketServer, encodeFrame, decodeFrames };
