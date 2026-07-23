/* ============================================================
   SYNC SERVER — Authoritative WebSocket & HTTP Server
   Serves static web files & status dashboard on HTTP,
   and handles authoritative room sync on WebSockets.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { performance } = require('perf_hooks');

const PORT = process.env.PORT || 3000;
const SCHEDULED_START_BUFFER_MS = 300;

// ========== State ==========
const rooms = new Map();       // code → room
const clientRooms = new Map(); // ws → code

// ========== Utilities ==========
function generateCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function serverNow() {
  return performance.now();
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  for (const member of room.members) {
    if (member.ws !== excludeWs && member.ws.readyState === 1) {
      member.ws.send(data);
    }
  }
}

function getRoom(ws) {
  const code = clientRooms.get(ws);
  return code ? rooms.get(code) : null;
}

function removeMember(ws) {
  const code = clientRooms.get(ws);
  if (!code) return;

  const room = rooms.get(code);
  if (!room) { clientRooms.delete(ws); return; }

  const idx = room.members.findIndex(m => m.ws === ws);
  if (idx < 0) { clientRooms.delete(ws); return; }

  const member = room.members[idx];
  room.members.splice(idx, 1);
  clientRooms.delete(ws);

  // Announce departure
  broadcast(room, { type: 'member-left', username: member.username });

  // Host migration
  if (member.isHost && room.members.length > 0) {
    room.members[0].isHost = true;
    sendTo(room.members[0].ws, { type: 'host-changed', newHost: room.members[0].username, isYou: true });
    broadcast(room, {
      type: 'host-changed',
      newHost: room.members[0].username,
    }, room.members[0].ws);
  }

  // Cleanup empty rooms
  if (room.members.length === 0) {
    rooms.delete(code);
    console.log(`[room] ${code} destroyed (empty)`);
  }
}

// ========== MIME TYPES ==========
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ========== HTTP SERVER ==========
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(__dirname, reqPath);

  // Security check — prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Check if requested file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If endpoint is /status, return server telemetry JSON
      if (reqPath === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          uptime: process.uptime(),
          roomsCount: rooms.size,
          clientsCount: clientRooms.size,
          rooms: Array.from(rooms.values()).map(r => ({
            code: r.code,
            type: r.type,
            members: r.members.length,
            isPlaying: r.playback.isPlaying,
            trackId: r.playback.trackId,
          })),
        }));
        return;
      }

      // Serve 404 page
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>404 — sumit.sh sync server</title>
          <style>
            body { background: #0a0a0a; color: #00ff41; font-family: monospace; padding: 2rem; }
            a { color: #00d4ff; text-decoration: none; }
          </style>
        </head>
        <body>
          <h2>[ 404 ] File Not Found</h2>
          <p>The requested path <code>${reqPath}</code> was not found.</p>
          <p><a href="/">← Return to sumit.sh portfolio</a></p>
        </body>
        </html>
      `);
      return;
    }

    // Serve static file
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ========== WEBSOCKET SERVER ==========
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).slice(2, 10);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ---- Clock Sync ----
      case 'ping': {
        sendTo(ws, {
          type: 'pong',
          serverTime: serverNow(),
          pingId: msg.pingId,
        });
        break;
      }

      // ---- Create Room ----
      case 'create-room': {
        removeMember(ws);

        const code = generateCode();
        const username = msg.username || `user_${clientId.slice(0, 4)}`;
        const room = {
          code,
          type: msg.roomType || 'jam',
          members: [{
            ws, id: clientId, username, isHost: true,
          }],
          playback: {
            trackId: null,
            isPlaying: false,
            positionAtOrigin: 0,
            originServerTime: serverNow(),
          },
          queue: [],
        };

        rooms.set(code, room);
        clientRooms.set(ws, code);

        sendTo(ws, {
          type: 'room-created',
          code,
          isHost: true,
          username,
        });

        console.log(`[room] ${code} created (${room.type}) by ${username}`);
        break;
      }

      // ---- Join Room ----
      case 'join-room': {
        const code = (msg.code || '').toLowerCase().trim();
        const room = rooms.get(code);

        if (!room) {
          sendTo(ws, { type: 'error', message: 'Room not found' });
          break;
        }

        removeMember(ws);

        const username = msg.username || `user_${clientId.slice(0, 4)}`;
        room.members.push({
          ws, id: clientId, username, isHost: false,
        });
        clientRooms.set(ws, code);

        sendTo(ws, {
          type: 'room-joined',
          code,
          isHost: false,
          username,
          playback: room.playback,
          queue: room.queue.map(t => ({ videoId: t.videoId, title: t.title })),
          members: room.members.map(m => ({
            username: m.username, isHost: m.isHost,
          })),
        });

        broadcast(room, { type: 'member-joined', username }, ws);

        console.log(`[room] ${code} ← ${username} joined (${room.members.length} members)`);
        break;
      }

      // ---- Leave Room ----
      case 'leave-room': {
        removeMember(ws);
        break;
      }

      // ---- Play ----
      case 'play': {
        const room = getRoom(ws);
        if (!room) break;

        const now = serverNow();
        const scheduledStart = now + SCHEDULED_START_BUFFER_MS;

        const position = msg.position !== undefined
          ? msg.position
          : room.playback.positionAtOrigin;

        room.playback = {
          trackId: msg.trackId || room.playback.trackId,
          isPlaying: true,
          positionAtOrigin: position,
          originServerTime: scheduledStart,
        };

        broadcast(room, {
          type: 'play',
          trackId: room.playback.trackId,
          positionAtOrigin: position,
          originServerTime: scheduledStart,
          scheduledStart,
        });
        break;
      }

      // ---- Pause ----
      case 'pause': {
        const room = getRoom(ws);
        if (!room) break;

        const now = serverNow();

        let currentPos = room.playback.positionAtOrigin;
        if (room.playback.isPlaying) {
          currentPos += (now - room.playback.originServerTime) / 1000;
        }

        room.playback = {
          ...room.playback,
          isPlaying: false,
          positionAtOrigin: Math.max(0, currentPos),
          originServerTime: now,
        };

        broadcast(room, {
          type: 'pause',
          positionAtOrigin: room.playback.positionAtOrigin,
          originServerTime: now,
        });
        break;
      }

      // ---- Seek ----
      case 'seek': {
        const room = getRoom(ws);
        if (!room) break;

        const now = serverNow();
        room.playback = {
          ...room.playback,
          positionAtOrigin: msg.position,
          originServerTime: now,
        };

        broadcast(room, {
          type: 'seek',
          positionAtOrigin: msg.position,
          originServerTime: now,
          isPlaying: room.playback.isPlaying,
        });
        break;
      }

      // ---- Load Track ----
      case 'load-track': {
        const room = getRoom(ws);
        if (!room) break;

        const now = serverNow();
        const scheduledStart = now + SCHEDULED_START_BUFFER_MS;

        room.playback = {
          trackId: msg.trackId,
          isPlaying: true,
          positionAtOrigin: 0,
          originServerTime: scheduledStart,
        };

        broadcast(room, {
          type: 'load-track',
          trackId: msg.trackId,
          title: msg.title || `YouTube: ${msg.trackId}`,
          positionAtOrigin: 0,
          originServerTime: scheduledStart,
          scheduledStart,
        });
        break;
      }

      // ---- Queue Add ----
      case 'queue-add': {
        const room = getRoom(ws);
        if (!room || !msg.track) break;

        if (!room.queue.find(t => t.videoId === msg.track.videoId)) {
          room.queue.push({
            videoId: msg.track.videoId,
            title: msg.track.title || `YouTube: ${msg.track.videoId}`,
          });
          broadcast(room, {
            type: 'queue-update',
            queue: room.queue,
          });
        }
        break;
      }

      // ---- Queue Remove ----
      case 'queue-remove': {
        const room = getRoom(ws);
        if (!room) break;

        room.queue = room.queue.filter(t => t.videoId !== msg.videoId);
        broadcast(room, {
          type: 'queue-update',
          queue: room.queue,
        });
        break;
      }

      // ---- Skip ----
      case 'skip': {
        const room = getRoom(ws);
        if (!room || room.queue.length === 0) break;

        const currentIdx = room.queue.findIndex(
          t => t.videoId === room.playback.trackId
        );
        const nextIdx = currentIdx + 1;

        if (nextIdx < room.queue.length) {
          const next = room.queue[nextIdx];
          const now = serverNow();
          const scheduledStart = now + SCHEDULED_START_BUFFER_MS;

          room.playback = {
            trackId: next.videoId,
            isPlaying: true,
            positionAtOrigin: 0,
            originServerTime: scheduledStart,
          };

          broadcast(room, {
            type: 'load-track',
            trackId: next.videoId,
            title: next.title,
            positionAtOrigin: 0,
            originServerTime: scheduledStart,
            scheduledStart,
          });
        } else {
          broadcast(room, { type: 'queue-ended' });
        }
        break;
      }

      // ---- Chat (watch party) ----
      case 'chat': {
        const room = getRoom(ws);
        if (!room || !msg.text) break;

        const member = room.members.find(m => m.ws === ws);
        const username = member ? member.username : 'anon';

        broadcast(room, {
          type: 'chat',
          user: username,
          text: msg.text,
        });
        break;
      }

      // ---- Request full state ----
      case 'request-state': {
        const room = getRoom(ws);
        if (!room) break;

        sendTo(ws, {
          type: 'full-state',
          playback: room.playback,
          queue: room.queue,
          members: room.members.map(m => ({
            username: m.username, isHost: m.isHost,
          })),
        });
        break;
      }
    }
  });

  ws.on('close', () => { removeMember(ws); });
  ws.on('error', () => { removeMember(ws); });
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   [ sumit.sh ] sync & web server      ║
║   http://localhost:${PORT}               ║
║   ws://localhost:${PORT}                 ║
║   ready for connections               ║
╚═══════════════════════════════════════╝
  `);
});

