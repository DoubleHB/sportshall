// Sports Hall: table tennis for Meta Quest (WebXR), with a desktop preview.
// The scene is laid out in table space (see physics.js); in VR an offset
// reference space puts the table in front of you, so world = table space.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import * as PH from './physics.js';
import { Referee, Match, P, O } from './rules.js';
import { Bot, Machine, LEVELS } from './ai.js';
import { assistShot } from './assist.js';
import { buildWorld, makePaddle } from './world.js';
import { CanvasBoard, Menu, C, FONT, roundRect } from './panel.js';
import { Sfx } from './audio.js';

export const VERSION = '0.1.0';
const TB = PH.TABLE;
const V3 = THREE.Vector3;

// ------------------------------------------------------------- settings --
const DEFAULTS = { hand: 'right', assist: 'light', serve: 'casual', angle: 0, sound: true, level: 'medium', games: 1, pace: 'medium', spin: 'none', place: 'mix' };
const settings = load('sh_settings', DEFAULTS);
const stats = load('sh_stats', { wins: {}, losses: {}, bestStreak: 0 });
function load(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }
const ASSIST = { off: 0, light: 0.55, full: 1 };

// ------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x0e1320);
scene.background = BG;
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.02, 80);
const DESK_CAM = { p: new V3(0, 1.58, 2.55), look: new V3(0, 0.82, -0.7) };
function resetDeskCamera() { camera.position.copy(DESK_CAM.p); camera.lookAt(DESK_CAM.look); }
resetDeskCamera();
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const W = await buildWorld(scene, renderer);
const sfx = new Sfx();
sfx.enabled = settings.sound;

// ----------------------------------------------------------------- state --
const G = {
  mode: 'menu',          // menu | match | practice
  paused: true,          // menu open
  tab: 'match',
  now: 0,
  ball: null,
  ballState: 'none',     // none | held | toss | live | dead
  ref: null,
  match: null,
  bot: new Bot(settings.level),
  machine: null,
  timers: [],
  lastPlayerHit: -9,
  lastEventT: 0,
  practice: null,
  lastResult: null,
  autoplay: false,
  log: [],               // recent point results, for testing
  inXR: false,
  mr: false,
  desk: false,
};

function later(sec, fn) { G.timers.push({ t: G.now + sec, fn }); }
function runTimers() {
  if (!G.timers.length) return;
  const due = G.timers.filter(t => t.t <= G.now);
  if (!due.length) return;
  G.timers = G.timers.filter(t => t.t > G.now);
  due.forEach(t => t.fn());
}

// ------------------------------------------------------- paddle and hands --
const paddle = makePaddle();
const paddleRig = new THREE.Group();     // carries the angle setting
paddleRig.add(paddle.group);
function applyAngle() { paddleRig.rotation.x = G.inXR ? THREE.MathUtils.degToRad(settings.angle) : 0; }

const modelFactory = new XRControllerModelFactory();
const raycaster = new THREE.Raycaster();
const ctrls = [0, 1].map(i => {
  const ray = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  scene.add(ray, grip);
  const model = modelFactory.createControllerModel(grip);
  grip.add(model);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8 }));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ray.add(line); scene.add(dot);
  const c = { i, ray, grip, model, line, dot, source: null, hand: null, pressed: [], prevPos: new V3(), vel: new V3() };
  ray.addEventListener('connected', e => { c.source = e.data; c.hand = e.data.handedness; attachHands(); });
  ray.addEventListener('disconnected', () => { c.source = null; c.hand = null; attachHands(); });
  ray.addEventListener('selectstart', () => onSelect(c));
  return c;
});
const paddleCtrl = () => ctrls.find(c => c.hand === settings.hand) || null;
const offCtrl = () => ctrls.find(c => c.hand && c.hand !== settings.hand) || null;

// Desktop paddle: follows the mouse on a plane just behind your end of the table.
const desk = { outer: new THREE.Group(), inner: new THREE.Group(), target: new V3(0.25, 1.0, 1.62), swing: -1, mouse: new THREE.Vector2() };
desk.outer.add(desk.inner);
desk.inner.rotation.x = Math.PI / 2;
scene.add(desk.outer);

function attachHands() {
  const pc = paddleCtrl();
  if (G.inXR && pc) pc.grip.add(paddleRig);
  else if (!G.inXR) desk.inner.add(paddleRig);
  else scene.remove(paddleRig);
  for (const c of ctrls) c.model.visible = c !== pc;
  applyAngle();
}
attachHands();

function haptic(c, intensity, ms) {
  try { c?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(Math.min(1, intensity), ms); } catch { /* not supported */ }
}

// The paddle's blade pose this frame and last frame, for swept collisions.
const pose = { valid: false, c: new V3(), n: new V3(), q: new THREE.Quaternion(), pc: new V3(), pn: new V3(), pq: new THREE.Quaternion(), vel: PH.vec(), ang: PH.vec() };
const dq = new THREE.Quaternion();
function samplePaddle(dt) {
  const holder = paddleRig.parent;
  const ok = !!holder && (G.inXR ? holder.visible : G.desk);
  if (!ok) { pose.valid = false; return; }
  pose.pc.copy(pose.c); pose.pn.copy(pose.n); pose.pq.copy(pose.q);
  paddle.centre.updateWorldMatrix(true, false);
  paddle.centre.getWorldPosition(pose.c);
  paddle.centre.getWorldQuaternion(pose.q);
  pose.n.set(1, 0, 0).applyQuaternion(pose.q);
  if (!pose.valid || dt <= 0) { pose.pc.copy(pose.c); pose.pn.copy(pose.n); pose.pq.copy(pose.q); }
  pose.valid = true;
  const k = 1 / Math.max(dt, 1e-3);
  pose.vel = { x: (pose.c.x - pose.pc.x) * k, y: (pose.c.y - pose.pc.y) * k, z: (pose.c.z - pose.pc.z) * k };
  dq.copy(pose.q).multiply(pose.pq.clone().invert());
  if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
  const angle = 2 * Math.acos(Math.min(1, dq.w));
  const s = Math.sqrt(Math.max(1 - dq.w * dq.w, 1e-9));
  pose.ang = angle < 1e-5 ? PH.vec() : { x: dq.x / s * angle * k, y: dq.y / s * angle * k, z: dq.z / s * angle * k };
}
const toP = v => ({ x: v.x, y: v.y, z: v.z });

// --------------------------------------------------------- boards and menu --
const scoreboard = new CanvasBoard(1.25, 0.62, 1000, 496, { transparent: true });
scoreboard.mesh.position.set(-1.75, 1.55, -0.9);
scoreboard.mesh.rotation.y = 0.56;
scene.add(scoreboard.mesh);

const banner = new CanvasBoard(1.5, 0.375, 1200, 300, { transparent: true });
banner.mesh.position.set(0, 1.62, -1.6);
banner.mesh.material.opacity = 0;
scene.add(banner.mesh);
let bannerLeft = 0;
function showBanner(title, sub = '', color = C.accent2, secs = 2.6) {
  const g = banner.g, w = banner.w, h = banner.h;
  g.clearRect(0, 0, w, h);
  roundRect(g, 10, 10, w - 20, h - 20, 50);
  g.fillStyle = 'rgba(10,14,26,0.86)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = color; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.font = `800 ${sub ? 92 : 110}px ${FONT}`;
  g.fillText(title, w / 2, sub ? h / 2 - 40 : h / 2);
  if (sub) { g.fillStyle = '#c9d6f2'; g.font = `500 56px ${FONT}`; g.fillText(sub, w / 2, h / 2 + 62); }
  banner.flush();
  bannerLeft = secs;
}

function drawScoreboard() {
  const g = scoreboard.g, w = scoreboard.w, h = scoreboard.h;
  g.clearRect(0, 0, w, h);
  roundRect(g, 6, 6, w - 12, h - 12, 40);
  g.fillStyle = 'rgba(8,12,22,0.92)'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2c3954'; g.stroke();
  g.textBaseline = 'middle';
  if (G.mode === 'practice' && G.practice) {
    const p = G.practice;
    g.fillStyle = C.accent; g.font = `800 50px ${FONT}`; g.textAlign = 'left';
    g.fillText('PRACTICE', 50, 70);
    g.fillStyle = C.dim; g.font = `500 36px ${FONT}`; g.textAlign = 'right';
    g.fillText(`${cap(settings.pace)} · ${spinName(settings.spin)}`, w - 50, 70);
    const cells = [['Returns', `${p.returns}/${p.balls}`], ['Streak', p.streak], ['Best', p.best], ['Targets', p.targets]];
    cells.forEach(([k, v], i) => {
      const x = 50 + (i % 2) * 460, y = 170 + Math.floor(i / 2) * 150;
      g.textAlign = 'left'; g.fillStyle = C.dim; g.font = `600 36px ${FONT}`; g.fillText(k, x, y);
      g.fillStyle = '#fff'; g.font = `800 84px ${FONT}`; g.fillText(String(v), x, y + 70);
    });
  } else {
    const m = G.match;
    const lvl = LEVELS[settings.level].name;
    g.textAlign = 'left'; g.fillStyle = C.accent; g.font = `800 46px ${FONT}`;
    g.fillText('TABLE TENNIS', 50, 66);
    g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `500 34px ${FONT}`;
    g.fillText(m ? (m.games > 1 ? `Best of ${m.games} · game ${m.gameNo + 1}` : '1 game to 11') : 'Ready', w - 50, 66);
    const rows = [[P, 'YOU'], [O, `ROBOT · ${lvl}`]];
    rows.forEach(([who, name], i) => {
      const y = 190 + i * 150;
      roundRect(g, 40, y - 62, w - 80, 124, 24);
      g.fillStyle = who === P ? '#16233f' : '#22192b'; g.fill();
      const serving = m && !m.over && m.server === who && G.mode === 'match';
      if (serving) { g.beginPath(); g.arc(80, y, 14, 0, Math.PI * 2); g.fillStyle = '#ffd23f'; g.fill(); }
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 ${who === P ? 52 : 44}px ${FONT}`;
      g.fillText(name, 110, y);
      if (m && m.games > 1) {
        g.textAlign = 'center'; g.fillStyle = C.dim; g.font = `700 44px ${FONT}`;
        g.fillText(String(m.gamesWon[who]), w - 250, y);
      }
      g.textAlign = 'right'; g.fillStyle = who === P ? '#7fd1ff' : '#ffae6b'; g.font = `800 96px ${FONT}`;
      g.fillText(String(m ? m.score[who] : 0), w - 70, y + 4);
    });
  }
  scoreboard.flush();
}
const cap = s => s[0].toUpperCase() + s.slice(1);
const spinName = s => ({ none: 'No spin', top: 'Topspin', back: 'Backspin', mix: 'Mixed spin' })[s] || s;

const menu = new Menu(1.3, 0.82, 1560, 984, renderMenu, onMenuClick);
menu.mesh.position.set(0, 1.32, 0.85);
menu.mesh.rotation.x = -0.12;
menu.mesh.renderOrder = 10;               // always on top of the paddle and table
menu.mesh.material.depthTest = false;
scene.add(menu.mesh);

function renderMenu(ui) {
  const { w } = ui;
  ui.text('SPORTS HALL', 60, 92, { size: 34, weight: 800, color: C.accent });
  ui.text('Table Tennis', 60, 150, { size: 60, weight: 800 });
  const tabs = [['match', 'Match'], ['practice', 'Practice'], ['settings', 'Settings']];
  tabs.forEach(([id, label], i) => ui.button(`tab:${id}`, 760 + i * 255, 60, 235, 84, label, { selected: G.tab === id, size: 36 }));
  const L = 60, R = w - 60, width = R - L;
  const label = (s, y) => ui.text(s, L, y, { size: 32, weight: 650, color: C.dim });

  if (G.tab === 'match') {
    label('Opponent', 232);
    ui.options('level', L, 252, width, 112, [['easy', 'Easy', 'gentle rallies'], ['medium', 'Medium', 'steady'], ['hard', 'Hard', 'quick and tricky'], ['pro', 'Pro', 'ruthless']], settings.level);
    label('Match length', 430);
    ui.options('games', L, 450, width, 92, [[1, '1 game'], [3, 'Best of 3'], [5, 'Best of 5']], settings.games);
    const rec = Object.keys(LEVELS).map(k => `${LEVELS[k].name} ${stats.wins[k] || 0}–${stats.losses[k] || 0}`).join('   ·   ');
    ui.text(`Your record (won–lost):  ${rec}`, L, 610, { size: 30, weight: 500, color: C.dim });
    if (G.lastResult) ui.text(G.lastResult, L, 660, { size: 34, weight: 700, color: G.lastResult.startsWith('You won') ? C.good : C.text });
    const inMatch = G.mode === 'match' && G.match && !G.match.over;
    if (inMatch) {
      ui.button('resume', L, 700, width / 2 - 10, 120, 'Resume', { primary: true, size: 48 });
      ui.button('play', L + width / 2 + 10, 700, width / 2 - 10, 120, 'New match', { size: 42 });
    } else ui.button('play', L, 700, width, 120, 'Play', { primary: true, size: 52 });
  } else if (G.tab === 'practice') {
    ui.text('The ball machine feeds you balls. Hit them back onto the table, and aim for the glowing targets.', L, 222, { size: 30, weight: 500, color: C.dim });
    label('Pace', 290);
    ui.options('pace', L, 306, width, 84, [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']], settings.pace);
    label('Spin', 444);
    ui.options('spin', L, 460, width, 84, [['none', 'None'], ['top', 'Topspin'], ['back', 'Backspin'], ['mix', 'Mix']], settings.spin);
    label('Where', 598);
    ui.options('place', L, 614, width, 84, [['forehand', 'Forehand'], ['backhand', 'Backhand'], ['middle', 'Middle'], ['mix', 'Anywhere']], settings.place);
    if (G.mode === 'practice') {
      ui.button('resume', L, 740, width / 2 - 10, 110, 'Resume', { primary: true, size: 46 });
      ui.button('practice', L + width / 2 + 10, 740, width / 2 - 10, 110, 'Restart', { size: 40 });
    } else ui.button('practice', L, 740, width, 110, 'Start practice', { primary: true, size: 48 });
  } else {
    label('Paddle hand', 232);
    ui.options('hand', L, 248, width / 2 - 20, 84, [['right', 'Right'], ['left', 'Left']], settings.hand);
    ui.text('Sound', L + width / 2 + 20, 232, { size: 32, weight: 650, color: C.dim });
    ui.options('sound', L + width / 2 + 20, 248, width / 2 - 20, 84, [[true, 'On'], [false, 'Off']], settings.sound);
    label('Aim assist', 384);
    ui.options('assist', L, 400, width, 100, [['off', 'Off', 'real physics'], ['light', 'Light', 'a little help'], ['full', 'Full', 'always lands']], settings.assist);
    label('Serve rules', 552);
    ui.options('serve', L, 568, width / 2 - 20, 100, [['casual', 'Casual', 'straight over'], ['proper', 'Proper', 'bounce your side first']], settings.serve);
    ui.text('Paddle angle', L + width / 2 + 20, 552, { size: 32, weight: 650, color: C.dim });
    const ax = L + width / 2 + 20;
    ui.button('angle:-', ax, 568, 120, 100, '–', { size: 56 });
    ui.text(`${settings.angle > 0 ? '+' : ''}${settings.angle}°`, ax + (width / 2 - 20) / 2, 620, { size: 52, weight: 800, align: 'center', base: 'middle' });
    ui.button('angle:+', ax + width / 2 - 140, 568, 120, 100, '+', { size: 56 });
    if (G.inXR) {
      ui.button('recentre', L, 720, width / 2 - 10, 100, 'Recentre table', { size: 38 });
      ui.button('exit', L + width / 2 + 10, 720, width / 2 - 10, 100, G.mr ? 'Exit mixed reality' : 'Exit VR', { size: 38 });
    } else ui.text('Paddle angle and recentring matter in the headset. The screen version is a preview.', L, 760, { size: 30, weight: 500, color: C.dim });
  }
  const help = G.inXR
    ? 'Free hand: trigger = toss the ball · X/Y = menu · stick = move · click stick = recentre   |   point + trigger = click'
    : 'Mouse = move the paddle (it swings by itself) · Space = toss · Esc = menu';
  ui.text(help, w / 2, 930, { size: 27, weight: 500, color: C.dim, align: 'center' });
  ui.text(`v${VERSION}`, w - 40, 960, { size: 22, weight: 500, color: '#55627e', align: 'right' });
}

function onMenuClick(id) {
  sfx.play('click');
  const [k, v] = id.split(':');
  if (k === 'tab') G.tab = v;
  else if (k === 'level') { settings.level = v; G.bot.setLevel(v); }
  else if (k === 'games') settings.games = +v;
  else if (k === 'pace' || k === 'spin' || k === 'place' || k === 'assist' || k === 'serve') settings[k] = v;
  else if (k === 'hand') { settings.hand = v; attachHands(); }
  else if (k === 'sound') { settings.sound = v === 'true'; sfx.enabled = settings.sound; }
  else if (k === 'angle') { settings.angle = Math.max(-60, Math.min(60, settings.angle + (v === '+' ? 5 : -5))); applyAngle(); }
  else if (id === 'play') startMatch();
  else if (id === 'practice') startPractice();
  else if (id === 'resume') closeMenu();
  else if (id === 'recentre') { needRecentre = true; }
  else if (id === 'exit') renderer.xr.getSession()?.end();
  save('sh_settings', settings);
  menu.redraw();
  drawScoreboard();
}

function openMenu(tab) {
  if (tab) G.tab = tab;
  G.paused = true;
  menu.mesh.visible = true;
  menu.redraw();
}
function closeMenu() {
  if (G.mode === 'menu') return;
  G.paused = false;
  menu.mesh.visible = false;
  pose.valid = false;    // no velocity spike from where the paddle was when we paused
}
function toggleMenu() { if (G.paused) closeMenu(); else openMenu(); }

// ------------------------------------------------------------ game flow --
function clearPlay() {
  G.timers = []; G.ball = null; G.ballState = 'none'; G.ref = null;
  W.setBall(null);
  targets.root.visible = false;
}

function startMatch() {
  clearPlay();
  G.mode = 'match';
  G.bot.setLevel(settings.level);
  G.match = new Match({ games: settings.games, firstServer: Math.random() < 0.5 ? P : O });
  W.robot.root.visible = true; W.machine.root.visible = false;
  closeMenu();
  drawScoreboard();
  showBanner('Game on!', `${LEVELS[settings.level].name} robot · ${G.match.server === P ? 'you serve first' : 'robot serves first'}`, C.accent, 2.4);
  later(2.0, newPoint);
}

function newPoint() {
  if (G.mode !== 'match' || !G.match || G.match.over) return;
  const server = G.match.server;
  G.ref = new Referee(server, { casualServe: settings.serve === 'casual' });
  G.bot.reset();
  G.lastEventT = G.now;
  drawScoreboard();
  if (server === P) {
    holdBall();
    const gp = G.match.gamePoint;
    showBanner(gp === P ? 'Game point' : 'Your serve', G.inXR ? 'Pull the trigger on your free hand to toss' : 'Press Space to toss', C.accent2, 3);
  } else {
    G.ball = null; G.ballState = 'none'; W.setBall(null);
    later(1.0, () => {
      if (G.mode !== 'match' || !G.ref || G.ref.stage !== 'toss') return;
      G.ball = G.bot.startServe(G.now);
      G.ballState = 'toss';
      G.lastEventT = G.now;
      sfx.play('toss', G.ball.p);
    });
  }
}

function holdBall() {
  G.ball = PH.makeBall(heldBallPos());
  G.ballState = 'held';
}

function heldBallPos() {
  if (G.inXR) {
    const oc = offCtrl();
    if (oc && oc.grip.visible) {
      const p = oc.grip.getWorldPosition(new V3());
      return { x: p.x, y: p.y + 0.07, z: p.z };
    }
    return { x: -0.3, y: 1.1, z: TB.halfL + 0.3 };
  }
  return { x: desk.target.x - 0.03, y: TB.top + 0.1, z: desk.target.z };
}

function toss() {
  if (G.ballState !== 'held' || G.paused) return;
  let v = { x: 0, y: 2.3, z: 0 };
  const oc = offCtrl();
  if (G.inXR && oc) v = { x: oc.vel.x * 0.3, y: 2.2 + Math.max(0, oc.vel.y) * 0.3, z: oc.vel.z * 0.3 };
  G.ball.v = v;
  G.ball.w = PH.vec();
  G.ballState = 'toss';
  G.lastEventT = G.now;
  sfx.play('toss', G.ball.p);
  haptic(oc, 0.2, 15);
}

// Practice: the ball machine, scoring returns, streaks and targets.
const targets = buildTargets();
function buildTargets() {
  const root = new THREE.Group();
  root.visible = false;
  const list = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 40), new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(ring, disc);
    g.position.y = TB.top + 0.003;
    root.add(g);
    list.push({ g, ring, flash: 0 });
  }
  scene.add(root);
  return { root, list };
}
function placeTarget(t) {
  for (let tries = 0; tries < 20; tries++) {
    const x = (Math.random() * 2 - 1) * 0.55, z = -(0.35 + Math.random() * 0.9);
    if (targets.list.every(o => o === t || Math.hypot(o.g.position.x - x, o.g.position.z - z) > 0.4)) { t.g.position.x = x; t.g.position.z = z; return; }
  }
}

function startPractice() {
  clearPlay();
  G.mode = 'practice';
  G.machine = new Machine({ pace: settings.pace, spin: settings.spin, place: settings.place, hand: settings.hand });
  G.practice = { balls: 0, returns: 0, streak: 0, best: stats.bestStreak || 0, targets: 0 };
  W.robot.root.visible = false; W.machine.root.visible = true;
  targets.root.visible = true;
  targets.list.forEach(placeTarget);
  closeMenu();
  drawScoreboard();
  showBanner('Practice', 'Return the balls onto the table', C.accent, 2);
  later(1.8, feed);
}

function feed() {
  if (G.mode !== 'practice') return;
  Object.assign(G.machine, { pace: settings.pace, spin: settings.spin, place: settings.place, hand: settings.hand });
  const f = G.machine.feed();
  G.ball = f.ball;
  G.ballState = 'live';
  G.ref = new Referee(O, { casualServe: true });
  G.ref.event({ type: 'hit', who: O, t: G.now });
  G.lastEventT = G.now;
  G.practice.balls++;
  W.machine.kick = 1;
  sfx.play('machine', G.ball.p);
  drawScoreboard();
}

function practiceResult(success, landing) {
  const p = G.practice;
  G.ballState = 'dead';
  if (success) {
    p.returns++; p.streak++;
    if (p.streak > p.best) { p.best = p.streak; stats.bestStreak = p.best; save('sh_stats', stats); }
    const hitT = landing && targets.list.find(t => Math.hypot(t.g.position.x - landing.x, t.g.position.z - landing.z) < 0.17);
    if (hitT) {
      p.targets++; hitT.flash = 1;
      sfx.play('target', landing);
      W.crowd.cheer(0.5);
      later(0.5, () => placeTarget(hitT));
    }
    if (p.streak > 0 && p.streak % 10 === 0) { showBanner(`${p.streak} in a row!`, 'Keep it going', C.good, 1.6); W.crowd.cheer(1); sfx.play('cheer', null, 0.6); }
  } else {
    if (p.streak >= 5) showBanner('Streak over', `${p.streak} in a row`, C.bad, 1.4);
    p.streak = 0;
  }
  drawScoreboard();
  later(success ? 1.0 : 1.2, feed);
}

// --------------------------------------------------------------- rally --
function onPlayerHit(hit) {
  G.lastPlayerHit = G.now;
  const strength = hit.speed / 12;
  sfx.play('paddle', G.ball.p, strength);
  haptic(paddleCtrl(), 0.25 + strength * 0.6, 22);
  if (!G.ref || G.ballState === 'dead') return;
  const serving = G.ref.stage === 'toss';
  // Casual serves get full help whenever assist is on: serving is the fiddly bit.
  const a = serving && settings.assist !== 'off' ? 1 : ASSIST[settings.assist];
  G.lastHit = { p: { ...G.ball.p }, v: { ...G.ball.v }, w: { ...G.ball.w }, padVel: pose.vel, n: toP(pose.n) };
  if (a && !(serving && settings.serve === 'proper')) {
    const v = assistShot(G.ball, a);
    if (v) G.ball.v = v;
  }
  G.lastHit.assisted = { ...G.ball.v };
  G.ballState = 'live';
  const res = G.ref.event({ type: 'hit', who: P, t: G.now, p: { ...G.ball.p } });
  if (G.mode === 'match') G.bot.planReturn(G.ball, G.now);
  afterRef(res);
}

function onRobotHit(shot) {
  G.ball.v = shot.v; G.ball.w = shot.w;
  G.ballState = 'live';
  sfx.play('paddle', G.ball.p, PH.len(shot.v) / 12);
  const res = G.ref.event({ type: 'hit', who: O, t: G.now, p: { ...G.ball.p } });
  afterRef(res);
}

function handleEvent(e) {
  const speed = PH.len(G.ball.v);
  if (e.type === 'table' || e.type === 'edge') sfx.play('table', e.p, speed / 7);
  else if (e.type === 'net') sfx.play('net', e.p, speed / 6);
  else if (e.type === 'floor' && speed > 0.4) sfx.play('floor', e.p, speed / 6);
  G.lastEventT = G.now;
  if (!G.ref || G.ballState === 'dead' || G.ballState === 'held') return;
  afterRef(G.ref.event(e));
}

function afterRef(res) {
  const info = G.ref?.info;
  if (G.mode === 'practice') {
    if (info?.type === 'landed' && info.hitter === P) return practiceResult(true, info.p);
    if (res && !res.retoss) return practiceResult(res.winner === P, null);
    return;
  }
  if (!res) return;
  if (res.retoss) {
    if (G.ref.server === P) { later(0.5, () => { if (G.ref?.stage === 'toss') holdBall(); }); G.ballState = 'dead'; }
    else { G.ballState = 'dead'; later(0.8, () => { if (G.ref?.stage === 'toss') { G.ball = G.bot.startServe(G.now); G.ballState = 'toss'; } }); }
    return;
  }
  G.ballState = 'dead';
  if (res.let) { showBanner('Let', 'It touched the net, serve again', C.accent2, 1.6); later(1.6, newPoint); return; }
  pointOver(res);
}

function pointOver(res) {
  G.log.push({ t: +G.now.toFixed(2), winner: res.winner, reason: res.reason });
  const r = G.match.point(res.winner);
  const you = res.winner === P;
  const reason = res.loser === P ? res.reason : `Robot: ${res.reason.charAt(0).toLowerCase()}${res.reason.slice(1)}`;
  G.bot.mood = you ? -1 : 1;
  drawScoreboard();
  if (r.match) {
    const m = G.match, lvl = settings.level;
    const games = m.history.map(s => `${s.P}–${s.O}`).join(', ');
    if (you) { stats.wins[lvl] = (stats.wins[lvl] || 0) + 1; sfx.play('cheer', null, 1); W.crowd.cheer(2); }
    else { stats.losses[lvl] = (stats.losses[lvl] || 0) + 1; sfx.play('groan'); }
    save('sh_stats', stats);
    G.lastResult = `${you ? 'You won' : 'Robot won'} against ${LEVELS[lvl].name}: ${games}`;
    showBanner(you ? 'You win!' : 'Robot wins', games, you ? C.good : C.bad, 4);
    later(4, () => { G.mode = 'menu'; openMenu('match'); });
    return;
  }
  if (r.game) {
    const g = G.match.history[G.match.history.length - 1];
    showBanner(you ? 'Game to you!' : 'Game to robot', `${g.P}–${g.O}`, you ? C.good : C.bad, 3);
    if (you) { sfx.play('cheer', null, 0.8); W.crowd.cheer(1.2); } else sfx.play('lose');
    later(3.2, newPoint);
    return;
  }
  if (you) { sfx.play('win'); W.crowd.cheer(0.5); sfx.play('cheer', null, 0.3); } else sfx.play('lose');
  showBanner(you ? 'Your point' : 'Robot\'s point', reason, you ? C.good : C.bad, 1.9);
  later(1.9, newPoint);
}

// --------------------------------------------------------------- physics --
const evs = [];
function lerpP(a, b, f) { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }; }
function nlerpP(a, b, f) { return PH.norm(lerpP(a, b, f)); }

function simulate(dt) {
  const n = Math.max(1, Math.ceil(dt / PH.STEP)), h = dt / n;
  for (let i = 1; i <= n; i++) {
    G.now += h;
    runTimers();
    const b = G.ball;
    if (!b || G.ballState === 'held' || G.ballState === 'none') continue;
    const prevP = { ...b.p };
    PH.step(b, h, evs);
    if (b.p.y <= PH.BALL_R + 1e-4) { b.v.x *= 1 - 1.5 * h; b.v.z *= 1 - 1.5 * h; }   // rolling on the floor

    if (pose.valid && G.now - G.lastPlayerHit > 0.08) {
      const f0 = (i - 1) / n, f1 = i / n;
      const pad = {
        prevC: lerpP(pose.pc, pose.c, f0), c: lerpP(pose.pc, pose.c, f1),
        prevN: nlerpP(pose.pn, pose.n, f0), n: nlerpP(pose.pn, pose.n, f1),
        vel: pose.vel, ang: pose.ang,
      };
      const hit = PH.collidePaddle(b, prevP, pad);
      if (hit) onPlayerHit(hit);
    }
    if (G.mode === 'match' && G.ref && G.ref.due === O && G.ballState !== 'dead') {
      const shot = G.bot.tryHit(b, G.now, { playerX: pose.c.x, incomingSpeed: PH.len(b.v) });
      if (shot) onRobotHit(shot);
    }
    if (G.ballState !== 'dead') {
      if (Math.abs(b.p.z) > 7 || Math.abs(b.p.x) > 6 || b.p.y < -1) evs.push({ type: 'out' });
      else if (G.now - G.lastEventT > 4) evs.push({ type: 'stall' });
    }
    for (const e of evs) handleEvent(e);
    evs.length = 0;
  }
}

// --------------------------------------------------------------- XR glue --
let baseSpace = null, needRecentre = false;
const tablePose = { x: 0, z: 0, th: 0 };
const RECENTRE_DIST = TB.halfL + 0.6;     // you stand this far from the net

function applyTablePose() {
  const { x, z, th } = tablePose;
  const off = new XRRigidTransform({ x, y: 0, z }, { x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) });
  renderer.xr.setReferenceSpace(baseSpace.getOffsetReferenceSpace(off));
}

function recentre(frame) {
  const vp = frame.getViewerPose(baseSpace);
  if (!vp) return false;
  const p = vp.transform.position, o = vp.transform.orientation;
  const f = new V3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
  f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
  f.normalize();
  tablePose.th = Math.atan2(-f.x, -f.z);
  tablePose.x = p.x + f.x * RECENTRE_DIST;
  tablePose.z = p.z + f.z * RECENTRE_DIST;
  applyTablePose();
  return true;
}

// Move yourself round the table with the free hand's stick.
function nudge(dx, dz) {
  const { th } = tablePose, c = Math.cos(th), s = Math.sin(th);
  tablePose.x -= dx * c + dz * s;
  tablePose.z -= -dx * s + dz * c;
  applyTablePose();
}

function onSelect(c) {
  sfx.unlock();
  if (menu.mesh.visible) {
    const uv = pointAt(c);
    if (uv) menu.click(uv);
    return;
  }
  if (c === offCtrl()) toss();
}

function pointAt(c) {
  c.ray.updateWorldMatrix(true, false);
  const o = new V3().setFromMatrixPosition(c.ray.matrixWorld);
  const d = new V3(0, 0, -1).transformDirection(c.ray.matrixWorld);
  raycaster.set(o, d);
  const hit = raycaster.intersectObject(menu.mesh, false)[0];
  return hit ? hit.uv : null;
}

function pollXR(dt) {
  let hoverUV = null;
  for (const c of ctrls) {
    if (!c.source) { c.dot.visible = false; c.line.visible = false; continue; }
    const p = c.grip.getWorldPosition(new V3());
    c.vel.copy(p).sub(c.prevPos).divideScalar(Math.max(dt, 1e-3));
    c.prevPos.copy(p);
    // Pointer when the menu is up.
    const showRay = menu.mesh.visible;
    c.line.visible = showRay;
    c.dot.visible = false;
    if (showRay) {
      const uv = pointAt(c);
      const hit = uv && raycaster.intersectObject(menu.mesh, false)[0];
      if (hit) { c.dot.visible = true; c.dot.position.copy(hit.point); c.line.scale.z = hit.distance; hoverUV = uv; }
      else c.line.scale.z = 2;
    }
    const gp = c.source.gamepad;
    if (!gp) continue;
    const btn = i => !!gp.buttons[i]?.pressed;
    const isOff = c === offCtrl();
    // X / Y (or A / B on the free hand) toggle the menu.
    for (const bi of [4, 5]) {
      const now = btn(bi);
      if (now && !c.pressed[bi] && isOff) toggleMenu();
      c.pressed[bi] = now;
    }
    if (isOff) {
      // Click the stick to recentre the table in front of you (not the grip:
      // people squeeze that just holding the controller).
      const stick = btn(3);
      if (stick && !c.pressed[3]) { needRecentre = true; haptic(c, 0.5, 60); showBanner('Table recentred', '', C.accent2, 1.2); }
      c.pressed[3] = stick;
      const ax = gp.axes[2] ?? 0, ay = gp.axes[3] ?? 0;
      if (Math.abs(ax) > 0.35 || Math.abs(ay) > 0.35) nudge(ax * 0.9 * dt, ay * 0.9 * dt);
    }
  }
  menu.hover(hoverUV);
}

async function enterXR(mode) {
  sfx.unlock();
  const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'] });
  await renderer.xr.setSession(session);
  baseSpace = renderer.xr.getReferenceSpace();
  baseSpace.addEventListener?.('reset', () => { needRecentre = true; });
  G.inXR = true; G.desk = false; G.mr = mode === 'immersive-ar';
  W.setMixedReality(G.mr);
  scene.background = G.mr ? null : BG;
  needRecentre = true;
  try { if (session.supportedFrameRates?.includes(90)) await session.updateTargetFrameRate(90); } catch { /* keep default */ }
  session.addEventListener('end', () => {
    G.inXR = false; G.mr = false;
    W.setMixedReality(false);
    scene.background = BG;
    renderer.xr.setReferenceSpace(null);
    baseSpace = null;
    attachHands();
    resetDeskCamera();
    if (G.mode !== 'menu') openMenu();
    showOverlay(true);
  });
  attachHands();
  showOverlay(false);
  openMenu();
}

// ------------------------------------------------------------ desktop mode --
const deskPlane = new THREE.Plane(new V3(0, 0, 1), -1.62);
renderer.domElement.addEventListener('pointermove', e => {
  desk.mouse.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('pointerdown', () => {
  sfx.unlock();
  if (G.inXR || !menu.mesh.visible) return;
  raycaster.setFromCamera(desk.mouse, camera);
  const hit = raycaster.intersectObject(menu.mesh, false)[0];
  if (hit) menu.click(hit.uv);
});
window.addEventListener('keydown', e => {
  if (G.inXR) return;
  if (e.code === 'Escape' || e.code === 'KeyM') toggleMenu();
  else if (e.code === 'Space') { e.preventDefault(); toss(); }
});

function deskUpdate(dt) {
  raycaster.setFromCamera(desk.mouse, camera);
  if (menu.mesh.visible) {
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    menu.hover(hit ? hit.uv : null);
  }
  const p = new V3();
  if (!G.autoplay && raycaster.ray.intersectPlane(deskPlane, p)) {
    desk.target.set(THREE.MathUtils.clamp(p.x, -1.1, 1.1), THREE.MathUtils.clamp(p.y, TB.top + 0.04, 1.6), 1.62);
  }
  const b = G.ball;
  // Test hook (__sh.autoplay = true): the paddle follows the ball by itself.
  if (G.autoplay && G.ballState === 'held' && !G.paused) toss();
  if (G.autoplay && b && G.ballState === 'live' && G.ref?.due === P && desk.swing < 0 && (desk.planRef !== G.ref || desk.planHits !== G.ref.hits)) {
    // Go to where the ball will cross the paddle plane.
    desk.planRef = G.ref; desk.planHits = G.ref.hits;
    const q = PH.predict(b, { maxT: 1.5 }).samples.find(s => s.p.z >= 1.5 && s.v.z > 0);
    if (q) desk.target.set(THREE.MathUtils.clamp(q.p.x, -1.1, 1.1), THREE.MathUtils.clamp(q.p.y, TB.top + 0.04, 1.6), 1.62);
  }
  // Auto swing when the ball comes within reach.
  if (desk.swing < 0 && b && (G.ballState === 'live' || G.ballState === 'toss') && !G.paused) {
    const dz = desk.target.z - b.p.z, dx = Math.abs(b.p.x - desk.target.x), dy = Math.abs(b.p.y - desk.target.y);
    // Only once it's ours to hit: our toss on the way down, or after it bounced on our side.
    const coming = G.ref?.due === P && (G.ballState === 'toss' ? b.v.y < 0 && b.p.y < TB.top + 0.22 : b.v.z > 0);
    if (coming && dz < 0.42 && dz > -0.05 && dx < 0.32 && dy < 0.35) desk.swing = 0;
  }
  // The swing: forward and upwards through the ball, a gentle topspin stroke.
  let fz = 0.12, fy = -0.08;
  if (desk.swing >= 0) {
    desk.swing += dt / 0.16;
    const t = Math.min(1, desk.swing);
    fz = 0.12 - 0.42 * t; fy = -0.08 + 0.18 * t;
    if (desk.swing > 1.8) desk.swing = -1;
  }
  // The blade centre is 13 cm up the paddle; keep it at the mouse point.
  desk.outer.position.set(desk.target.x, desk.target.y + fy - 0.13, desk.target.z + fz);
  // Face the middle of the far half, tilted open a little (Rz tips the face up).
  const d = new V3(-desk.target.x * 0.8, 0, -1.2 - desk.target.z).normalize();
  const phi = Math.atan2(-d.x, -d.z);
  desk.outer.rotation.set(0, Math.PI / 2 + phi, 0.28, 'YXZ');
}

// ---------------------------------------------------------------- frame --
let lastT = 0;
renderer.setAnimationLoop(onFrame);
function onFrame(t, frame, render = true) {
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000) || 1 / 60);
  lastT = t;
  if (G.inXR && frame) {
    if (needRecentre && baseSpace) needRecentre = !recentre(frame);
    pollXR(dt);
  } else if (G.desk) deskUpdate(dt);

  samplePaddle(dt);
  if (!G.paused) simulate(dt);
  if (G.ballState === 'held' && G.ball) G.ball.p = heldBallPos();

  // Visuals.
  W.setBall(G.ball ? G.ball.p : null, G.ball ? PH.len(G.ball.v) : 0);
  if (!G.paused) G.bot.update(dt, G.now);
  W.robot.update(G.bot, G.ball?.p ?? null, dt);
  W.crowd.update(dt);
  if (W.machine.kick > 0) { W.machine.kick = Math.max(0, W.machine.kick - dt * 6); W.machine.tube.position.z = -(TB.halfL + 0.2) - W.machine.kick * 0.03; }
  for (const tg of targets.list) {
    tg.flash = Math.max(0, tg.flash - dt * 2);
    const pulse = 1 + Math.sin(G.now * 4) * 0.04 + tg.flash * 0.6;
    tg.g.scale.setScalar(pulse);
    tg.ring.material.color.setHex(tg.flash > 0 ? 0xffe35a : 0x46e6ff);
  }
  if (bannerLeft > 0) bannerLeft -= dt;
  const bo = banner.mesh.material;
  bo.opacity += ((bannerLeft > 0 ? 1 : 0) - bo.opacity) * Math.min(1, dt * 8);
  banner.mesh.visible = bo.opacity > 0.01;

  if (!render) return;
  renderer.render(scene, camera);
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  sfx.setListener(cam.matrixWorld.elements);
}

// Test hook: run the game for `sec` seconds at `fps` without waiting for the
// browser's frames (they stop while the preview pane is hidden).
function advance(sec, fps = 72) {
  const n = Math.round(sec * fps);
  for (let i = 0; i < n; i++) onFrame(lastT + 1000 / fps, null, i === n - 1);
}

// --------------------------------------------------------------- overlay --
const overlay = document.getElementById('overlay');
function showOverlay(on) { overlay.classList.toggle('hidden', !on); }

async function setupButtons() {
  const vr = document.getElementById('btn-vr'), ar = document.getElementById('btn-ar'), screen = document.getElementById('btn-screen');
  const note = document.getElementById('xr-note');
  const xr = navigator.xr;
  const vrOk = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
  const arOk = xr ? await xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  vr.disabled = !vrOk; ar.disabled = !arOk;
  if (vrOk) note.textContent = 'Ready. Pick up both controllers, paddle in your right hand (you can change that in Settings).';
  else note.textContent = window.isSecureContext
    ? 'VR isn\'t available in this browser. Open this page in the Meta Quest browser to play in VR.'
    : 'VR needs a secure (https) page. Open the https link in the Meta Quest browser.';
  vr.onclick = () => enterXR('immersive-vr').catch(err => { note.textContent = `Couldn't start VR: ${err.message}`; });
  ar.onclick = () => enterXR('immersive-ar').catch(err => { note.textContent = `Couldn't start mixed reality: ${err.message}`; });
  screen.onclick = () => {
    sfx.unlock();
    G.desk = true;
    showOverlay(false);
    openMenu();
  };
}
setupButtons();
drawScoreboard();
menu.redraw();
menu.mesh.visible = false;

// Handy for testing from the console.
window.__sh = {
  debugXR: () => ({ needRecentre, tablePose: { ...tablePose }, hasBase: !!baseSpace, custom: renderer.xr.getReferenceSpace() !== baseSpace }),
  G, PH, desk, sfx, advance, settings, W, startMatch, startPractice, openMenu, closeMenu, toss, pose, ctrls, renderer, camera, scene, menu, onMenuClick, enterXR };
