import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const socket = io();

const canvas = document.getElementById('gameCanvas');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const menuError = document.getElementById('menuError');
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const copyBtn = document.getElementById('copyBtn');
const roomCodeText = document.getElementById('roomCode');
const roleText = document.getElementById('roleText');
const timerText = document.getElementById('timerText');
const hiderTools = document.getElementById('hiderTools');
const hunterTools = document.getElementById('hunterTools');
const hostTools = document.getElementById('hostTools');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const paintPicker = document.getElementById('paintPicker');
const paintBtn = document.getElementById('paintBtn');
const sampleBtn = document.getElementById('sampleBtn');
const notice = document.getElementById('notice');
const playersList = document.getElementById('playersList');
const crosshair = document.getElementById('crosshair');

let myId = null;
let room = null;
let localPlayer = null;
let lastSentAt = 0;
let lastTagAt = 0;
let frozen = false;
let crouching = false;
let sampledColor = '#4ade80';

const keys = new Set();
const playerMeshes = new Map();
const nameSprites = new Map();
const paintableObjects = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color('#90a4b8');
scene.fog = new THREE.Fog('#90a4b8', 28, 72);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ambient = new THREE.HemisphereLight('#ffffff', '#2c3445', 1.35);
scene.add(ambient);

const sun = new THREE.DirectionalLight('#ffffff', 1.35);
sun.position.set(8, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const arena = new THREE.Group();
scene.add(arena);

const floorMaterial = new THREE.MeshStandardMaterial({ color: '#596f45', roughness: 0.92 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(42, 0.3, 42), floorMaterial);
floor.position.y = -0.16;
floor.receiveShadow = true;
floor.userData.paintColor = '#596f45';
arena.add(floor);
paintableObjects.push(floor);

function addWall(x, z, sx, sz, color) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(sx, 3.2, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  wall.position.set(x, 1.45, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.userData.paintColor = color;
  arena.add(wall);
  paintableObjects.push(wall);
  return wall;
}

addWall(0, -21, 42, 1, '#465b76');
addWall(0, 21, 42, 1, '#836247');
addWall(-21, 0, 1, 42, '#654a7c');
addWall(21, 0, 1, 42, '#3f7258');
addWall(-8, -7, 10, 1, '#465b76');
addWall(10, -4, 1, 11, '#836247');
addWall(-9, 7, 1, 10, '#3f7258');
addWall(6, 9, 11, 1, '#654a7c');
addWall(0, 0, 4, 1, '#596f45');
addWall(15, 12, 4, 4, '#465b76');
addWall(-15, -12, 4, 4, '#836247');

function addCrate(x, z, color) {
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.78 })
  );
  crate.position.set(x, 1, z);
  crate.castShadow = true;
  crate.receiveShadow = true;
  crate.userData.paintColor = color;
  arena.add(crate);
  paintableObjects.push(crate);
}

addCrate(-14, 12, '#3f7258');
addCrate(13, -12, '#654a7c');
addCrate(-4, 14, '#836247');
addCrate(14, 2, '#465b76');

function makePlayerMesh(player) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.48, 0.95, 8, 16),
    new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.7 })
  );
  body.position.y = 0.95;
  body.castShadow = true;
  body.userData.part = 'body';
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 18, 18),
    new THREE.MeshStandardMaterial({ color: player.role === 'hunter' ? '#fed7aa' : player.color, roughness: 0.72 })
  );
  head.position.y = 1.85;
  head.castShadow = true;
  head.userData.part = 'head';
  group.add(head);

  if (player.role === 'hunter') {
    const blaster = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.22, 0.9),
      new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.5 })
    );
    blaster.position.set(0.45, 1.35, -0.45);
    blaster.castShadow = true;
    group.add(blaster);
  } else {
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.72 })
    );
    tail.position.set(0, 0.6, 0.72);
    tail.rotation.x = Math.PI / 2;
    tail.castShadow = true;
    tail.userData.part = 'tail';
    group.add(tail);
  }

  group.traverse((obj) => {
    obj.userData.playerId = player.id;
  });

  scene.add(group);
  playerMeshes.set(player.id, group);
  return group;
}

function createNameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.roundRect(8, 8, 240, 48, 18);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = '700 24px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(c);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.7, 0.68, 1);
  scene.add(sprite);
  return sprite;
}

function updatePlayerMesh(player) {
  let mesh = playerMeshes.get(player.id);
  if (!mesh) mesh = makePlayerMesh(player);

  mesh.visible = player.alive || player.role === 'hunter';
  mesh.position.set(player.x, 0, player.z);
  mesh.rotation.y = player.rotY;
  mesh.scale.set(1, player.crouching ? 0.62 : 1, 1);

  mesh.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (obj.userData.part === 'body' || obj.userData.part === 'tail') {
      obj.material.color.set(player.color);
    }
    if (obj.userData.part === 'head' && player.role === 'hider') {
      obj.material.color.set(player.color);
    }
  });

  let sprite = nameSprites.get(player.id);
  if (!sprite) {
    sprite = createNameSprite(`${player.name} ${player.role === 'hunter' ? '🔎' : '🦎'}`);
    nameSprites.set(player.id, sprite);
  }
  sprite.visible = player.id === myId || player.role === 'hunter' || player.alive;
  sprite.position.set(player.x, player.crouching ? 1.75 : 2.7, player.z);
}

function removeMissingPlayers(players) {
  const ids = new Set(players.map((p) => p.id));
  for (const [id, mesh] of playerMeshes) {
    if (!ids.has(id)) {
      scene.remove(mesh);
      playerMeshes.delete(id);
    }
  }
  for (const [id, sprite] of nameSprites) {
    if (!ids.has(id)) {
      scene.remove(sprite);
      nameSprites.delete(id);
    }
  }
}

function updateUI() {
  if (!room) return;

  localPlayer = room.players.find((p) => p.id === myId) || null;
  roomCodeText.textContent = room.code || '----';
  roleText.textContent = localPlayer ? `${localPlayer.role}${localPlayer.alive ? '' : ' / tagged'}` : 'Lobby';

  const isHider = localPlayer?.role === 'hider';
  const isHunter = localPlayer?.role === 'hunter';
  const isHost = room.hostId === myId;

  hiderTools.classList.toggle('hidden', !isHider || room.state === 'lobby');
  hunterTools.classList.toggle('hidden', !isHunter || room.state !== 'playing');
  crosshair.classList.toggle('hidden', !isHunter || room.state !== 'playing');
  hostTools.classList.toggle('hidden', !isHost);
  startBtn.disabled = room.state !== 'lobby' && room.state !== 'ended';

  playersList.innerHTML = '';
  for (const p of room.players) {
    const pill = document.createElement('span');
    pill.className = 'player-pill';
    pill.textContent = `${p.name}: ${p.role}${p.alive ? '' : ' tagged'}`;
    playersList.appendChild(pill);
  }

  if (room.state === 'lobby') timerText.textContent = 'Lobby';
  if (room.state === 'ended') timerText.textContent = 'Ended';
}

function setNotice(text) {
  notice.textContent = text;
  if (!text) return;
  clearTimeout(setNotice.timer);
  setNotice.timer = setTimeout(() => {
    notice.textContent = '';
  }, 3500);
}

function timeLeft(msEnd) {
  const s = Math.max(0, Math.ceil((msEnd - Date.now()) / 1000));
  const min = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function getName() {
  return nameInput.value.trim() || `Player${Math.floor(Math.random() * 99)}`;
}

function createOrJoinError(result) {
  if (!result?.ok) {
    menuError.textContent = result?.error || 'Something went wrong.';
    return true;
  }
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  menuError.textContent = '';
  return false;
}

createBtn.addEventListener('click', () => {
  socket.emit('createRoom', { name: getName() }, (result) => createOrJoinError(result));
});

joinBtn.addEventListener('click', () => {
  socket.emit('joinRoom', { code: codeInput.value, name: getName() }, (result) => createOrJoinError(result));
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(room?.code || '');
    setNotice('Room code copied.');
  } catch {
    setNotice('Copy failed. Select the room code manually.');
  }
});

startBtn.addEventListener('click', () => {
  socket.emit('startRound', {}, (result) => {
    if (!result?.ok) setNotice(result?.error || 'Cannot start round.');
  });
});

resetBtn.addEventListener('click', () => socket.emit('resetLobby'));

function paintSelf(color) {
  if (!localPlayer || localPlayer.role !== 'hider') return;
  localPlayer.color = color;
  paintPicker.value = color;
  sendPlayerUpdate(true);
}

paintBtn.addEventListener('click', () => paintSelf(paintPicker.value));
sampleBtn.addEventListener('click', () => paintSelf(sampleNearestSurface()));

function sampleNearestSurface() {
  if (!localPlayer) return sampledColor;
  let best = null;
  let bestDist = Infinity;
  const p = new THREE.Vector3(localPlayer.x, 1, localPlayer.z);

  for (const obj of paintableObjects) {
    const box = new THREE.Box3().setFromObject(obj);
    const closest = box.clampPoint(p, new THREE.Vector3());
    const dist = closest.distanceTo(p);
    if (dist < bestDist) {
      bestDist = dist;
      best = obj;
    }
  }

  if (best && bestDist < 3.2) {
    sampledColor = best.userData.paintColor || '#4ade80';
    setNotice(`Sampled surface color ${sampledColor}.`);
  } else {
    setNotice('Move closer to a wall, crate, or floor patch to sample.');
  }
  return sampledColor;
}

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'e') paintSelf(sampleNearestSurface());
  if (e.key.toLowerCase() === 'f' && localPlayer?.role === 'hider') {
    frozen = !frozen;
    setNotice(frozen ? 'Frozen pose on.' : 'Frozen pose off.');
  }
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

window.addEventListener('mousedown', () => {
  if (!localPlayer || localPlayer.role !== 'hunter' || room?.state !== 'playing') return;
  tryTag();
});

function tryTag() {
  const now = Date.now();
  if (now - lastTagAt < 650) return;
  lastTagAt = now;

  const hunterMesh = playerMeshes.get(myId);
  if (!hunterMesh) return;

  const forward = new THREE.Vector3(Math.sin(localPlayer.rotY), 0, Math.cos(localPlayer.rotY));
  const raycaster = new THREE.Raycaster(new THREE.Vector3(localPlayer.x, 1.2, localPlayer.z), forward, 0, 8);
  const targets = [];
  for (const p of room.players) {
    if (p.role !== 'hider' || !p.alive) continue;
    const mesh = playerMeshes.get(p.id);
    if (mesh) {
      mesh.traverse((obj) => {
        if (obj.isMesh) targets.push(obj);
      });
    }
  }

  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit?.object?.userData.playerId) {
    setNotice('Tag missed. Aim closer.');
    return;
  }

  socket.emit('tagAttempt', {
    targetId: hit.object.userData.playerId,
    aimX: forward.x,
    aimZ: forward.z
  }, (result) => {
    if (!result?.ok) setNotice(result?.error || 'Tag failed.');
  });
}

function handleMovement(dt) {
  if (!localPlayer || !localPlayer.alive) return;
  if (room?.state === 'lobby' || room?.state === 'ended') return;
  if (localPlayer.role === 'hunter' && room.state !== 'playing') return;

  crouching = keys.has('shift');

  if (frozen && localPlayer.role === 'hider') {
    sendPlayerUpdate();
    return;
  }

  const speed = localPlayer.role === 'hunter' ? 6 : crouching ? 2.4 : 4.2;
  let dx = 0;
  let dz = 0;

  if (keys.has('w') || keys.has('arrowup')) dz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dz += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;

  const len = Math.hypot(dx, dz);
  if (len > 0) {
    dx /= len;
    dz /= len;
    localPlayer.x += dx * speed * dt;
    localPlayer.z += dz * speed * dt;
    localPlayer.rotY = Math.atan2(dx, dz);
  }

  localPlayer.x = Math.max(-19.4, Math.min(19.4, localPlayer.x));
  localPlayer.z = Math.max(-19.4, Math.min(19.4, localPlayer.z));
  sendPlayerUpdate();
}

function sendPlayerUpdate(force = false) {
  if (!localPlayer) return;
  const now = performance.now();
  if (!force && now - lastSentAt < 45) return;
  lastSentAt = now;
  socket.emit('playerUpdate', {
    x: localPlayer.x,
    z: localPlayer.z,
    rotY: localPlayer.rotY,
    color: localPlayer.color,
    crouching,
    frozen
  });
}

function updateCamera() {
  if (!localPlayer) {
    camera.position.set(0, 16, 21);
    camera.lookAt(0, 0, 0);
    return;
  }

  if (localPlayer.role === 'hunter') {
    const forward = new THREE.Vector3(Math.sin(localPlayer.rotY), 0, Math.cos(localPlayer.rotY));
    const behind = forward.clone().multiplyScalar(-5);
    camera.position.set(localPlayer.x + behind.x, 4.2, localPlayer.z + behind.z);
    camera.lookAt(localPlayer.x + forward.x * 4, 1.1, localPlayer.z + forward.z * 4);
  } else {
    camera.position.set(localPlayer.x, 11, localPlayer.z + 10);
    camera.lookAt(localPlayer.x, 0.8, localPlayer.z);
  }
}

socket.on('connected', ({ id }) => {
  myId = id;
});

socket.on('roomState', (newRoom) => {
  room = newRoom;
  localPlayer = room.players.find((p) => p.id === myId) || null;
  removeMissingPlayers(room.players);
  for (const p of room.players) updatePlayerMesh(p);
  updateUI();
});

socket.on('notice', setNotice);

socket.on('tick', (tick) => {
  if (tick.state === 'hiding') timerText.textContent = `Hide: ${timeLeft(tick.phaseEndsAt)}`;
  if (tick.state === 'playing') timerText.textContent = `Round: ${timeLeft(tick.roundEndsAt)}`;
});

socket.on('tagEffect', ({ hunterId, targetId }) => {
  const hunter = playerMeshes.get(hunterId);
  const target = playerMeshes.get(targetId);
  if (!hunter || !target) return;
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  hunter.getWorldPosition(start);
  target.getWorldPosition(end);
  start.y += 1.3;
  end.y += 1.2;

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({ color: '#facc15' })
  );
  scene.add(line);
  setTimeout(() => scene.remove(line), 220);
});

let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  handleMovement(dt);
  if (room?.players) {
    for (const p of room.players) updatePlayerMesh(p);
  }
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
