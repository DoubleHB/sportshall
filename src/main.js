// Sports Hall: table tennis for Meta Quest (WebXR), with a desktop preview.
// The scene is laid out in table space (see physics.js); in VR an offset
// reference space puts the table in front of you, so world = table space.
//
// Modes: menu, match (v a robot), practice (ball machine), versus (you host a
// friend on a PC). A friend who joins runs this page as a "guest": the host
// simulates everything and streams it; the guest only sends where their mouse
// points (see the GUEST section).
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import * as PH from './physics.js';
import { Referee, Match, P, O, other } from './rules.js';
import { Bot, Machine, LEVELS } from './ai.js';
import { assistShot } from './assist.js';
import { buildWorld, makePaddle } from './world.js';
import { CanvasBoard, Menu, C, FONT, roundRect } from './panel.js';
import { Sfx } from './audio.js';
import { RIVALS, QUICK, rivalById, talkLine, TALK_CHANCE, VOICE } from './rivals.js';
import { createConfetti, createBubble, buildTrophy, buildHuman, FLIP } from './fx.js';
import { DeskPaddle, BladeTracker, DESK_Z } from './desk.js';
import { hostGame, joinGame, cleanCode } from './net.js';

export const VERSION = '0.3.0';
const TB = PH.TABLE;
const V3 = THREE.Vector3;

// ------------------------------------------------------------- settings --
const FEEL = { size: PH.PADDLE.radius, bounce: PH.PADDLE.e, grip: PH.PADDLE.mu, power: 1, smooth: 0 };
const DEFAULTS = { hand: 'right', assist: 'light', serve: 'casual', angle: 0, sound: true, level: 'medium', games: 1, pace: 'medium', spin: 'none', place: 'mix', talk: 'beeps', feel: { ...FEEL }, exNear: 'chopper', exFar: 'vortex' };
const settings = load('sh_settings', DEFAULTS);
settings.feel = { ...FEEL, ...(settings.feel || {}) };
// Paddle feel (Settings > Paddle feel): each step, its limits, and how to show it.
const FEEL_STEPS = {
  size: { step: 0.004, min: 0.066, max: 0.11, label: 'Sweet spot', show: v => `${Math.round(v * 200)} cm wide`, hint: 'how big the hitting area is' },
  bounce: { step: 0.02, min: 0.7, max: 0.96, label: 'Bounce', show: v => `${Math.round(v * 100)}%`, hint: 'how lively the rubber is' },
  grip: { step: 0.05, min: 0.3, max: 0.9, label: 'Spin grip', show: v => `${Math.round(v * 100)}%`, hint: 'how much brushing the ball spins it' },
  power: { step: 0.05, min: 0.7, max: 1.5, label: 'Swing power', show: v => `${Math.round(v * 100)}%`, hint: 'how hard your swing feels to the ball' },
  smooth: { step: 0.1, min: 0, max: 0.7, label: 'Smoothing', show: v => (v ? `${Math.round(v * 100)}%` : 'Off'), hint: 'calms jittery tracking (adds a little lag)' },
};
function applyFeel() {
  const f = settings.feel;
  PH.PADDLE.radius = f.size; PH.PADDLE.e = f.bounce; PH.PADDLE.mu = f.grip;
  pose.power = f.power; pose.smooth = f.smooth;    // (only called once `pose` exists)
}
const stats = load('sh_stats', { wins: {}, losses: {}, bestStreak: 0, ladder: { beaten: [], champion: false } });
if (!stats.ladder) stats.ladder = { beaten: [], champion: false };
function load(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }
const ASSIST = { off: 0, light: 0.55, full: 1 };
const HOST_NAME = 'Player 1';

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
function resetDeskCamera() {
  if (G.view) {   // courtside, like a TV camera
    camera.position.set(3.4, 1.9, 1.1);
    camera.lookAt(0, 0.8, -0.1);
    return;
  }
  const s = G.role === 'guest' ? -1 : 1;
  // An upright phone: a little higher, looking further down, so the table fills the screen.
  const tall = window.innerWidth < window.innerHeight;
  camera.position.set(DESK_CAM.p.x, tall ? 1.85 : DESK_CAM.p.y, DESK_CAM.p.z * s);
  camera.lookAt(DESK_CAM.look.x, tall ? 0.5 : DESK_CAM.look.y, DESK_CAM.look.z * s);
}
// On an upright phone, widen the view so the whole table still fits across.
function fitCamera() {
  if (renderer.xr.isPresenting) return;
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? Math.min(100, 62 * Math.pow(1 / aspect, 0.65)) : 62;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', () => { fitCamera(); resetDeskCamera(); });
fitCamera();

const W = await buildWorld(scene, renderer);
const sfx = new Sfx();
sfx.enabled = settings.sound;

// ----------------------------------------------------------------- state --
const G = {
  role: 'solo',          // solo | host (a friend is connected) | guest
  mode: 'menu',          // menu | match | practice | versus
  paused: true,          // menu open
  tab: 'match',
  now: 0,
  ball: null,
  ballState: 'none',     // none | held | toss | live | dead
  holder: P,             // who is holding the ball to serve
  ref: null,
  match: null,
  bot: new Bot(settings.level),
  rival: null,           // the robot character in a match
  ladder: false,         // is this match a ladder challenge?
  streak: { who: null, n: 0 },
  machine: null,
  timers: [],
  lastHit: { P: -9, O: -9 },
  lastEventT: 0,
  practice: null,
  lastResult: null,
  autoplay: false,
  log: [],               // recent point results, for testing
  hitLog: [],            // your recent hits, for Settings > Paddle feel
  view: null,            // where VR puts you (null = behind your end of the table)
  inXR: false,
  mr: false,
  desk: false,
  net: null,             // { link, code, friend: {name, assist} | null, error }
};
resetDeskCamera();

function later(sec, fn) { G.timers.push({ t: G.now + sec, fn }); }
function runTimers() {
  if (!G.timers.length) return;
  const due = G.timers.filter(t => t.t <= G.now);
  if (!due.length) return;
  G.timers = G.timers.filter(t => t.t > G.now);
  due.forEach(t => t.fn());
}

// Sounds also go to a connected friend.
function sound(kind, p = null, s = 1) {
  sfx.play(kind, p, s);
  if (G.role === 'host' && G.mode === 'versus') send({ t: 'sfx', k: kind, p: p && [p.x, p.y, p.z], s });
}
function send(msg) { G.net?.link?.send(msg); }

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

// Your paddle on a screen, and the friend's paddle at the far end.
const desk = new DeskPaddle(1);
desk.mouse = new THREE.Vector2();
scene.add(desk.outer);
const friendDesk = new DeskPaddle(-1);
const friendPaddle = makePaddle({ fore: 0x1f7ae0 });
friendDesk.inner.add(friendPaddle.group);
friendDesk.outer.visible = false;
scene.add(friendDesk.outer);

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

// Blade poses frame to frame, for swept collisions.
const pose = new BladeTracker();
const friendPose = new BladeTracker();
applyFeel();
const toP = v => ({ x: v.x, y: v.y, z: v.z });
const hex = n => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------- characters and effects --
const confetti = createConfetti(scene);
const bubble = createBubble(scene);
const trophy = buildTrophy();
trophy.root.position.set(1.75, 0, -0.9);
trophy.root.visible = !!stats.ladder.champion;
scene.add(trophy.root);
// The friend you host, at the far end, and the host as seen by a guest.
const friendAvatar = buildHuman({ shirt: 0xff7a1a, hair: 0x6b3a1e });
friendAvatar.root.visible = false;
scene.add(friendAvatar.root);
const hostAvatar = buildHuman({ shirt: 0x2a9df4, headset: true });
hostAvatar.root.visible = false;
scene.add(hostAvatar.root);
const hostPaddle = makePaddle();
hostPaddle.group.visible = false;
scene.add(hostPaddle.group);

function setRival(r) {
  G.rival = r;
  W.robot.setLook(r.look);
  G.bot.setLevel(r.level, r.tweak);
}
setRival(rivalById(QUICK[settings.level]));

// Exhibitions: a second robot at the near end, with its own speech bubble.
const robot2 = W.makeRobot();
robot2.root.visible = false;
const bubble2 = createBubble(scene);
G.botP = new Bot('medium', { side: 1 });
G.rivalP = null;

// A robot talks: a speech bubble, plus beeps or a voice. who: O (the usual
// far-end robot) or P (the near-end robot in an exhibition).
let lastTalk = -9;
function robotSay(moment, force = false, who = O) {
  if ((G.mode !== 'match' && G.mode !== 'exhibition') || settings.talk === 'off') return;
  const rival = who === O ? G.rival : G.rivalP;
  if (!rival) return;
  if (!force && (Math.random() > (TALK_CHANCE[moment] ?? 0.5) || G.now - lastTalk < 3.5)) return;
  const line = talkLine(rival, moment);
  if (!line) return;
  lastTalk = G.now;
  (who === O ? bubble : bubble2).say(line, hex(rival.look.accent));
  const head = (who === O ? W.robot : robot2).headPos(new V3());
  const voice = VOICE[rival.voice] ?? { pitch: 1, rate: 1 };
  if (settings.talk === 'voice' && sfx.speak(line, voice)) return;
  if (settings.talk === 'beeps' || settings.talk === 'voice') sfx.babble(line, head, voice.pitch * 0.6 + 0.5);
}

// --------------------------------------------------------- boards and menu --
const scoreboard = new CanvasBoard(1.25, 0.62, 1000, 496, { transparent: true });
const banner = new CanvasBoard(1.5, 0.375, 1200, 300, { transparent: true });
banner.mesh.material.opacity = 0;
scene.add(scoreboard.mesh, banner.mesh);
// Boards face whoever is watching this screen (the guest looks from the far end).
function placeBoards() {
  const s = G.role === 'guest' ? -1 : 1;
  scoreboard.mesh.position.set(-1.75 * s, 1.55, -0.9 * s);
  scoreboard.mesh.rotation.set(0, 0.56 + (s < 0 ? Math.PI : 0), 0);
  banner.mesh.position.set(0, 2.05, -1.75 * s);    // above the opponent's head
  banner.mesh.rotation.set(0, s < 0 ? Math.PI : 0, 0);
}
placeBoards();

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
  if (sub) { g.fillStyle = '#c9d6f2'; g.font = `500 ${sub.length > 34 ? 46 : 56}px ${FONT}`; g.fillText(sub, w / 2, h / 2 + 62); }
  banner.flush();
  bannerLeft = secs;
}

// Names on the board: who is "you" on this screen and who you're playing.
function opponentName() {
  if (G.role === 'guest') return G.guest?.hostName ?? HOST_NAME;
  if (G.mode === 'versus') return G.net?.friend?.name ?? 'Friend';
  return G.rival ? `${G.rival.name} · ${LEVELS[G.rival.level].name}` : 'Robot';
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
    const me = G.role === 'guest' ? O : P;
    g.textAlign = 'left'; g.fillStyle = C.accent; g.font = `800 46px ${FONT}`;
    const ex = G.mode === 'exhibition';
    g.fillText(ex ? 'EXHIBITION' : G.ladder ? 'LADDER' : G.mode === 'versus' || G.role === 'guest' ? 'FRIENDLY' : 'TABLE TENNIS', 50, 66);
    g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `500 34px ${FONT}`;
    g.fillText(m ? (m.games > 1 ? `Best of ${m.games} · game ${m.gameNo + 1}` : '1 game to 11') : 'Ready', w - 50, 66);
    const rows = ex ? [[P, G.rivalP.name], [O, G.rival.name]] : [[me, 'YOU'], [other(me), opponentName()]];
    const playing = G.mode === 'match' || G.mode === 'versus' || ex;
    rows.forEach(([who, name], i) => {
      const y = 190 + i * 150;
      roundRect(g, 40, y - 62, w - 80, 124, 24);
      g.fillStyle = i === 0 ? '#16233f' : '#22192b'; g.fill();
      if (m && !m.over && m.server === who && playing) { g.beginPath(); g.arc(80, y, 14, 0, Math.PI * 2); g.fillStyle = '#ffd23f'; g.fill(); }
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 ${i === 0 ? 52 : name.length > 18 ? 36 : 44}px ${FONT}`;
      g.fillText(name, 110, y);
      if (m && m.games > 1) {
        g.textAlign = 'center'; g.fillStyle = C.dim; g.font = `700 44px ${FONT}`;
        g.fillText(String(m.gamesWon[who]), w - 250, y);
      }
      g.textAlign = 'right'; g.fillStyle = i === 0 ? '#7fd1ff' : '#ffae6b'; g.font = `800 96px ${FONT}`;
      g.fillText(String(m ? m.score[who] : 0), w - 70, y + 4);
    });
  }
  scoreboard.flush();
}
const cap = s => s[0].toUpperCase() + s.slice(1);
const spinName = s => ({ none: 'No spin', top: 'Topspin', back: 'Backspin', mix: 'Mixed spin' })[s] || s;

const menu = new Menu(1.3, 0.917, 1560, 1100, renderMenu, onMenuClick);
menu.mesh.position.set(0, 1.32, 0.85);
menu.mesh.rotation.x = -0.12;
menu.mesh.renderOrder = 10;               // always on top of the paddle and table
menu.mesh.material.depthTest = false;
scene.add(menu.mesh);

function renderMenu(ui) {
  const { w } = ui;
  ui.text('SPORTS HALL', 60, 74, { size: 32, weight: 800, color: C.accent });
  ui.text('Table Tennis', 60, 128, { size: 52, weight: 800 });
  if (stats.ladder.champion) ui.text('★ Champion', w - 60, 120, { size: 40, weight: 800, color: '#d4af37', align: 'right' });
  const tabs = [['match', 'Match'], ['ladder', 'Ladder'], ['practice', 'Practice'], ['friend', 'Friend'], ['settings', 'Settings']];
  const tw = (w - 120 - 4 * 14) / 5;
  const parentTab = { watch: 'match', feel: 'settings' }[G.tab] ?? G.tab;
  tabs.forEach(([id, label], i) => ui.button(`tab:${id}`, 60 + i * (tw + 14), 160, tw, 78, label, { selected: parentTab === id, size: 34 }));
  const L = 60, R = w - 60, width = R - L;
  const label = (s, y) => ui.text(s, L, y, { size: 32, weight: 650, color: C.dim });
  const dim = (s, y, size = 30) => ui.text(s, L, y, { size, weight: 500, color: C.dim });
  const inMatch = G.mode === 'match' && G.match && !G.match.over;

  if (G.tab === 'match') {
    label('Opponent', 298);
    ui.options('level', L, 316, width, 112, ['easy', 'medium', 'hard', 'pro'].map(k => [k, LEVELS[k].name, rivalById(QUICK[k]).name]), settings.level);
    label('Match length', 482);
    ui.options('games', L, 500, width, 92, [[1, '1 game'], [3, 'Best of 3'], [5, 'Best of 5']], settings.games);
    const rec = Object.keys(LEVELS).map(k => `${LEVELS[k].name} ${stats.wins[k] || 0}–${stats.losses[k] || 0}`).join('   ·   ');
    dim(`Your record (won–lost):  ${rec}`, 650);
    if (G.lastResult) ui.text(G.lastResult, L, 700, { size: 34, weight: 700, color: G.lastResult.startsWith('You won') ? C.good : C.text });
    if (inMatch) {
      ui.button('resume', L, 760, width / 2 - 10, 120, 'Resume', { primary: true, size: 48 });
      ui.button('play', L + width / 2 + 10, 760, width / 2 - 10, 120, 'New match', { size: 42 });
    } else ui.button('play', L, 760, width, 120, 'Play', { primary: true, size: 52 });
    ui.button('tab:watch', L, 900, width, 76, G.mode === 'exhibition' ? 'Exhibition: resume or change robots' : 'Watch two robots play (exhibition)', { size: 32 });
  } else if (G.tab === 'watch') {
    dim('Pick two robots and watch them play from a courtside seat. They talk to each other too.', 292);
    const chips = (key, y, current) => ui.options(key, L, y, width, 84, RIVALS.map(r => [r.id, r.name, LEVELS[r.level].name]), current, 10);
    label('Near end (left of you)', 350);
    chips('exNear', 366, settings.exNear);
    label('Far end (right of you)', 500);
    chips('exFar', 516, settings.exFar);
    label('Match length', 650);
    ui.options('games', L, 666, width, 84, [[1, '1 game'], [3, 'Best of 3'], [5, 'Best of 5']], settings.games);
    if (G.mode === 'exhibition' && G.match && !G.match.over) {
      ui.button('resume', L, 800, width / 2 - 10, 110, 'Resume', { primary: true, size: 46 });
      ui.button('watch', L + width / 2 + 10, 800, width / 2 - 10, 110, 'Restart', { size: 40 });
    } else ui.button('watch', L, 800, width, 110, 'Start the exhibition', { primary: true, size: 46 });
    ui.button('tab:match', L, 930, 300, 70, '‹ Back', { size: 30 });
  } else if (G.tab === 'ladder') {
    const beaten = stats.ladder.beaten;
    dim(stats.ladder.champion ? 'You beat them all. You\'re the champion! Replay anyone you like.' : 'Climb the ladder: beat each robot to face the next. Beat Omega to become champion.', 292);
    RIVALS.forEach((r, i) => {
      const y = 318 + i * 104, done = beaten.includes(r.id), open = i === 0 || beaten.includes(RIVALS[i - 1].id);
      const g = ui.g;
      roundRect(g, L, y, width, 92, 22);
      g.fillStyle = open ? '#1b2438' : '#141a29'; g.fill();
      g.beginPath(); g.arc(L + 50, y + 46, 26, 0, Math.PI * 2); g.fillStyle = open ? hex(r.look.accent) : '#3a4560'; g.fill();
      ui.text(String(i + 1), L + 50, y + 48, { size: 30, weight: 800, align: 'center', base: 'middle', color: '#0e1320' });
      ui.text(r.name, L + 100, y + 40, { size: 38, weight: 800, color: open ? '#fff' : '#6b7896' });
      ui.text(`${LEVELS[r.level].name} · ${r.games === 1 ? '1 game' : `best of ${r.games}`} · ${r.bio}`, L + 100, y + 76, { size: 25, weight: 500, color: open ? C.dim : '#4f5b78' });
      if (done) {
        ui.text('✓ Beaten', R - 250, y + 48, { size: 32, weight: 800, color: C.good, align: 'right', base: 'middle' });
        ui.button(`ladder:${r.id}`, R - 220, y + 14, 200, 64, 'Replay', { size: 30 });
      } else if (open) ui.button(`ladder:${r.id}`, R - 260, y + 12, 240, 68, 'Challenge', { primary: true, size: 32 });
      else ui.text('Locked', R - 30, y + 48, { size: 30, weight: 700, color: '#55627e', align: 'right', base: 'middle' });
    });
    if (inMatch) ui.button('resume', L, 950, width, 64, 'Resume match', { primary: true, size: 32 });
  } else if (G.tab === 'practice') {
    dim('The ball machine feeds you balls. Hit them back onto the table, and aim for the glowing targets.', 292);
    label('Pace', 352);
    ui.options('pace', L, 368, width, 84, [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']], settings.pace);
    label('Spin', 506);
    ui.options('spin', L, 522, width, 84, [['none', 'None'], ['top', 'Topspin'], ['back', 'Backspin'], ['mix', 'Mix']], settings.spin);
    label('Where', 660);
    ui.options('place', L, 676, width, 84, [['forehand', 'Forehand'], ['backhand', 'Backhand'], ['middle', 'Middle'], ['mix', 'Anywhere']], settings.place);
    if (G.mode === 'practice') {
      ui.button('resume', L, 810, width / 2 - 10, 110, 'Resume', { primary: true, size: 46 });
      ui.button('practice', L + width / 2 + 10, 810, width / 2 - 10, 110, 'Restart', { size: 40 });
    } else ui.button('practice', L, 810, width, 110, 'Start practice', { primary: true, size: 48 });
  } else if (G.tab === 'friend') {
    const n = G.net;
    dim('Play a friend on a PC or laptop. They open doublehb.github.io/sportshall', 292);
    dim('in their browser, choose "Join a friend\'s game" and type the code below.', 334);
    if (!n?.link) {
      if (n?.error) ui.text(n.error, L, 420, { size: 30, weight: 600, color: C.bad });
      ui.button('host', L, n?.busy ? 600 : 470, width, 120, n?.busy ? 'Opening a room…' : 'Host a game', { primary: !n?.busy, size: 48, disabled: !!n?.busy });
    } else {
      roundRect(ui.g, L, 380, width, 220, 30);
      ui.g.fillStyle = '#101727'; ui.g.fill();
      ui.text('ROOM CODE', w / 2, 425, { size: 30, weight: 700, color: C.dim, align: 'center' });
      ui.text(n.code.split('').join(' '), w / 2, 530, { size: 130, weight: 900, color: '#ffd23f', align: 'center' });
      const st = n.friend ? `${n.friend.name} is here!` : 'Waiting for your friend to join…';
      ui.text(st, w / 2, 660, { size: 40, weight: 800, color: n.friend ? C.good : C.text, align: 'center' });
      ui.text(`Match length: ${settings.games === 1 ? '1 game' : `best of ${settings.games}`} (set on the Match tab)`, w / 2, 715, { size: 28, weight: 500, color: C.dim, align: 'center' });
      const inVersus = G.mode === 'versus' && G.match && !G.match.over;
      if (inVersus) ui.button('resume', L, 760, width / 2 - 10, 110, 'Resume', { primary: true, size: 46 });
      else ui.button('versus', L, 760, width / 2 - 10, 110, 'Start match', { primary: !!n.friend, disabled: !n.friend, size: 44 });
      ui.button('unhost', L + width / 2 + 10, 760, width / 2 - 10, 110, 'Stop hosting', { size: 40 });
    }
  } else if (G.tab === 'settings') {
    label('Paddle hand', 298);
    ui.options('hand', L, 314, width / 2 - 20, 84, [['right', 'Right'], ['left', 'Left']], settings.hand);
    ui.text('Sound', L + width / 2 + 20, 298, { size: 32, weight: 650, color: C.dim });
    ui.options('sound', L + width / 2 + 20, 314, width / 2 - 20, 84, [[true, 'On'], [false, 'Off']], settings.sound);
    label('Aim assist', 446);
    ui.options('assist', L, 462, width, 96, [['off', 'Off', 'real physics'], ['light', 'Light', 'a little help'], ['full', 'Full', 'always lands']], settings.assist);
    label('Robot talk', 600);
    ui.options('talk', L, 616, width, 84, [['off', 'Off'], ['bubbles', 'Bubbles'], ['beeps', 'Beeps'], ['voice', 'Voice']], settings.talk);
    label('Serve rules', 742);
    ui.options('serve', L, 758, width / 2 - 20, 96, [['casual', 'Casual', 'straight over'], ['proper', 'Proper', 'bounce your side first']], settings.serve);
    ui.text('Paddle angle', L + width / 2 + 20, 742, { size: 32, weight: 650, color: C.dim });
    const ax = L + width / 2 + 20;
    ui.button('angle:-', ax, 758, 120, 96, '–', { size: 56 });
    ui.text(`${settings.angle > 0 ? '+' : ''}${settings.angle}°`, ax + (width / 2 - 20) / 2, 808, { size: 52, weight: 800, align: 'center', base: 'middle' });
    ui.button('angle:+', ax + width / 2 - 140, 758, 120, 96, '+', { size: 56 });
    const third = (width - 40) / 3;
    ui.button('tab:feel', L, 890, G.inXR ? third : width, 90, 'Paddle feel…', { size: 36 });
    if (G.inXR) {
      ui.button('recentre', L + third + 20, 890, third, 90, 'Recentre table', { size: 34 });
      ui.button('exit', L + 2 * (third + 20), 890, third, 90, G.mr ? 'Exit mixed reality' : 'Exit VR', { size: 34 });
    }
  } else if (G.tab === 'feel') {
    dim('Tune how the paddle feels. Changes work straight away: try a few shots, then come back.', 292);
    Object.entries(FEEL_STEPS).forEach(([key, s], i) => {
      const y = 320 + i * 92, v = settings.feel[key];
      ui.text(s.label, L, y + 38, { size: 36, weight: 750 });
      ui.text(s.hint, L, y + 72, { size: 25, weight: 500, color: C.dim });
      ui.button(`feel:${key}:-`, R - 470, y + 4, 100, 76, '–', { size: 50 });
      ui.text(s.show(v), R - 235, y + 44, { size: 40, weight: 800, align: 'center', base: 'middle', color: Math.abs(v - FEEL[key]) > 1e-6 ? '#ffd23f' : '#fff' });
      ui.button(`feel:${key}:+`, R - 100, y + 4, 100, 76, '+', { size: 50 });
    });
    // Your last few hits, to see what the paddle is doing.
    const log = G.hitLog;
    ui.text('Your last hits', L, 800, { size: 30, weight: 700, color: C.dim });
    if (!log.length) dim('Play a few shots and they show up here.', 846, 28);
    log.slice(-4).reverse().forEach((h, i) => {
      ui.text(`Swing ${h.pad.toFixed(1)} m/s → ball ${Math.round(h.out * 3.6)} km/h · ${h.rpm} rpm${h.assisted ? ' · assist helped' : ''}${h.result ? ` · ${h.result}` : ''}`, L, 846 + i * 38, { size: 26, weight: 500, color: h.result === 'landed' ? C.good : h.result ? '#ffb4a8' : C.text });
    });
    ui.button('feel:reset', R - 520, 930, 250, 70, 'Reset all', { size: 30 });
    ui.button('tab:settings', R - 250, 930, 250, 70, '‹ Back', { size: 30 });
  }
  const help = G.inXR
    ? 'Free hand: trigger = toss the ball · X/Y = menu · stick = move · click stick = recentre   |   point + trigger = click'
    : isTouch() ? 'Drag = move the paddle (it swings by itself) · Serve and Menu buttons are at the bottom'
      : 'Mouse = move the paddle (it swings by itself) · Space = toss · Esc = menu';
  ui.text(help, w / 2, 1046, { size: 27, weight: 500, color: C.dim, align: 'center' });
  ui.text(`v${VERSION}`, w - 40, 1080, { size: 22, weight: 500, color: '#55627e', align: 'right' });
}

function onMenuClick(id) {
  sfx.play('click');
  const [k, v, dir] = id.split(':');
  if (k === 'tab') G.tab = v;
  else if (k === 'feel') {
    if (v === 'reset') settings.feel = { ...FEEL };
    else {
      const s = FEEL_STEPS[v];
      settings.feel[v] = +Math.min(s.max, Math.max(s.min, settings.feel[v] + (dir === '+' ? s.step : -s.step))).toFixed(3);
    }
    applyFeel();
  }
  else if (k === 'exNear' || k === 'exFar') settings[k] = v;
  else if (id === 'watch') startExhibition();
  else if (k === 'level') { settings.level = v; if (G.mode !== 'match') setRival(rivalById(QUICK[v])); }
  else if (k === 'games') settings.games = +v;
  else if (['pace', 'spin', 'place', 'assist', 'serve', 'talk'].includes(k)) settings[k] = v;
  else if (k === 'hand') { settings.hand = v; attachHands(); }
  else if (k === 'sound') { settings.sound = v === 'true'; sfx.enabled = settings.sound; }
  else if (k === 'angle') { settings.angle = Math.max(-60, Math.min(60, settings.angle + (v === '+' ? 5 : -5))); applyAngle(); }
  else if (k === 'ladder') startMatch({ rival: rivalById(v), ladder: true });
  else if (id === 'play') startMatch();
  else if (id === 'practice') startPractice();
  else if (id === 'resume') closeMenu();
  else if (id === 'host') startHosting();
  else if (id === 'unhost') stopHosting();
  else if (id === 'versus') startVersus();
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
  pose.invalidate();    // no velocity spike from where the paddle was when we paused
}
function toggleMenu() { if (G.paused) closeMenu(); else openMenu(); }

// ------------------------------------------------------------ game flow --
function clearPlay() {
  G.timers = []; G.ball = null; G.ballState = 'none'; G.ref = null; G.ladder = false;
  G.streak = { who: null, n: 0 };
  W.setBall(null);
  targets.root.visible = false;
  bubble.hide(); bubble2.hide();
  W.robot.root.visible = true; W.machine.root.visible = false;
  robot2.root.visible = false; desk.outer.visible = true;
  friendAvatar.root.visible = false; friendDesk.outer.visible = false;
  setView(null);
}

// Where you are: null = behind your end of the table; COURTSIDE = a seat by
// the side of the court (x, z in table space, th = the way you face, lift =
// how far up the seat raises you).
const COURTSIDE = { x: 3.3, z: 0.3, th: Math.PI / 2, lift: 0.3 };
function setView(v) {
  if (G.view === v) return;
  G.view = v;
  if (G.inXR) needRecentre = true;
  else resetDeskCamera();
  placeMenu();
}
// The menu floats about a metre in front of wherever you are.
function placeMenu() {
  const s = G.view ?? { x: 0, z: TB.halfL + 0.6, th: 0, lift: 0 };
  const fx = -Math.sin(s.th), fz = -Math.cos(s.th);
  menu.mesh.position.set(s.x + fx * 1.12, 1.32 + (s.lift || 0), s.z + fz * 1.12);
  menu.mesh.rotation.set(-0.12, s.th, 0, 'YXZ');
}

function startExhibition() {
  clearPlay();
  G.mode = 'exhibition';
  setRival(rivalById(settings.exFar));
  G.rivalP = rivalById(settings.exNear);
  robot2.setLook(G.rivalP.look);
  G.botP.setLevel(G.rivalP.level, G.rivalP.tweak);
  G.botP.reset();
  robot2.root.visible = true;
  desk.outer.visible = false;
  G.match = new Match({ games: settings.games, firstServer: Math.random() < 0.5 ? P : O });
  setView(COURTSIDE);
  closeMenu();
  drawScoreboard();
  showBanner(`${G.rivalP.name} v ${G.rival.name}`, 'Exhibition · sit back and enjoy it', C.accent, 3);
  later(0.8, () => robotSay('start', true, P));
  later(2.4, () => robotSay('start', true, O));
  later(3.6, newPoint);
}

// opts: { rival, ladder } (default: the quick-play robot for the chosen level)
function startMatch({ rival = rivalById(QUICK[settings.level]), ladder = false } = {}) {
  clearPlay();
  G.mode = 'match';
  G.ladder = ladder;
  setRival(rival);
  G.match = new Match({ games: ladder ? rival.games : settings.games, firstServer: Math.random() < 0.5 ? P : O });
  closeMenu();
  drawScoreboard();
  showBanner(ladder ? `Ladder: ${rival.name}` : `v ${rival.name}`, `${G.match.server === P ? 'You serve first' : `${rival.name} serves first`}${G.match.games > 1 ? ` · best of ${G.match.games}` : ''}`, hex(rival.look.accent), 2.4);
  later(0.9, () => robotSay('start', true));
  later(2.4, newPoint);
}

function newPoint() {
  if (!['match', 'versus', 'exhibition'].includes(G.mode) || !G.match || G.match.over) return;
  const server = G.match.server;
  G.ref = new Referee(server, { casualServe: settings.serve === 'casual' && G.mode !== 'exhibition' });
  G.bot.reset(); G.botP.reset();
  G.lastEventT = G.now;
  drawScoreboard();
  sendScore();
  const gp = G.match.gamePoint;
  if (G.mode === 'exhibition') {
    G.ball = null; G.ballState = 'none'; W.setBall(null);
    later(1.0, () => robotServe(server));
  } else if (server === P) {
    holdBall(P);
    showBanner(gp === P ? 'Game point' : 'Your serve', tossHint(), C.accent2, 3);
    send({ t: 'msg', k: 'serve', who: P, gp });
  } else if (G.mode === 'versus') {
    holdBall(O);
    showBanner(`${opponentName()} to serve`, gp === O ? 'Game point' : '', C.accent2, 2.5);
    send({ t: 'msg', k: 'serve', who: O, gp });
  } else {
    G.ball = null; G.ballState = 'none'; W.setBall(null);
    later(1.0, robotServe);
  }
}

function robotServe(who = O) {
  if ((G.mode !== 'match' && G.mode !== 'exhibition') || !G.ref || G.ref.stage !== 'toss') return;
  G.ball = (who === O ? G.bot : G.botP).startServe(G.now);
  G.ballState = 'toss';
  G.lastEventT = G.now;
  sound('toss', G.ball.p);
}

function holdBall(who) {
  G.holder = who;
  G.ball = PH.makeBall(heldBallPos(who));
  G.ballState = 'held';
}

function heldBallPos(who = G.holder) {
  if (who === O) return friendDesk.heldPos();
  if (G.inXR) {
    const oc = offCtrl();
    if (oc && oc.grip.visible) {
      const p = oc.grip.getWorldPosition(new V3());
      return { x: p.x, y: p.y + 0.07, z: p.z };
    }
    return { x: -0.3, y: 1.1, z: TB.halfL + 0.3 };
  }
  return desk.heldPos();
}

function toss(who = P) {
  if (G.ballState !== 'held' || G.holder !== who || G.paused) return;
  let v = { x: 0, y: 2.3, z: 0 };
  const oc = who === P ? offCtrl() : null;
  if (G.inXR && oc) v = { x: oc.vel.x * 0.3, y: 2.2 + Math.max(0, oc.vel.y) * 0.3, z: oc.vel.z * 0.3 };
  G.ball.v = v;
  G.ball.w = PH.vec();
  G.ballState = 'toss';
  G.lastEventT = G.now;
  sound('toss', G.ball.p);
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
// A paddle hit by you (P) or the friend you host (O).
function onPaddleHit(who, hit, tracker) {
  G.lastHit[who] = G.now;
  const strength = hit.speed / 12;
  sound('paddle', G.ball.p, strength);
  if (who === P) haptic(paddleCtrl(), 0.25 + strength * 0.6, 22);
  if (!G.ref || G.ballState === 'dead') return;
  const serving = G.ref.stage === 'toss';
  const assist = who === P ? settings.assist : (G.net?.friend?.assist ?? 'light');
  // Casual serves get full help whenever assist is on: serving is the fiddly bit.
  const a = serving && assist !== 'off' ? 1 : ASSIST[assist];
  if (who === P) G.lastHitInfo = { p: { ...G.ball.p }, v: { ...G.ball.v }, w: { ...G.ball.w }, padVel: tracker.vel, n: toP(tracker.n) };
  let assisted = false;
  if (a && !(serving && settings.serve === 'proper')) {
    const v = assistShot(G.ball, a, who === P ? 1 : -1);
    if (v) { G.ball.v = v; assisted = true; }
  }
  if (who === P) {
    G.hitLog.push({ pad: PH.len(tracker.vel) * tracker.power, out: PH.len(G.ball.v), rpm: Math.round(PH.len(G.ball.w) * 60 / (2 * Math.PI)), assisted, result: null });
    if (G.hitLog.length > 12) G.hitLog.shift();
  }
  G.ballState = 'live';
  const res = G.ref.event({ type: 'hit', who, t: G.now, p: { ...G.ball.p } });
  if (G.mode === 'match' && who === P) G.bot.planReturn(G.ball, G.now);
  afterRef(res);
}

function onRobotHit(shot, who = O) {
  G.ball.v = shot.v; G.ball.w = shot.w;
  G.ballState = 'live';
  sound('paddle', G.ball.p, PH.len(shot.v) / 12);
  const res = G.ref.event({ type: 'hit', who, t: G.now, p: { ...G.ball.p } });
  // In an exhibition the other robot gets ready for it.
  if (G.mode === 'exhibition' && !res) (who === O ? G.botP : G.bot).planReturn(G.ball, G.now);
  afterRef(res);
}

function handleEvent(e) {
  const speed = PH.len(G.ball.v);
  if (e.type === 'table' || e.type === 'edge') sound('table', e.p, speed / 7);
  else if (e.type === 'net') sound('net', e.p, speed / 6);
  else if (e.type === 'floor' && speed > 0.4) sound('floor', e.p, speed / 6);
  G.lastEventT = G.now;
  if (!G.ref || G.ballState === 'dead' || G.ballState === 'held') return;
  afterRef(G.ref.event(e));
}

function afterRef(res) {
  const info = G.ref?.info;
  // How your last shot turned out, for the hit log.
  const last = G.hitLog[G.hitLog.length - 1];
  if (last && !last.result) {
    if (info?.type === 'landed' && info.hitter === P) last.result = 'landed';
    else if (res?.loser === P) last.result = res.reason.toLowerCase();
  }
  if (G.mode === 'practice') {
    if (info?.type === 'landed' && info.hitter === P) return practiceResult(true, info.p);
    if (res && !res.retoss) return practiceResult(res.winner === P, null);
    return;
  }
  if (!res) return;
  if (res.retoss) {
    G.ballState = 'dead';
    const server = G.ref.server;
    if (G.mode === 'exhibition') later(0.8, () => robotServe(server));
    else if (server === P || G.mode === 'versus') later(0.5, () => { if (G.ref?.stage === 'toss') holdBall(server); });
    else later(0.8, () => robotServe(O));
    return;
  }
  G.ballState = 'dead';
  if (res.let) {
    showBanner('Let', 'It touched the net, serve again', C.accent2, 1.6);
    send({ t: 'msg', k: 'let' });
    later(1.6, newPoint);
    return;
  }
  pointOver(res);
}

function pointOver(res) {
  G.log.push({ t: +G.now.toFixed(2), winner: res.winner, reason: res.reason });
  const hits = G.ref?.hits ?? 0;
  const r = G.match.point(res.winner);
  const you = res.winner === P;
  const versus = G.mode === 'versus';
  const them = versus ? (G.net?.friend?.name ?? 'Friend') : G.rival.name;
  const reason = res.loser === P ? res.reason : `${them}: ${res.reason.charAt(0).toLowerCase()}${res.reason.slice(1)}`;
  G.streak = G.streak.who === res.winner ? { who: res.winner, n: G.streak.n + 1 } : { who: res.winner, n: 1 };
  if (G.mode === 'exhibition') return exhibitionPoint(res, r, hits);
  if (!versus) G.bot.mood = you ? -1 : 1;
  drawScoreboard();
  sendScore();
  send({ t: 'msg', k: r.match ? 'match' : r.game ? 'game' : 'point', winner: res.winner, loser: res.loser, reason: res.reason, history: G.match.history });

  // What the robot makes of it.
  if (!versus) {
    const m = G.match, s = m.score;
    let moment;
    if (r.match) moment = you ? 'playerWinsMatch' : 'robotWinsMatch';
    else if (r.game) moment = you ? 'playerWinsGame' : 'robotWinsGame';
    else if (s.P >= 10 && s.P === s.O) moment = 'deuce';
    else if (m.gamePoint) moment = m.gamePoint === P ? 'playerGamePoint' : 'robotGamePoint';
    else if (G.streak.n === 3 || G.streak.n === 5) moment = you ? 'playerStreak' : 'robotStreak';
    else if (hits >= 10) moment = 'longRally';
    else if (!you && /own side/.test(res.reason)) moment = 'playerNet';
    else if (!you && /missed the table/i.test(res.reason)) moment = 'playerLong';
    else moment = you ? 'playerPoint' : 'robotPoint';
    later(0.35, () => robotSay(moment, !!(r.game || r.match)));
    if (r.match) W.robot.celebrate(you ? 'slump' : 'dance');
    else if (r.game) W.robot.celebrate(you ? 'droop' : 'dance');
    else if (!you) W.robot.celebrate(G.streak.n >= 3 ? 'spin' : 'pump');
    else if (Math.random() < 0.6) W.robot.celebrate('droop');
  }

  if (r.match) {
    const m = G.match;
    const games = m.history.map(s => `${s.P}–${s.O}`).join(', ');
    if (you) {
      sound('fanfare'); sound('cheer', null, 1); W.crowd.cheer(2); burst(1);
    } else {
      sound('groan');
      if (!versus) confetti.burst(W.robot.headPos(new V3()), 90, 0.6);
    }
    if (versus) {
      G.lastResult = `${you ? 'You won' : `${them} won`} the friendly: ${games}`;
      showBanner(you ? 'You win!' : `${them} wins`, games, you ? C.good : C.bad, 4);
      later(4.5, () => { G.mode = 'menu'; openMenu('friend'); });
      return;
    }
    const lvl = G.rival.level;
    if (you) stats.wins[lvl] = (stats.wins[lvl] || 0) + 1; else stats.losses[lvl] = (stats.losses[lvl] || 0) + 1;
    let title = you ? 'You win!' : `${them} wins`, sub = games, tab = G.ladder ? 'ladder' : 'match';
    if (G.ladder && you) {
      if (!stats.ladder.beaten.includes(G.rival.id)) stats.ladder.beaten.push(G.rival.id);
      const next = RIVALS[RIVALS.indexOf(G.rival) + 1];
      if (!next) {
        stats.ladder.champion = true; trophy.root.visible = true;
        title = 'CHAMPION!'; sub = `You beat Omega ${games}`;
        later(1.2, () => { burst(1.4); sound('fanfare'); W.crowd.cheer(2); });
      } else sub = `${games} · ${next.name} unlocked`;
    }
    save('sh_stats', stats);
    G.lastResult = `${you ? 'You won' : `${them} won`} against ${them}: ${games}`;
    showBanner(title, sub, you ? (title === 'CHAMPION!' ? '#d4af37' : C.good) : C.bad, 4.5);
    later(5, () => { G.mode = 'menu'; openMenu(tab); });
    return;
  }
  if (r.game) {
    const g = G.match.history[G.match.history.length - 1];
    showBanner(you ? 'Game to you!' : `Game to ${them}`, `${g.P}–${g.O}`, you ? C.good : C.bad, 3);
    if (you) { sound('cheer', null, 0.8); W.crowd.cheer(1.2); } else sound('lose');
    later(3.4, newPoint);
    return;
  }
  if (you) { sound('win'); W.crowd.cheer(0.5); sound('cheer', null, 0.3); } else sound('lose');
  showBanner(you ? 'Your point' : `${them}'s point`, reason, you ? C.good : C.bad, 1.9);
  later(2.0, newPoint);
}

// A point in a robot-v-robot exhibition: the scorer gloats, the other sulks.
function exhibitionPoint(res, r, hits) {
  const win = res.winner, lose = res.loser;
  const rival = w => (w === P ? G.rivalP : G.rival);
  const model = w => (w === P ? robot2 : W.robot);
  const bot = w => (w === P ? G.botP : G.bot);
  bot(win).mood = 1; bot(lose).mood = -1;
  drawScoreboard();
  const big = r.match || r.game;
  W.crowd.cheer(r.match ? 2 : r.game ? 1.2 : 0.5);
  sound('cheer', null, r.match ? 1 : r.game ? 0.7 : 0.3);
  const moment = r.match ? 'robotWinsMatch' : r.game ? 'robotWinsGame' : G.streak.n >= 3 ? 'robotStreak' : hits >= 10 ? 'longRally' : 'robotPoint';
  later(0.35, () => robotSay(moment, !!big, win));
  // At the end of a game the loser is a good sport (it's their "you win" line).
  if (big) later(2.6, () => robotSay(r.match ? 'playerWinsMatch' : 'playerWinsGame', true, lose));
  model(win).celebrate(big ? 'dance' : G.streak.n >= 3 ? 'spin' : 'pump');
  model(lose).celebrate(r.match ? 'slump' : 'droop');
  const name = rival(win).name, loser = rival(lose).name;
  if (r.match) {
    const games = G.match.history.map(s => `${s[win]}–${s[lose]}`).join(', ');
    burst(1);
    sound('fanfare');
    showBanner(`${name} wins!`, games, hex(rival(win).look.accent), 5);
    later(6.5, () => { G.mode = 'menu'; openMenu('watch'); });
    return;
  }
  if (r.game) {
    const g = G.match.history[G.match.history.length - 1];
    showBanner(`Game to ${name}`, `${g[win]}–${g[lose]}`, hex(rival(win).look.accent), 3);
    later(4.5, newPoint);
    return;
  }
  showBanner(`${name}'s point`, `${loser}: ${res.reason.charAt(0).toLowerCase()}${res.reason.slice(1)}`, hex(rival(win).look.accent), 1.9);
  later(2.2, newPoint);
}

// Confetti over the table, from both sides.
function burst(power = 1) {
  confetti.burst({ x: -0.9, y: 1.0, z: 0.4 }, 160, power);
  confetti.burst({ x: 0.9, y: 1.0, z: 0.4 }, 160, power);
  if (G.role === 'host') send({ t: 'confetti', power });
}

// --------------------------------------------------------------- physics --
const evs = [];
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

    const f0 = (i - 1) / n, f1 = i / n;
    if (pose.valid && G.mode !== 'exhibition' && G.now - G.lastHit.P > 0.08) {
      const hit = PH.collidePaddle(b, prevP, pose.substep(f0, f1));
      if (hit) onPaddleHit(P, hit, pose);
    }
    if (G.mode === 'versus' && friendPose.valid && G.now - G.lastHit.O > 0.08) {
      const hit = PH.collidePaddle(b, prevP, friendPose.substep(f0, f1));
      if (hit) onPaddleHit(O, hit, friendPose);
    }
    if (G.mode === 'match' && G.ref && G.ref.due === O && G.ballState !== 'dead') {
      const shot = G.bot.tryHit(b, G.now, { playerX: pose.c.x, incomingSpeed: PH.len(b.v) });
      if (shot) onRobotHit(shot);
    }
    if (G.mode === 'exhibition' && G.ref && G.ballState !== 'dead') {
      // The robot whose turn it is: due to return, or serving its own toss.
      const who = G.ref.due;
      if (who) {
        const [me, them] = who === O ? [G.bot, G.botP] : [G.botP, G.bot];
        const shot = me.tryHit(b, G.now, { playerX: them.pad.x, incomingSpeed: PH.len(b.v) });
        if (shot) onRobotHit(shot, who);
      }
    }
    if (G.ballState !== 'dead') {
      if (Math.abs(b.p.z) > 7 || Math.abs(b.p.x) > 6 || b.p.y < -1) evs.push({ type: 'out' });
      else if (G.now - G.lastEventT > 4) evs.push({ type: 'stall' });
    }
    for (const e of evs) handleEvent(e);
    evs.length = 0;
  }
}

// ------------------------------------------------------------ hosting --
async function startHosting() {
  if (G.net?.link || G.net?.busy) return;
  G.net = { busy: true };
  menu.redraw();
  try {
    const { link, code } = await hostGame({
      data: onGuestData,
      close: reason => friendLeft(reason),
      status: text => { if (G.net) { G.net.error = text; menu.redraw(); } },
    });
    G.net = { link, code, friend: null };
    G.net.beat = setInterval(() => { if (G.net?.friend) link.send({ t: 'hb' }); }, 1000);
  } catch (e) {
    G.net = { error: e.message };
  }
  menu.redraw();
}

function stopHosting() {
  if (G.mode === 'versus') { clearPlay(); G.mode = 'menu'; }
  G.net?.link?.send({ t: 'bye' });
  clearInterval(G.net?.beat);
  G.net?.link?.close();
  G.net = null;
  G.role = 'solo';
  menu.redraw();
}

// The friend leaving: their goodbye, the channel closing, or 6 s of silence.
function friendLeft(reason) {
  if (!G.net?.friend) return;
  const name = G.net.friend.name;
  G.net.friend = null;
  G.role = 'solo';
  if (G.mode === 'versus') { clearPlay(); G.mode = 'menu'; openMenu('friend'); }
  showBanner(`${name} left`, reason, C.bad, 3);
  if (menu.mesh.visible) menu.redraw();
}

function onGuestData(m) {
  if (!m || typeof m !== 'object') return;
  if (G.net) G.net.heard = performance.now();
  if (m.t === 'bye') return friendLeft('They closed the game');
  if (m.t === 'join') {
    const name = String(m.name || 'Player 2').slice(0, 16);
    G.net.friend = { name, assist: ['off', 'light', 'full'].includes(m.assist) ? m.assist : 'light' };
    G.role = 'host';
    send({ t: 'hello', hostName: HOST_NAME, inXR: G.inXR, v: VERSION });
    sendScore();
    showBanner(`${name} joined!`, 'Start the match from the Friend tab', C.good, 3);
    sound('win');
    if (menu.mesh.visible) menu.redraw();
  } else if (m.t === 'in') {
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) friendDesk.aim(m.x, m.y);
  } else if (m.t === 'toss') {
    toss(O);
  }
}

function startVersus() {
  if (!G.net?.friend) return;
  clearPlay();
  G.mode = 'versus';
  W.robot.root.visible = false;
  friendAvatar.root.visible = true; friendDesk.outer.visible = true;
  friendPose.invalidate();
  G.match = new Match({ games: settings.games, firstServer: Math.random() < 0.5 ? P : O });
  closeMenu();
  drawScoreboard();
  sendScore();
  const name = G.net.friend.name;
  showBanner(`You v ${name}`, G.match.server === P ? 'You serve first' : `${name} serves first`, C.accent, 2.4);
  send({ t: 'msg', k: 'start', first: G.match.server });
  later(2.4, newPoint);
}

function matchSnapshot() {
  const m = G.match;
  return m && { score: { ...m.score }, gamesWon: { ...m.gamesWon }, games: m.games, gameNo: m.gameNo, server: m.server, over: m.over, history: m.history };
}
function sendScore() { if (G.role === 'host') send({ t: 'score', m: matchSnapshot(), mode: G.mode }); }

// Stream the state to the guest every other frame.
let sendTick = 0;
const _p = new V3(), _q = new THREE.Quaternion();
function streamState() {
  if (G.role !== 'host') return;
  if (G.net?.friend && performance.now() - (G.net.heard ?? performance.now()) > 6000) return friendLeft('Lost the connection');
  if (!G.net?.link?.connected || ++sendTick % 2) return;
  const b = G.ball;
  const cam = G.inXR ? renderer.xr.getCamera() : null;
  let head;
  if (cam) { cam.getWorldPosition(_p); cam.getWorldQuaternion(_q); head = [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w]; }
  else head = [desk.target.x * 0.5, 1.6, 2.15, 0, 0, 0, 1];
  paddle.group.getWorldPosition(_p); paddle.group.getWorldQuaternion(_q);
  const r = v => Math.round(v * 1000) / 1000;
  send({
    t: 's',
    b: b && G.ballState !== 'none' ? [b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z, b.w.x, b.w.y, b.w.z].map(r) : null,
    bs: G.ballState, due: G.ref?.due ?? null, holder: G.holder,
    hh: head.map(r), hp: [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w].map(r),
    fs: friendDesk.swing, mode: G.mode, paused: G.paused,
  });
}

// --------------------------------------------------------------- GUEST --
// The friend's side: no physics, just draw what the host sends and send back
// where the mouse points.
async function startGuest(code, name, assist, note) {
  sfx.unlock();
  note('Connecting…');
  G.guest = { hostName: HOST_NAME, state: null, recvT: 0, lastSend: 0, name };
  const link = await joinGame(code, {
    data: onHostData,
    close: () => { showBanner('The host left', 'Reload the page to play again', C.bad, 30); G.guest.ended = true; },
  });
  G.net = { link };
  G.role = 'guest';
  G.guest.heard = performance.now();
  window.addEventListener('pagehide', () => link.send({ t: 'bye' }));
  setInterval(() => link.send({ t: 'hb' }), 1000);   // keeps going when the tab is in the background
  G.mode = 'menu';
  G.desk = true;
  link.send({ t: 'join', name, assist });
  // Your end is the far end: turn the view and the boards round.
  resetDeskCamera(); placeBoards();
  scene.remove(desk.outer);
  W.robot.root.visible = false;
  friendDesk.outer.visible = true;
  hostAvatar.root.visible = true; hostPaddle.group.visible = true;
  menu.mesh.visible = false;
  showOverlay(false);
  showTouchHud();
  document.getElementById('guest-hud').hidden = false;
  if (isTouch()) document.querySelector('#guest-hud .keys').textContent = 'Drag to move your paddle · tap Serve when it\'s your serve';
  showBanner('Connected!', 'Waiting for the host to start the match', C.good, 6);
}

function onHostData(m) {
  const gs = G.guest;
  if (!m || typeof m !== 'object' || !gs) return;
  gs.heard = performance.now();
  switch (m.t) {
    case 'hello': gs.hostName = m.hostName || HOST_NAME; drawScoreboard(); break;
    case 'full': showBanner('That game is full', 'Ask your friend for a new code', C.bad, 10); break;
    case 'bye': gs.ended = true; showBanner('The host stopped the game', 'Reload the page to join again', C.bad, 30); break;
    case 's': gs.state = m; gs.recvT = performance.now(); G.mode = m.mode; break;
    case 'score': G.match = m.m; G.mode = m.mode; drawScoreboard(); break;
    case 'sfx': sfx.play(m.k, m.p && { x: m.p[0], y: m.p[1], z: m.p[2] }, m.s); break;
    case 'confetti': confetti.burst({ x: -0.9, y: 1.0, z: -0.4 }, 160, m.power); confetti.burst({ x: 0.9, y: 1.0, z: -0.4 }, 160, m.power); break;
    case 'msg': guestMessage(m); break;
  }
}

// Banners from the guest's point of view (the guest is O).
function guestMessage(m) {
  const host = G.guest.hostName;
  const you = m.winner === O;
  const reason = r => (m.loser === O ? r : `${host}: ${r.charAt(0).toLowerCase()}${r.slice(1)}`);
  switch (m.k) {
    case 'start': showBanner(`You v ${host}`, m.first === O ? 'You serve first' : `${host} serves first`, C.accent, 2.4); break;
    case 'serve': showBanner(m.who === O ? (m.gp === O ? 'Game point' : 'Your serve') : `${host} to serve`, m.who === O ? tossHint() : '', C.accent2, 2.5); break;
    case 'let': showBanner('Let', 'It touched the net, serve again', C.accent2, 1.6); break;
    case 'point': showBanner(you ? 'Your point' : `${host}'s point`, reason(m.reason), you ? C.good : C.bad, 1.9); if (you) W.crowd.cheer(0.5); break;
    case 'game': { const g = m.history[m.history.length - 1]; showBanner(you ? 'Game to you!' : `Game to ${host}`, `${g.O}–${g.P}`, you ? C.good : C.bad, 3); if (you) W.crowd.cheer(1.2); break; }
    case 'match': showBanner(you ? 'You win!' : `${host} wins`, m.history.map(s => `${s.O}–${s.P}`).join(', '), you ? C.good : C.bad, 5); if (you) W.crowd.cheer(2); break;
  }
}

const guestPlane = new THREE.Plane(new V3(0, 0, 1), DESK_Z);   // z = -DESK_Z
function guestFrame(dt) {
  const gs = G.guest, st = gs.state;
  // Your paddle follows your mouse straight away; the host does the hitting.
  raycaster.setFromCamera(desk.mouse, camera);
  const p = new V3();
  if (G.autoplay && st?.b && st.due === O) {
    const [x, y, z, vx, vy, vz, wx, wy, wz] = st.b;
    friendDesk.plan(PH.makeBall({ x, y, z }, { x: vx, y: vy, z: vz }, { x: wx, y: wy, z: wz }), `${st.bs}${Math.sign(vz)}${Math.round(z * 2)}`);
    if (st.bs === 'held' && st.holder === O && performance.now() - (gs.autoToss ?? 0) > 1500) { gs.autoToss = performance.now(); G.net.link.send({ t: 'toss' }); }
  } else if (!G.autoplay && raycaster.ray.intersectPlane(guestPlane, p)) friendDesk.aim(p.x, p.y);
  const now = performance.now();
  if (now - gs.lastSend > 33) { gs.lastSend = now; G.net.link.send({ t: 'in', x: +friendDesk.target.x.toFixed(3), y: +friendDesk.target.y.toFixed(3) }); }
  if (st) friendDesk.swing = st.fs;
  friendDesk.update(0, {});
  // Ball: last known position, carried forward by its velocity.
  if (st?.b) {
    const age = Math.min(0.12, (now - gs.recvT) / 1000);
    const [x, y, z, vx, vy, vz] = st.b;
    const pos = st.bs === 'held' ? { x, y, z } : { x: x + vx * age, y: Math.max(PH.BALL_R, y + vy * age - 4.9 * age * age), z: z + vz * age };
    W.setBall(pos, Math.hypot(vx, vy, vz));
  } else W.setBall(null);
  if (st) {
    const [hx, hy, hz, qx, qy, qz, qw] = st.hh;
    hostPaddle.group.position.set(st.hp[0], st.hp[1], st.hp[2]);
    hostPaddle.group.quaternion.set(st.hp[3], st.hp[4], st.hp[5], st.hp[6]);
    hostAvatar.set({ x: hx, y: hy, z: hz }, new THREE.Quaternion(qx, qy, qz, qw).multiply(FLIP), { x: st.hp[0], y: st.hp[1], z: st.hp[2] });
  }
  // The host streams constantly, so 6 s of silence means they've gone.
  if (!gs.ended && now - (gs.heard ?? now) > 6000) { gs.ended = true; showBanner('Lost the host', 'Reload the page to join again', C.bad, 30); }
  document.getElementById('guest-status').textContent = gs.ended ? 'Disconnected' : st?.paused && G.mode !== 'menu' ? `${gs.hostName} paused the game` : `Playing ${gs.hostName}`;
}

// --------------------------------------------------------------- XR glue --
let baseSpace = null, needRecentre = false;
const tablePose = { x: 0, z: 0, th: 0 };
const RECENTRE_DIST = TB.halfL + 0.6;     // you stand this far from the net

function applyTablePose() {
  const { x, y = 0, z, th } = tablePose;
  const off = new XRRigidTransform({ x, y, z }, { x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) });
  renderer.xr.setReferenceSpace(baseSpace.getOffsetReferenceSpace(off));
}

// Put the table so that you stand at the current spot (G.view, or behind your
// end), facing the way that spot faces. Rotation phi turns table space into the
// room; the table's origin goes wherever leaves your head on the spot.
function recentre(frame) {
  const vp = frame.getViewerPose(baseSpace);
  if (!vp) return false;
  const p = vp.transform.position, o = vp.transform.orientation;
  const f = new V3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
  f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
  f.normalize();
  const spot = G.view ?? { x: 0, z: RECENTRE_DIST, th: 0, lift: 0 };
  const phi = Math.atan2(-f.x, -f.z) - spot.th;
  const c = Math.cos(phi), s = Math.sin(phi);
  tablePose.th = phi;
  tablePose.x = p.x - (spot.x * c + spot.z * s);
  tablePose.z = p.z - (-spot.x * s + spot.z * c);
  tablePose.y = -(spot.lift || 0);
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
  if (c === offCtrl()) toss(P);
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
const deskPlane = new THREE.Plane(new V3(0, 0, 1), -DESK_Z);
// Mouse or finger. With a finger the paddle sits a little above the touch, so
// your finger doesn't hide it.
function aimAt(e) {
  const lift = e.pointerType === 'touch' ? 70 : 0;
  desk.mouse.set(e.clientX / window.innerWidth * 2 - 1, -((e.clientY - lift) / window.innerHeight) * 2 + 1);
}
renderer.domElement.addEventListener('pointermove', aimAt);
renderer.domElement.addEventListener('pointerdown', e => {
  sfx.unlock();
  if (e.pointerType === 'touch' && !menu.mesh.visible) { aimAt(e); return; }
  desk.mouse.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (G.inXR || G.role === 'guest' || !menu.mesh.visible) return;
  raycaster.setFromCamera(desk.mouse, camera);
  const hit = raycaster.intersectObject(menu.mesh, false)[0];
  if (hit) menu.click(hit.uv);
});
window.addEventListener('keydown', e => {
  if (G.inXR || e.target?.tagName === 'INPUT') return;
  if (G.role === 'guest') {
    if (e.code === 'Space') { e.preventDefault(); G.net?.link?.send({ t: 'toss' }); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyM') toggleMenu();
  else if (e.code === 'Space') { e.preventDefault(); toss(P); }
});

function deskUpdate(dt) {
  raycaster.setFromCamera(desk.mouse, camera);
  if (menu.mesh.visible) {
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    menu.hover(hit ? hit.uv : null);
  }
  const p = new V3();
  if (!G.autoplay && raycaster.ray.intersectPlane(deskPlane, p)) desk.aim(p.x, p.y);
  const b = G.ball;
  // Test hook (__sh.autoplay = true): the paddle plays by itself.
  if (G.autoplay && G.ballState === 'held' && G.holder === P && !G.paused) toss(P);
  if (G.autoplay && b && G.ballState === 'live' && G.ref?.due === P) desk.plan(b, `${G.ref.hits}:${G.log.length}:${G.practice?.balls}`);
  desk.update(dt, { ball: b, inPlay: !G.paused && (G.ballState === 'live' || G.ballState === 'toss'), due: G.ref?.due === P, tossed: G.ballState === 'toss' });
}

// ---------------------------------------------------------------- frame --
let lastT = 0;
renderer.setAnimationLoop(onFrame);
const _hp = new V3(), _cq = new THREE.Quaternion();
function onFrame(t, frame, render = true) {
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000) || 1 / 60);
  lastT = t;

  if (G.role === 'guest') {
    guestFrame(dt);
  } else {
    if (G.inXR && frame) {
      if (needRecentre && baseSpace) needRecentre = !recentre(frame);
      pollXR(dt);
    } else if (G.desk) deskUpdate(dt);

    if (G.mode === 'versus') {
      friendDesk.update(G.paused ? 0 : dt, { ball: G.ball, inPlay: !G.paused && (G.ballState === 'live' || G.ballState === 'toss'), due: G.ref?.due === O, tossed: G.ballState === 'toss' });
      friendPose.sample(friendPaddle.centre, dt);
    }
    const holder = paddleRig.parent;
    pose.sample(paddle.centre, dt, !!holder && (G.inXR ? holder.visible : G.desk));
    if (!G.paused) simulate(dt);
    if (G.ballState === 'held' && G.ball) G.ball.p = heldBallPos();

    W.setBall(G.ball ? G.ball.p : null, G.ball ? PH.len(G.ball.v) : 0);
    if (!G.paused) { G.bot.update(dt, G.now); G.botP.update(dt, G.now); }
    if (W.robot.root.visible) W.robot.update(G.bot, G.ball?.p ?? null, dt);
    if (robot2.root.visible) robot2.update(G.botP, G.ball?.p ?? null, dt);
    if (friendAvatar.root.visible) {
      friendPaddle.group.getWorldPosition(_hp);
      const hx = friendDesk.target.x * 0.55;
      const look = G.ball ? Math.atan2(G.ball.p.x - hx, G.ball.p.z + TB.halfL + 0.75) * 0.5 : 0;
      friendAvatar.set({ x: hx, y: 1.6, z: -(TB.halfL + 0.75) }, _cq.setFromAxisAngle(new V3(0, 1, 0), look), _hp);
    }
    streamState();
  }

  // Shared visuals.
  W.crowd.update(dt);
  confetti.update(dt);
  trophy.update(dt);
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
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  // The bubble sits up and to the right of the robot's head (as you look at it).
  cam.getWorldQuaternion(_cq);
  // Push the bubble sideways relative to the viewer, so it clears the head.
  const side = new V3(0.62, 0.22, 0).applyQuaternion(_cq).setY(0.22);
  if (W.robot.root.visible) bubble.update(dt, W.robot.headPos(_hp).add(side), _cq);
  if (robot2.root.visible) bubble2.update(dt, robot2.headPos(_hp).add(side), _cq);

  if (!render) return;
  renderer.render(scene, camera);
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
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const tossHint = () => (G.inXR ? 'Pull the trigger on your free hand to toss' : isTouch() ? 'Tap Serve to toss' : 'Press Space to toss');
function showTouchHud() {
  if (!isTouch()) return;
  document.getElementById('touch-hud').hidden = false;
  document.getElementById('touch-menu').hidden = G.role === 'guest';
}

async function setupButtons() {
  const $ = id => document.getElementById(id);
  const vr = $('btn-vr'), ar = $('btn-ar'), screen = $('btn-screen'), join = $('btn-join');
  const note = $('xr-note');
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
    showTouchHud();
    openMenu();
  };
  if (isTouch()) screen.querySelector('.d').textContent = 'v the robots or the ball machine. Drag to move the paddle, it swings by itself';
  // Buttons for touch screens (no keyboard for Space and Esc).
  $('touch-serve').onclick = () => { sfx.unlock(); if (G.role === 'guest') G.net?.link?.send({ t: 'toss' }); else toss(P); };
  $('touch-menu').onclick = () => { sfx.unlock(); toggleMenu(); };
  // Join a friend: show the little form.
  const form = $('join-form'), codeIn = $('join-code'), nameIn = $('join-name'), assistIn = $('join-assist'), jnote = $('join-note');
  try { nameIn.value = localStorage.getItem('sh_name') || ''; } catch { /* no storage */ }
  join.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) codeIn.focus(); };
  codeIn.oninput = () => { codeIn.value = cleanCode(codeIn.value); };
  form.onsubmit = async e => {
    e.preventDefault();
    const code = cleanCode(codeIn.value);
    if (code.length !== 4) { jnote.textContent = 'The code has 4 letters or numbers.'; return; }
    const name = (nameIn.value.trim() || 'Player 2').slice(0, 16);
    try { localStorage.setItem('sh_name', name); } catch { /* no storage */ }
    form.querySelector('button').disabled = true;
    try { await startGuest(code, name, assistIn.value, t => { jnote.textContent = t; }); }
    catch (err) { jnote.textContent = err.message; form.querySelector('button').disabled = false; }
  };
}
setupButtons();
drawScoreboard();
menu.redraw();
menu.mesh.visible = false;

// Handy for testing from the console.
window.__sh = {
  debugXR: () => ({ needRecentre, tablePose: { ...tablePose }, hasBase: !!baseSpace, custom: renderer.xr.getReferenceSpace() !== baseSpace }),
  G, PH, desk, friendDesk, sfx, advance, settings, stats, W, startMatch, startPractice, startVersus, startHosting, openMenu, closeMenu, toss, pose,
  ctrls, renderer, camera, scene, menu, onMenuClick, enterXR, robotSay, burst, rivalById, startGuest,
};
