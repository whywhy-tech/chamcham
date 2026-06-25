const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 15;
const ROUND_SECONDS = 150;
const HIDING_SECONDS = 25;
const TAG_RANGE = 7.5;
const TAG_DOT_THRESHOLD = 0.76;
const TAG_COOLDOWN_MS = 650;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, game: 'Chameleon Hunt' });
});

const rooms = new Map();

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function createRoom(hostId) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();

  const room = {
    code,
    hostId,
    state: 'lobby',
    phaseEndsAt: 0,
    roundEndsAt: 0,
    players: new Map(),
    lastTagAt: new Map()
  };
  rooms.set(code, room);
  return room;
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    phaseEndsAt: room.phaseEndsAt,
    roundEndsAt: room.roundEndsAt,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      alive: p.alive,
      ready: p.ready,
      x: p.x,
      y: p.y,
      z: p.z,
      rotY: p.rotY,
      color: p.color,
      crouching: p.crouching,
      frozen: p.frozen,
      score: p.score
    }))
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomState', serializeRoom(room));
}

function getRoomOfSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function sanitizeName(name) {
  const clean = String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16);
  return clean || 'Player';
}

function makePlayer(socket, name) {
  return {
    id: socket.id,
    name: sanitizeName(name),
    role: 'hider',
    alive: true,
    ready: false,
    x: (Math.random() - 0.5) * 6,
    y: 0,
    z: (Math.random() - 0.5) * 6,
    rotY: 0,
    color: '#4ade80',
    crouching: false,
    frozen: false,
    score: 0
  };
}

function leaveCurrentRoom(socket) {
  const room = getRoomOfSocket(socket);
  if (!room) return;

  room.players.delete(socket.id);
  room.lastTagAt.delete(socket.id);
  socket.leave(room.code);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
  }

  if (![...room.players.values()].some((p) => p.role === 'hunter')) {
    room.state = 'lobby';
    room.phaseEndsAt = 0;
    room.roundEndsAt = 0;
    room.players.forEach((p) => {
      p.role = 'hider';
      p.alive = true;
      p.ready = false;
    });
  }

  broadcastRoom(room);
}

function startRound(room) {
  const players = [...room.players.values()];
  if (players.length < 2) return { ok: false, error: 'Need at least 2 players.' };

  const hunterIndex = Math.floor(Math.random() * players.length);
  room.state = 'hiding';
  room.phaseEndsAt = Date.now() + HIDING_SECONDS * 1000;
  room.roundEndsAt = Date.now() + (HIDING_SECONDS + ROUND_SECONDS) * 1000;
  room.lastTagAt.clear();

  players.forEach((p, index) => {
    p.role = index === hunterIndex ? 'hunter' : 'hider';
    p.alive = true;
    p.ready = false;
    p.score = 0;
    p.color = p.role === 'hunter' ? '#f97316' : '#4ade80';
    p.crouching = false;
    p.frozen = false;

    if (p.role === 'hunter') {
      p.x = 0;
      p.z = 12;
      p.rotY = Math.PI;
    } else {
      p.x = (Math.random() - 0.5) * 12;
      p.z = (Math.random() - 0.5) * 12;
      p.rotY = 0;
    }
  });

  broadcastRoom(room);
  io.to(room.code).emit('notice', 'Hiders: paint yourself and hide. Hunter releases soon!');
  return { ok: true };
}

function endRound(room, message) {
  room.state = 'ended';
  room.phaseEndsAt = 0;
  room.roundEndsAt = 0;
  io.to(room.code).emit('notice', message);
  broadcastRoom(room);
}

function resetLobby(room) {
  room.state = 'lobby';
  room.phaseEndsAt = 0;
  room.roundEndsAt = 0;
  room.players.forEach((p) => {
    p.role = 'hider';
    p.alive = true;
    p.ready = false;
    p.crouching = false;
    p.frozen = false;
    p.color = '#4ade80';
  });
  broadcastRoom(room);
}

function validateTag(room, hunter, payload) {
  if (room.state !== 'playing') return { ok: false, error: 'Round is not active yet.' };
  if (!hunter || hunter.role !== 'hunter') return { ok: false, error: 'Only the hunter can tag.' };

  const now = Date.now();
  const last = room.lastTagAt.get(hunter.id) || 0;
  if (now - last < TAG_COOLDOWN_MS) return { ok: false, error: 'Tag blaster cooling down.' };

  const target = room.players.get(payload.targetId);
  if (!target || target.role !== 'hider' || !target.alive) return { ok: false, error: 'Target unavailable.' };

  const dx = target.x - hunter.x;
  const dz = target.z - hunter.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > TAG_RANGE) return { ok: false, error: 'Too far away.' };

  const aimX = Number(payload.aimX || 0);
  const aimZ = Number(payload.aimZ || 0);
  const aimLen = Math.sqrt(aimX * aimX + aimZ * aimZ) || 1;
  const normAimX = aimX / aimLen;
  const normAimZ = aimZ / aimLen;
  const toTargetX = dx / (dist || 1);
  const toTargetZ = dz / (dist || 1);
  const dot = normAimX * toTargetX + normAimZ * toTargetZ;

  if (dot < TAG_DOT_THRESHOLD) return { ok: false, error: 'Aim closer to the hider.' };

  room.lastTagAt.set(hunter.id, now);
  return { ok: true, target };
}

io.on('connection', (socket) => {
  socket.emit('connected', { id: socket.id });

  socket.on('createRoom', ({ name } = {}, reply) => {
    leaveCurrentRoom(socket);
    const room = createRoom(socket.id);
    const player = makePlayer(socket, name);
    room.players.set(socket.id, player);
    socket.data.roomCode = room.code;
    socket.join(room.code);
    reply?.({ ok: true, code: room.code, id: socket.id });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name } = {}, reply) => {
    const roomCode = String(code || '').toUpperCase().trim();
    const room = rooms.get(roomCode);
    if (!room) {
      reply?.({ ok: false, error: 'Room not found.' });
      return;
    }
    if (room.state !== 'lobby' && room.state !== 'ended') {
      reply?.({ ok: false, error: 'Game already started.' });
      return;
    }
    if (room.players.size >= 8) {
      reply?.({ ok: false, error: 'Room is full.' });
      return;
    }

    leaveCurrentRoom(socket);
    const player = makePlayer(socket, name);
    room.players.set(socket.id, player);
    socket.data.roomCode = room.code;
    socket.join(room.code);
    reply?.({ ok: true, code: room.code, id: socket.id });
    broadcastRoom(room);
  });

  socket.on('startRound', (_payload, reply) => {
    const room = getRoomOfSocket(socket);
    if (!room) {
      reply?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    if (room.hostId !== socket.id) {
      reply?.({ ok: false, error: 'Only host can start.' });
      return;
    }
    const result = startRound(room);
    reply?.(result);
  });

  socket.on('resetLobby', () => {
    const room = getRoomOfSocket(socket);
    if (!room || room.hostId !== socket.id) return;
    resetLobby(room);
  });

  socket.on('playerUpdate', (data = {}) => {
    const room = getRoomOfSocket(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const maxCoord = 18;
    const x = Number(data.x);
    const z = Number(data.z);
    if (Number.isFinite(x)) player.x = Math.max(-maxCoord, Math.min(maxCoord, x));
    if (Number.isFinite(z)) player.z = Math.max(-maxCoord, Math.min(maxCoord, z));
    if (Number.isFinite(Number(data.rotY))) player.rotY = Number(data.rotY);

    if (typeof data.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.color) && player.role === 'hider') {
      player.color = data.color;
    }
    player.crouching = Boolean(data.crouching);
    player.frozen = Boolean(data.frozen) && player.role === 'hider';
  });

  socket.on('tagAttempt', (payload = {}, reply) => {
    const room = getRoomOfSocket(socket);
    if (!room) return;
    const hunter = room.players.get(socket.id);
    const result = validateTag(room, hunter, payload);
    if (!result.ok) {
      reply?.(result);
      return;
    }

    result.target.alive = false;
    hunter.score += 1;
    io.to(room.code).emit('notice', `${result.target.name} was tagged by ${hunter.name}!`);
    io.to(room.code).emit('tagEffect', { hunterId: hunter.id, targetId: result.target.id });

    const hidersAlive = [...room.players.values()].filter((p) => p.role === 'hider' && p.alive).length;
    if (hidersAlive === 0) {
      endRound(room, 'Hunter wins! All hiders were found.');
    } else {
      broadcastRoom(room);
    }
    reply?.({ ok: true });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.state === 'hiding' && now >= room.phaseEndsAt) {
      room.state = 'playing';
      room.phaseEndsAt = 0;
      io.to(room.code).emit('notice', 'Hunter released. Survive until the timer ends!');
      broadcastRoom(room);
    }

    if (room.state === 'playing' && now >= room.roundEndsAt) {
      const alive = [...room.players.values()].filter((p) => p.role === 'hider' && p.alive).length;
      endRound(room, alive > 0 ? 'Hiders win! Someone survived.' : 'Hunter wins!');
    }

    if (room.state === 'hiding' || room.state === 'playing') {
      io.to(room.code).emit('tick', {
        now,
        state: room.state,
        phaseEndsAt: room.phaseEndsAt,
        roundEndsAt: room.roundEndsAt
      });
      // Broadcast synced player positions/colors to everyone in this private room.
      broadcastRoom(room);
    }
  });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Chameleon Hunt running on http://localhost:${PORT}`);
});
