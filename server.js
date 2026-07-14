const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30000;
const ROOM_TTL = 10 * 60 * 1000;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server });

const rooms = new Map();
const clients = new Map();
const onlineHosts = new Set();

console.log(`Signaling server starting on port ${PORT}...`);

let heartbeatTimer = setInterval(() => {
  const now = Date.now();

  wss.clients.forEach((ws) => {
    try {
      if (ws.isAlive === false) {
        cleanupClient(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    } catch (_) {
      try { ws.terminate(); } catch (_) { /* ignore */ }
    }
  });

  for (const [roomId, room] of rooms) {
    try {
      if (now - room.lastActivity > ROOM_TTL) {
        console.log(`[${roomId}] Room expired (TTL)`);
        for (const [_role, peerWs] of room.peers) {
          if (peerWs && peerWs.readyState === 1) {
            sendTo(peerWs, { type: 'peer-left', room: roomId });
          }
        }
        rooms.delete(roomId);
      }
    } catch (_) { /* ignore */ }
  }
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws, req) => {
  const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  ws.isAlive = true;
  ws.clientRoom = null;
  ws.clientRole = null;
  clients.set(ws, clientId);

  console.log(`[+] Client connected: ${clientId} (total: ${wss.clients.size})`);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const { room, role, password } = msg;

        if (!room || typeof room !== 'string' || room.length > 20) {
          sendTo(ws, { type: 'error', message: 'Некорректный код комнаты' });
          return;
        }

        ws.clientRoom = room;
        ws.clientRole = role || 'client';

        if (!rooms.has(room)) {
          rooms.set(room, { peers: new Map(), lastActivity: Date.now(), created: Date.now(), hostPassword: null });
        }

        const roomData = rooms.get(room);
        roomData.peers.set(ws.clientRole, ws);
        roomData.lastActivity = Date.now();

        if (role === 'host') {
          roomData.hostPassword = password || null;
          onlineHosts.add(room);
          sendTo(ws, { type: 'joined', room, role: 'host' });
          console.log(`[${room}] host joined` + (password ? ' (password set)' : ''));
        } else {
          // Client trying to connect
          const host = roomData.peers.get('host');
          if (!host || host.readyState !== 1) {
            sendTo(ws, { type: 'error', message: 'Устройство не в сети' });
            return;
          }

          // Always forward to host, let host decide (password passed along)
          sendTo(host, { type: 'connect-request', room, fromRole: 'client', clientPassword: password, clientPlan: msg.plan || 'free' });
          console.log(`[${room}] connection request sent to host`);
        }
        break;
      }

      case 'connect-response': {
        if (!ws.clientRoom) return;
        const roomData = rooms.get(ws.clientRoom);
        if (!roomData) return;
        roomData.lastActivity = Date.now();

        const targetRole = ws.clientRole === 'host' ? 'client' : 'host';
        const target = roomData.peers.get(targetRole);

        if (target && target.readyState === 1) {
          sendTo(target, {
            type: 'connect-response',
            accept: msg.accept,
            access: msg.access || 'full',
            reason: msg.reason || '',
            hostPlan: msg.hostPlan || 'free',
          });
          console.log(`[${ws.clientRoom}] connect-response: ${msg.accept ? 'accepted (' + (msg.access || 'full') + ')' : 'rejected'}`);
        }
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!ws.clientRoom) {
          sendTo(ws, { type: 'error', message: 'Сначала присоединитесь к комнате' });
          return;
        }

        const roomData = rooms.get(ws.clientRoom);
        if (!roomData) {
          sendTo(ws, { type: 'error', message: 'Комната не найдена' });
          return;
        }

        roomData.lastActivity = Date.now();

        const targetRole = ws.clientRole === 'host' ? 'client' : 'host';
        const target = roomData.peers.get(targetRole);

        if (!target || target.readyState !== 1) {
          sendTo(ws, { type: 'error', message: 'Собеседник не в комнате' });
          return;
        }

        const payload = { type: msg.type };
        if (msg.type === 'ice-candidate') {
          payload.candidate = msg.candidate;
        } else {
          payload[msg.type] = msg[msg.type] || msg.offer || msg.answer;
        }
        sendTo(target, payload);
        break;
      }

      case 'leave':
        leaveRoom(ws);
        break;

      case 'invite': {
        const targetRoom = msg.targetRoom;
        if (!targetRoom) return;
        const targetHost = findHostByRoom(targetRoom);
        if (targetHost && targetHost.readyState === 1) {
          sendTo(targetHost, { type: 'invite', fromRoom: ws.clientRoom });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected: ${clientId}`);
    leaveRoom(ws);
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error(`[!] Client error (${clientId}):`, err.message);
    leaveRoom(ws);
  });

  function leaveRoom(clientWs) {
    if (!clientWs || !clientWs.clientRoom) return;

    const room = clientWs.clientRoom;
    const role = clientWs.clientRole;
    const roomData = rooms.get(room);

    if (roomData) {
      if (roomData.peers.get(role) === clientWs) {
        roomData.peers.delete(role);
      }
      if (role === 'host') onlineHosts.delete(room);

      const otherRole = role === 'host' ? 'client' : 'host';
      const other = roomData.peers.get(otherRole);
      if (other && other.readyState === 1) {
        sendTo(other, { type: 'peer-left', room });
      }

      if (roomData.peers.size === 0) {
        rooms.delete(room);
        console.log(`[${room}] Room deleted (empty)`);
      }
    }

    console.log(`[${room}] ${role} left`);
    clientWs.clientRoom = null;
    clientWs.clientRole = null;
  }
});

function findHostByRoom(room) {
  const roomData = rooms.get(room);
  if (roomData) return roomData.peers.get('host');
  return null;
}

function sendTo(ws, data) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error('Send error:', err.message);
    }
  }
}

function cleanupClient(ws) {
  if (ws.clientRoom) {
    const roomData = rooms.get(ws.clientRoom);
    if (roomData && ws.clientRole) {
      roomData.peers.delete(ws.clientRole);
      if (roomData.peers.size === 0) {
        rooms.delete(ws.clientRoom);
      }
    }
  }
  clients.delete(ws);
}

wss.on('close', () => {
  clearInterval(heartbeatTimer);
});

server.listen(PORT, () => {
  console.log(`Signaling server running on ws://0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  clearInterval(heartbeatTimer);

  wss.clients.forEach((ws) => {
    sendTo(ws, { type: 'peer-left', room: ws.clientRoom });
    ws.close(1001, 'Server shutting down');
  });

  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });

  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
