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
import { RIVALS, ALL_ROBOTS, QUICK, rivalById, talkLine, TALK_CHANCE, VOICE } from './rivals.js';
import { createConfetti, createBubble, buildTrophy, buildHuman, createGhost, FLIP } from './fx.js';
import { DeskPaddle, BladeTracker, DESK_Z } from './desk.js';
import { hostGame, joinGame, cleanCode } from './net.js';
import { newCup, nextMatch, record as cupRecordResult, quickMatch, youAreOut, involvesYou, involvesFriend, involvesPerson, friendIsOut, YOU, FRIEND, ROUND_NAMES, ROUND_GAMES } from './cup.js';
import { decodeFeel, feelLink } from './share.js';
import { LESSONS, LESSON_BALLS, lessonById, judgeHit, judgeShot, judgeServe, starsFor } from './lessons.js';
import { createGolf } from './golf/game.js';
import { COURSES as GOLF_COURSES, coursePar } from './golf/course.js';
import { GOLF_FORM, simulateRound, CUP_COURSES, GOLF_LADDER, usualRound } from './golf/ai.js';
import { createDarts, DARTS_VIEW, DARTS_WATCH } from './darts/game.js';
import { createBowling, BOWL_VIEW } from './bowling/game.js';
import { BOWL_STYLE } from './bowling/robots.js';
import { BOWL_CUP_FRAMES, BOWL_AVG, quickCupGame } from './bowling/cup.js';
import { SPARES, ROUND_SPARES } from './bowling/practice.js';
import { DART_AVG } from './darts/robots.js';
import { simulateMatch, ROUND_LEGS, CUP_START, DARTS_LADDER } from './darts/cup.js';

export const VERSION = '0.18.1';
const TB = PH.TABLE;
const V3 = THREE.Vector3;

// ------------------------------------------------------------- settings --
const FEEL = { size: PH.PADDLE.radius, bounce: PH.PADDLE.e, grip: PH.PADDLE.mu, power: 1, smooth: 0 };
const DEFAULTS = { hand: 'right', assist: 'light', serve: 'casual', angle: 0, sound: true, level: 'medium', games: 1, pace: 'medium', spin: 'none', place: 'mix', talk: 'beeps', feel: { ...FEEL }, exNear: 'chopper', exFar: 'vortex', sport: 'tt', golfPlayers: 1, golfCourse: 'classic', golfRobot: 'none',
  golfPower: 1, bowlRobot: 'none', bowlPlayers: 1, bowlFrames: 10, bowlBumpers: false, bowlAssist: 'light', bowlPower: 1,
  dartsOpp: 'rookie', dartsGame: 'x01', dartsStart: 301, dartsFinish: 'any', dartsLegs: 3, dartsKPlayers: 4, dartsLives: 3, dartsAssist: 'light', dartsPower: 1, dartsCaller: true,
  watchSpeed: 1 };     // how fast robot games you watch go (1, 2 or 4 times)
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
const stats = load('sh_stats', { wins: {}, losses: {}, bestStreak: 0, ladder: { beaten: [], champion: false }, cups: 0 });
if (!stats.ladder) stats.ladder = { beaten: [], champion: false };
stats.cups ??= 0;
stats.lessons ??= {};     // best stars per lesson
stats.golfBests ??= {};   // best solo round per golf course
if (stats.golfBest && !stats.golfBests.classic) stats.golfBests.classic = stats.golfBest;   // from v0.6
stats.darts = { beaten: [], wins: 0, losses: 0, high: 0, n180: 0, bestOut: 0, atcBest: null, countBest: 0, cWins: 0, cLosses: 0, bestMarks: 0, kWins: 0, kGames: 0, cups: 0, ladder: { beaten: [], champion: false }, ...(stats.darts || {}) };
stats.golfLadder ??= { beaten: [], champion: false };
// The cup in progress (kept between visits).
let cupSaved = null;
try { cupSaved = JSON.parse(localStorage.getItem('sh_cup') || 'null'); } catch { /* none */ }
let dcupSaved = null;     // and the darts cup
try { dcupSaved = JSON.parse(localStorage.getItem('sh_dcup') || 'null'); } catch { /* none */ }
let gcupSaved = null;     // and the mini golf cup
try { gcupSaved = JSON.parse(localStorage.getItem('sh_gcup') || 'null'); } catch { /* none */ }
stats.golfCups ??= 0;
stats.bowling = { games: 0, high: 0, strikes: 0, wins: 0, losses: 0, beaten: [], cups: 0, spares: {}, spareBest: 0, ladder: { beaten: [], champion: false }, ...(stats.bowling || {}) };
let bcupSaved = null;     // and the bowling cup
try { bcupSaved = JSON.parse(localStorage.getItem('sh_bcup') || 'null'); } catch { /* none */ }
function load(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }
const ASSIST = { off: 0, light: 0.55, full: 1 };
const HOST_NAME = 'Player 1';
const NET_TIMEOUT = 20000;   // ms of silence before we decide the other player has gone

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
// Near plane 5 cm (not 2) for more depth precision: the floor markings sit
// millimetres above the floor.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60);
const DESK_CAM = { p: new V3(0, 1.58, 2.55), look: new V3(0, 0.82, -0.7) };
function resetDeskCamera() {
  if (G.mode === 'golf' && golf?.active) { golf.snapCamera(); return; }   // golf has its own camera
  if (G.mode === 'darts' && darts?.active) { darts.snapCamera(); return; }   // so do darts
  if (G.mode === 'bowl' && bowl?.active) { bowl.snapCamera(); return; }      // and bowling
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
  sport: ['golf', 'darts', 'bowl'].includes(settings.sport) ? settings.sport : 'tt',
  mode: 'menu',          // menu | match | practice | versus | exhibition | lesson | golf | darts
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
  cup: cupSaved,         // the cup bracket (cup.js), or null
  cupRef: null,          // { r, i }: the cup match being played or watched
  dcup: dcupSaved,       // the darts cup bracket, or null
  dcupRef: null,         // { r, i, ids (the players in the game's order) }: the darts cup match on now
  gcup: gcupSaved,       // the mini golf cup bracket, or null
  gcupRef: null,         // { r, i, ids }: the golf cup round on now
  bcup: bcupSaved,       // the bowling cup bracket, or null
  bcupRef: null,         // { r, i, ids }: the bowling cup game on now
  dladderRef: null,      // { id }: the darts ladder match on now (and gladderRef, bladderRef)
  gladderRef: null,
  dartsFriend: false,    // playing darts with the friend you're hosting
  bowlFriend: false,     // bowling with them
  shareNote: '',
  view: null,            // where VR puts you (null = behind your end of the table)
  inXR: false,
  mr: false,
  desk: false,
  net: null,             // { link, code, friend: {name, assist} | null, error }
};
resetDeskCamera();

let golf = null;         // the mini golf game (created once the world exists)
let darts = null;        // and darts
let bowl = null;         // and bowling

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
  if (G.role === 'host' && (G.mode === 'versus' || G.golfFriend || G.bowlFriend)) send({ t: 'sfx', k: kind, p: p && [p.x, p.y, p.z], s });
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
  // Mini golf in VR: a putter hangs from the paddle hand's pointer instead.
  // (Whether the game is running, not G.mode: clearPlay calls this after
  // stopping golf or darts but before the mode changes, and the paddle has to
  // come back.)
  // (Watching robots, or your friend's cup game, there's nothing to hold.)
  const watching = onlyWatching();
  const putting = !!golf?.active && !watching && G.inXR && !!pc;
  // Darts in VR: a dart sticks out of the front of the paddle hand's controller
  // (in the Darts menu too).
  const darting = !!((darts?.active && !watching) || darts?.state.preview) && G.inXR && !!pc;
  // The Mini Golf menu: just the controller (a putter would poke through the menu).
  const bare = !!(golf?.state.preview || watching) && G.inXR && !!pc;
  // Bowling in VR: the ball sits under your paddle hand (game and menu).
  const bowling = !!((bowl?.active && !watching) || bowl?.state.preview) && G.inXR && !!pc;
  golf?.putterRig.removeFromParent();
  darts?.handRig.removeFromParent();
  bowl?.handRig.removeFromParent();
  if (putting) { paddleRig.removeFromParent(); pc.ray.add(golf.putterRig); }
  else if (darting) { paddleRig.removeFromParent(); pc.ray.add(darts.handRig); }
  else if (bowling) { paddleRig.removeFromParent(); pc.grip.add(bowl.handRig); }
  else {
    if (G.inXR && pc && !bare) pc.grip.add(paddleRig);
    else if (!G.inXR) desk.inner.add(paddleRig);
    else paddleRig.removeFromParent();
  }
  for (const c of ctrls) c.model.visible = c !== pc || putting || darting || bare || bowling;
  applyAngle();
}
// A golf, darts or bowling game going on with nobody playing on this screen
// (robots, or your friend's cup game): you just watch.
function onlyWatching() {
  if (golf?.active) { const S = golf.state; return !S.players.some((p, i) => p.kind !== 'robot' && (S.me == null || S.me === i)); }
  if (darts?.active) return !darts.state.players?.some(p => p.kind === 'you');
  if (bowl?.active) return !bowl.state.players?.some(p => p.kind === 'you');
  return false;
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
const ghost = createGhost(scene, makePaddle);
// Mini golf, the hall's second sport.
golf = createGolf({
  scene, camera, raycaster, settings, stats, save,
  sfx: { play: (k, p, s) => sound(k, p, s) },      // heard on a friend's screen too
  showBanner: (...a) => showBanner(...a), setView: v => setView(v),
  isXR: () => G.inXR, viewerXZ: () => viewerSpot(),
  haptic: (i, ms) => haptic(paddleCtrl(), i, ms),
  cheer: a => W.crowd.cheer(a),
  confetti: p => confetti.burst(p, 220, 0.9),
  // A robot golfer: the table tennis robot, with a putter (and the exhibition
  // robot too, when you watch two in the cup).
  get robots() { return [W.robot, robot2]; },
  // (A friend's screen hears the robots too: their words come from here.)
  say: (rival, line, model) => {
    G.speaker = model; robotSpeak(rival, line, O);
    if (G.role === 'host' && G.golfFriend) send({ t: 'say', r: rival.id, line, m: [W.robot, robot2].indexOf(model) });
  },
  // Playing with a friend: tell them what happened (they word it for themselves),
  // and send their putts to the host.
  onAnnounce: ev => { if (G.role === 'host' && G.golfFriend) send({ t: 'gev', ev }); },
  remotePutt: (dx, dz, speed) => G.net?.link?.send({ t: 'gputt', dx, dz, speed }),
  roundOver: () => {
    const together = G.golfFriend;
    if (G.golfFriend) { send({ t: 'gend' }); G.golfFriend = false; }
    G.mode = 'menu'; openMenu(G.gcupRef ? 'gcup' : G.gladderRef ? 'gladder' : together ? 'friend' : 'golf');
  },
  // A cup or ladder round is over: record it (returns a banner saying what it
  // means, or one for you and one for your friend).
  onRoundResult: res => (G.gcupRef ? golfCupResult(res) : G.gladderRef ? golfLadderResult(res) : null),
});
// Darts, the third sport: the robot comes down to the oche to throw with you.
const MATCH_GAMES = ['x01', 'cricket', 'killer'];      // the Match tab's games (the rest are practice)
darts = createDarts({
  scene, camera, raycaster, settings, stats, save,
  sfx: { play: (k, p, s) => sfx.play(k, p, s) },
  showBanner: (...a) => showBanner(...a),
  isXR: () => G.inXR,
  // Up to three robots at the oche (Killer): the usual one, the exhibition one and a spare.
  get robots() { return [W.robot, robot2, robot3]; },
  get banner() { return banner.mesh; },     // darts move the message banner about
  say: (rival, line, model) => { G.speaker = model; robotSpeak(rival, line, O); },
  call: text => { if (settings.dartsCaller) sfx.speak(text, { pitch: 0.9, rate: 1.05 }); },
  haptic: (i, ms) => haptic(paddleCtrl(), i, ms),
  cheer: a => W.crowd.cheer(a),
  confetti: p => confetti.burst(p, 220, 0.9),
  lastResult: text => { G.lastResult = text; },
  onOver: tab => {
    if (G.role === 'guest') return;        // the friend waits for the host
    G.mode = 'menu';
    openMenu(G.dcupRef ? 'dcup' : G.dladderRef ? 'dladder' : tab);
  },
  // A match is over: the cup's or ladder's result (with a word on what it means;
  // on a friend's screen, the host's word for them, if it's come).
  onResult: res => {
    if (G.role === 'guest') { const n = G.guest?.dnote ?? null; if (G.guest) G.guest.dnote = null; return n; }
    return G.dcupRef ? dartsCupResult(res) : G.dladderRef ? dartsLadderResult(res) : null;
  },
  // Playing a friend: the host sends every dart; the friend sends where they let go.
  sendDart: d => send({ t: 'dart', ...d }),
  sendThrow: m => G.net?.link?.send({ t: 'dthrow', ...m }),
});
// Bowling, the fourth sport: a lane down the hall; the robot bowls on it too.
bowl = createBowling({
  scene, camera, raycaster, settings, stats, save,
  sfx: { play: (k, p, s) => sound(k, p, s) },      // heard on a friend's screen too
  showBanner: (...a) => showBanner(...a), setView: v => setView(v),
  isXR: () => G.inXR,
  get robots() { return [W.robot, robot2]; },     // (two when you watch a cup game)
  get banner() { return banner.mesh; },
  say: (rival, line, model) => { G.speaker = model; robotSpeak(rival, line, O); },
  haptic: (i, ms) => haptic(paddleCtrl(), i, ms),
  cheer: a => W.crowd.cheer(a),
  confetti: p => confetti.burst(p, 220, 0.9),
  lastResult: text => { G.bowlResult = text; },
  // kind: 'play' | 'cup' | 'ladder' | 'practice' (the friend's screen waits for the host).
  onOver: kind => {
    if (G.role === 'guest') return;
    const together = G.bowlFriend;
    if (G.bowlFriend) { send({ t: 'bend' }); G.bowlFriend = false; }
    G.mode = 'menu';
    openMenu(kind === 'cup' ? 'bcup' : kind === 'ladder' ? 'bladder' : kind === 'practice' ? 'bpractice' : together ? 'friend' : 'bowl');
  },
  // A cup or ladder game is over: record it (returns what it means, worded
  // for you and, playing a friend, for them).
  onResult: res => (G.bcupRef ? bowlCupResult(res) : G.bladderRef ? bowlLadderResult(res) : null),
  // Playing a friend: tell them what happened (they word it for themselves),
  // and send their ball to the host.
  onAnnounce: ev => { if (G.role === 'host' && G.bowlFriend) send({ t: 'bev', ev }); },
  remoteShot: shot => G.net?.link?.send({ t: 'bshot', ...shot }),
});
const bubble = createBubble(scene);
const trophy = buildTrophy();
// Out to the right: clear of every golf hole (the Dog Leg runs out to x 2.2),
// the table, the darts stage, and not behind a scoreboard from your end, the
// oche or the courtside seats.
trophy.root.position.set(3.3, 0, -1.6);
trophy.root.visible = !!stats.ladder.champion || stats.cups > 0 || stats.darts.cups > 0 || stats.golfCups > 0 || stats.bowling.cups > 0
  || stats.bowling.ladder.champion || stats.darts.ladder.champion || stats.golfLadder.champion;
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
// A third robot, only for darts.
const robot3 = W.makeRobot();
robot3.root.visible = false;
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
  robotSpeak(rival, line, who);
}
// The robot the main speech bubble follows (darts can have three at the oche).
const speaker = () => ((darts?.active || golf?.active || bowl?.active) && G.speaker ? G.speaker : W.robot);
// Show a robot's line in its bubble and say it (beeps or a voice).
function robotSpeak(rival, line, who = O) {
  if (settings.talk === 'off') return;
  (who === O ? bubble : bubble2).say(line, hex(rival.look.accent));
  const head = (who === O ? speaker() : robot2).headPos(new V3());
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
  // Watching from the courtside seat: both across the table, facing the seat.
  if (G.mode === 'exhibition') {
    scoreboard.mesh.position.set(-1.7, 1.75, 0);
    scoreboard.mesh.rotation.set(0, Math.PI / 2, 0);
    scoreboard.mesh.scale.setScalar(1.3);
    banner.mesh.position.set(-1.7, 2.62, 0);
    banner.mesh.rotation.set(0, Math.PI / 2, 0);
    banner.mesh.scale.setScalar(1.3);
    return;
  }
  scoreboard.mesh.scale.setScalar(1); banner.mesh.scale.setScalar(1);
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
  // Long lines shrink to fit inside the rounded edge rather than run off it.
  const fit = (text, weight, size) => {
    g.font = `${weight} ${size}px ${FONT}`;
    const over = g.measureText(text).width / (w - 110);
    if (over > 1) g.font = `${weight} ${Math.floor(size / over)}px ${FONT}`;
  };
  g.fillStyle = '#fff'; fit(title, 800, sub ? 92 : 110);
  g.fillText(title, w / 2, sub ? h / 2 - 40 : h / 2);
  if (sub) { g.fillStyle = '#c9d6f2'; fit(sub, 500, sub.length > 34 ? 46 : 56); g.fillText(sub, w / 2, h / 2 + 62); }
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
  if (G.mode === 'lesson' && G.lesson) {
    const L = G.lesson;
    g.fillStyle = C.accent; g.font = `800 44px ${FONT}`; g.textAlign = 'left';
    g.fillText(`LESSON · ${L.def.name.toUpperCase()}`, 50, 68);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`;
    g.fillText(L.done ? `Done: ${L.good} of ${LESSON_BALLS} good` : `${L.def.serve ? 'Serve' : 'Ball'} ${Math.min(L.n + 1, LESSON_BALLS)} of ${LESSON_BALLS}  ·  good ${L.good}`, 50, 140);
    g.textAlign = 'right'; g.fillStyle = '#d4af37'; g.font = `800 44px ${FONT}`;
    const st = starsFor(L.good);
    g.fillText('★'.repeat(st) + '☆'.repeat(3 - st), w - 50, 140);
    g.textAlign = 'left'; g.font = `600 38px ${FONT}`;
    g.fillStyle = L.tipGood === true ? '#7dffa8' : L.tipGood === false ? '#ffb4a8' : '#dfe8ff';
    wrapText(g, L.tip, w - 100).slice(0, 5).forEach((line, i) => g.fillText(line, 50, 215 + i * 50));
    g.fillStyle = C.dim; g.font = `500 28px ${FONT}`;
    g.fillText(G.inXR ? 'Free hand trigger: show the stroke again' : 'D: show the stroke again', 50, h - 34);
  } else if (G.mode === 'practice' && G.practice) {
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
  const golfing = G.sport === 'golf', darting = G.sport === 'darts', bowling = G.sport === 'bowl';
  ui.text('SPORTS HALL', 60, 74, { size: 32, weight: 800, color: C.accent });
  ui.text(golfing ? 'Mini Golf' : darting ? 'Darts' : bowling ? 'Bowling' : 'Table Tennis', 60, 128, { size: 52, weight: 800 });
  // Which sport: the big switches at the top right.
  [['tt', 'Table Tennis'], ['golf', 'Mini Golf'], ['darts', 'Darts'], ['bowl', 'Bowling']].forEach(([id, name], i) =>
    ui.button(`sport:${id}`, w - 60 - (4 - i) * 206 + 14, 36, 194, 70, name, { selected: G.sport === id, size: 28 }));
  const gc = GOLF_COURSES[settings.golfCourse] ?? GOLF_COURSES.classic;
  const D = stats.darts;
  const honours = golfing
    ? [stats.golfLadder.champion && '★ Champion', stats.golfCups && `🏆 ${stats.golfCups} cup${stats.golfCups > 1 ? 's' : ''}`, stats.golfBests[gc.id] && `${gc.name} best: ${stats.golfBests[gc.id]} (par ${coursePar(gc.holes)})`].filter(Boolean).join('   ')
    : darting ? [D.ladder.champion && '★ Champion', D.cups && `🏆 ${D.cups} cup${D.cups > 1 ? 's' : ''}`, D.beaten.length && `🎯 ${D.beaten.length}/${RIVALS.length} robots beaten`, D.n180 && `${D.n180} × 180`].filter(Boolean).join('   ')
    : bowling ? [stats.bowling.ladder.champion && '★ Champion', stats.bowling.cups && `🏆 ${stats.bowling.cups} cup${stats.bowling.cups > 1 ? 's' : ''}`, stats.bowling.high && `High game ${stats.bowling.high}`, stats.bowling.beaten.length && `🎳 ${stats.bowling.beaten.length}/${RIVALS.length} robots beaten`].filter(Boolean).join('   ')
      : [stats.ladder.champion && '★ Ladder champion', stats.cups && `🏆 ${stats.cups} cup${stats.cups > 1 ? 's' : ''}`].filter(Boolean).join('   ');
  if (honours) ui.text(honours, w - 60, 140, { size: 30, weight: 800, color: '#d4af37', align: 'right' });
  const tabs = golfing ? [['golf', 'Play'], ['gladder', 'Ladder'], ['gcup', 'Cup'], ['friend', 'Friend'], ['gsettings', 'Settings']]
    : darting ? [['darts', 'Match'], ['dladder', 'Ladder'], ['dcup', 'Cup'], ['dpractice', 'Practice'], ['friend', 'Friend'], ['dsettings', 'Settings']]
    : bowling ? [['bowl', 'Play'], ['bladder', 'Ladder'], ['bcup', 'Cup'], ['bpractice', 'Practice'], ['friend', 'Friend'], ['bsettings', 'Settings']]
      : [['match', 'Match'], ['ladder', 'Ladder'], ['cup', 'Cup'], ['practice', 'Practice'], ['friend', 'Friend'], ['settings', 'Settings']];
  const tw = (w - 120 - (tabs.length - 1) * 14) / tabs.length;
  const parentTab = { watch: 'match', feel: 'settings', share: 'settings', lessons: 'practice' }[G.tab] ?? G.tab;
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
    ui.options('games', L, 666, width / 2 - 20, 84, [[1, '1 game'], [3, 'Best of 3'], [5, 'Best of 5']], settings.games);
    speedOptions(ui, L + width / 2 + 20, 650, width / 2 - 20);
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
  } else if (G.tab === 'golf') {
    label('Course', 292);
    ui.options('golfCourse', L, 308, width, 100, Object.values(GOLF_COURSES).map(c => [c.id, c.name, `par ${coursePar(c.holes)} · ${c.id === 'trick' ? 'loops, jumps, water' : 'a gentle six'}`]), gc.id);
    dim(gc.holes.map(h => h.name).join(' · '), 452);
    dim(G.inXR ? 'Point your paddle hand at the floor: that\'s your putter. Free hand trigger: go to your ball.'
      : isTouch() ? 'Drag back from the ball and let go to putt: the further you drag, the harder it goes.'
        : 'Drag back from the ball with the mouse and let go to putt: further = harder.', 492);
    label('Players (take turns)', 540);
    ui.options('golfPlayers', L, 556, width, 76, [[1, '1 player'], [2, '2 players'], [3, '3 players'], [4, '4 players']], settings.golfPlayers);
    // A robot to play against (it putts after you on each hole).
    const GR = stats.golfRobots ?? { wins: 0, losses: 0, beaten: [] };
    label('Play against a robot', 668);
    ui.options('golfRobot', L, 684, width, 92, [['none', 'No robot', 'just you'], ...RIVALS.map(r => [r.id, r.name, GR.beaten.includes(r.id) ? '✓ beaten' : GOLF_FORM[r.id]])], settings.golfRobot, 10);
    const best = stats.golfBests[gc.id], par = coursePar(gc.holes);
    const vs = RIVALS.find(r => r.id === settings.golfRobot);
    ui.text(best ? `Your best on ${gc.name}: ${best} (${best === par ? 'level par' : best < par ? `${par - best} under` : `${best - par} over`})` : `No rounds on ${gc.name} yet. Par is ${par}.`, L, 818, { size: 30, weight: 800, color: best ? '#d4af37' : C.text });
    if (GR.wins + GR.losses) ui.text(`v robots: won ${GR.wins}, lost ${GR.losses}`, R, 818, { size: 28, weight: 600, color: C.dim, align: 'right' });
    const play = vs ? `Play ${gc.name} v ${vs.name}` : `Play ${gc.name}`;
    if (G.mode === 'golf' && golf.inProgress()) {
      ui.button('resume', L, 852, width / 2 - 10, 112, 'Resume', { primary: true, size: 46 });
      ui.button('golf:start', L + width / 2 + 10, 852, width / 2 - 10, 112, 'New round', { size: 40 });
    } else ui.button('golf:start', L, 852, width, 112, play, { primary: true, size: 46 });
  } else if (G.tab === 'bowl') {
    const B = stats.bowling;
    label('Play against a robot', 292);
    ui.options('bowlRobot', L, 308, width, 100, [['none', 'No robot', 'just you'], ...RIVALS.map(r => [r.id, r.name, B.beaten.includes(r.id) ? '✓ beaten' : BOWL_STYLE[r.id]])], settings.bowlRobot, 10);
    const half = width / 2 - 20, right = L + width / 2 + 20;
    label('People (take turns)', 460);
    ui.options('bowlPlayers', L, 476, half, 84, [[1, '1'], [2, '2'], [3, '3'], [4, '4']], settings.bowlPlayers);
    ui.text('Game', right, 460, { size: 32, weight: 650, color: C.dim });
    ui.options('bowlFrames', right, 476, half, 84, [[10, '10 frames', 'a full game'], [5, '5 frames', 'a quick one']], settings.bowlFrames);
    label('Bumpers', 600);
    ui.options('bowlBumpers', L, 616, half, 84, [['false', 'Off', 'gutters'], ['true', 'On', 'no gutter balls']], String(!!settings.bowlBumpers));
    dim(G.inXR ? 'Hold the trigger, swing your arm and let go. Twist your wrist as you let go to hook it.'
      : isTouch() ? 'Slide to where you stand, then drag up the screen and lift your finger. Curve it to hook.'
        : 'Move the mouse along the line, then press, drag up and let go. Curve the drag to hook it.', 750, 28);
    ui.text(B.games ? `High game ${B.high} · ${B.games} game${B.games > 1 ? 's' : ''} · v robots won ${B.wins}, lost ${B.losses}` : 'No games yet: a beginner scores about 80, a good bowler 180.', L, 806, { size: 30, weight: 700, color: B.high ? '#d4af37' : C.text });
    if (G.bowlResult) ui.text(G.bowlResult, R, 806, { size: 26, weight: 600, color: C.dim, align: 'right' });
    const vs = RIVALS.find(r => r.id === settings.bowlRobot);
    if (G.mode === 'bowl' && bowl.inProgress()) {
      ui.button('resume', L, 852, width / 2 - 10, 112, 'Resume', { primary: true, size: 46 });
      ui.button('bowl:play', L + width / 2 + 10, 852, width / 2 - 10, 112, 'New game', { size: 40 });
    } else ui.button('bowl:play', L, 852, width, 112, vs ? `Bowl v ${vs.name}` : 'Bowl', { primary: true, size: 48 });
  } else if (G.tab === 'bsettings') {
    handAndSound(ui, L, width, 'Ball hand');
    label('Aim help', 446);
    ui.options('bowlAssist', L, 462, width, 96, [['off', 'Off', 'all you'], ['light', 'Light', 'nudges a near miss'], ['full', 'Full', 'pulls it to the pocket']], settings.bowlAssist);
    powerAndTalk(ui, L, width, 'bpower', settings.bowlPower ?? 1, 'Balls crawling? Turn it up. Flying? Down.');
    const log = bowl.log.slice(-3).reverse();
    label('Your last balls (for tuning)', 790);
    if (!log.length) dim('Bowl a few and they show here: speed, spin and aim help.', 836, 28);
    log.forEach((l, i) => dim(`${(l.speed).toFixed(1)} m/s · ${l.spin > 0.15 ? 'hook' : l.spin < -0.15 ? 'back-up' : 'straight'} (${l.spin.toFixed(2)}) · aim help ${Math.round(l.moved * 100)} cm`, 836 + i * 40, 27));
    vrButtons(ui, L, width);
  } else if (G.tab === 'gsettings') {
    // Mini golf's own settings: the putter hand, and putt power for tuning on a headset.
    handAndSound(ui, L, width, 'Putter hand');
    powerAndTalk(ui, L, width, 'gpower', settings.golfPower ?? 1, 'Putts coming up short? Turn it up.', 446);
    const log = golf.log.slice(-4).reverse();
    label('Your last putts (for tuning)', 640);
    if (!log.length) dim(G.inXR ? 'Putt a few and they show here: how hard you swung and how fast the ball went.' : 'In VR, your putts show here (for tuning the power).', 686, 28);
    log.forEach((l, i) => dim(`Putter ${l.swing.toFixed(2)} m/s → ball ${l.speed.toFixed(2)} m/s${l.result ? ` · ${l.result}` : ''}`, 686 + i * 40, 27));
    vrButtons(ui, L, width);
  } else if (G.tab === 'bladder') {
    // The bowling ladder: like table tennis's, a game against each robot in turn.
    const on = G.mode === 'bowl' && G.bladderRef && bowl.inProgress();
    renderLadder(ui, L, R, width, dim, {
      key: 'bladder', lad: stats.bowling.ladder, current: on ? G.bladderRef.id : null,
      intro: 'Beat each robot to face the next; a tie goes to a roll-off. Beat Omega to be champion.',
      champ: 'You beat them all: bowling champion! Bowl any of them again.',
      detail: (r, i) => `${BOWL_LADDER_FRAMES[i]} frames · ${BOWL_STYLE[r.id]} · averages about ${BOWL_AVG[r.id]} a game`,
    });
    if (on) ui.button('resume', L, 950, width, 64, 'Resume the game', { primary: true, size: 32 });
  } else if (G.tab === 'dladder') {
    // The darts ladder: a match against each robot in turn, longer as they get better.
    const on = G.mode === 'darts' && G.dladderRef && darts.inProgress(), fin = settings.dartsFinish === 'double';
    renderLadder(ui, L, R, width, dim, {
      key: 'dladder', lad: D.ladder, current: on ? G.dladderRef.id : null,
      intro: `Beat each robot to face the next. Beat Omega to be champion. Finish: ${fin ? 'double out' : 'any finish'} (Match tab).`,
      champ: 'You beat them all: darts champion! Play any of them again.',
      detail: (r, i) => { const f = DARTS_LADDER[i]; return `${f.start} · ${f.legs === 1 ? 'one leg' : `best of ${f.legs} legs`} · averages ${DART_AVG[r.id]}`; },
    });
    if (on) ui.button('resume', L, 950, width, 64, 'Resume the match', { primary: true, size: 32 });
  } else if (G.tab === 'gladder') {
    // The mini golf ladder: a round against each robot, the last three on Trickshot.
    const on = G.mode === 'golf' && G.gladderRef && golf.inProgress();
    renderLadder(ui, L, R, width, dim, {
      key: 'gladder', lad: stats.golfLadder, current: on ? G.gladderRef.id : null,
      intro: 'Beat each robot to face the next; a tie goes to sudden death. Beat Omega to be champion.',
      champ: 'You beat them all: mini golf champion! Play any of them again.',
      detail: (r, i) => { const c = GOLF_COURSES[GOLF_LADDER[i]]; return `${c.name} (par ${coursePar(c.holes)}) · ${GOLF_FORM[r.id]} · usually goes round in about ${usualRound(r.id, c.holes)}`; },
    });
    if (on) ui.button('resume', L, 950, width, 64, 'Resume the round', { primary: true, size: 32 });
  } else if (G.tab === 'bpractice') {
    // Spare practice: a round of ten, or one leave over and over.
    const B = stats.bowling, P = G.mode === 'bowl' && bowl.inProgress() ? bowl.state.practice : null, g = ui.g;
    roundRect(g, L, 296, width, 150, 24);
    g.fillStyle = P?.round ? '#17284a' : '#1b2438'; g.fill();
    ui.text('Spare round', L + 34, 354, { size: 42, weight: 800 });
    ui.text(`${ROUND_SPARES} spares, one ball at each: the common ones come up most.`, L + 34, 404, { size: 27, weight: 500, color: C.dim });
    if (B.spareBest) ui.text(`Best: ${B.spareBest} of ${ROUND_SPARES}`, R - 290, 354, { size: 32, weight: 800, color: '#d4af37', align: 'right' });
    ui.button('bprac:round', R - 250, 332, 220, 78, 'Start', { primary: true, size: 36 });
    label('Or practise one spare, as many times as you like', 500);
    const rows = [SPARES.slice(0, 4), SPARES.slice(4, 8)];
    const cur = P && !P.round ? P.list[0] : null;
    rows.forEach((row, k) => ui.options('bprac', L, 520 + k * 150, width, 130, row.map(s => {
      const r = B.spares[s.id];
      return [s.id, s.name, r?.tried ? `made ${r.made} of ${r.tried}` : 'not tried yet'];
    }), cur));
    dim('Each spare\'s tip shows as it comes up. Aim help (Settings) nudges a near miss towards the pins left.', 850, 27);
    if (P) ui.button('resume', L, 890, width, 96, 'Resume', { primary: true, size: 42 });
  } else if (G.tab === 'bcup') {
    renderCup(ui, L, R, width, dim, 'bowl');
  } else if (G.tab === 'darts') {
    label('Opponent', 298);
    ui.options('dartsOpp', L, 316, width, 112, [...RIVALS.map(r => [r.id, r.name, D.beaten.includes(r.id) ? '✓ beaten' : `averages ${DART_AVG[r.id]}`]), ['local', '2 players', 'take turns']], settings.dartsOpp, 10);
    label('Game', 482);
    const game = settings.dartsGame, local = settings.dartsOpp === 'local', half = width / 2 - 20, right = L + width / 2 + 20;
    ui.options('dartsGame', L, 498, width, 96, [[301, '301', 'quicker'], [501, '501', 'the classic'], ['cricket', 'Cricket', 'close 15–20 and the bull'], ['killer', 'Killer', 'last one standing']], game === 'x01' ? settings.dartsStart : game);
    const legs = (x, y, w) => ui.options('dartsLegs', x, y, w, 84, [[1, '1 leg'], [3, 'Best of 3'], [5, 'Best of 5']], settings.dartsLegs);
    const killers = !local && game === 'killer' ? killerField(settings.dartsOpp, settings.dartsKPlayers - 1) : [];
    if (game === 'x01') {
      label('Finish', 640);
      ui.options('dartsFinish', L, 656, half, 84, [['any', 'Any finish', 'hit the exact score'], ['double', 'Double out', 'end on a double']], settings.dartsFinish);
      ui.text('Match length', right, 640, { size: 32, weight: 650, color: C.dim });
      legs(right, 656, half);
      dim(`Won ${D.wins}, lost ${D.losses}  ·  highest visit ${D.high || '–'}  ·  best checkout ${D.bestOut || '–'}  ·  180s ${D.n180}`, 790);
    } else if (game === 'cricket') {
      label('Match length', 640);
      legs(L, 656, half);
      ui.text('Three marks close a number (a double is two, a treble', right, 684, { size: 25, weight: 500, color: C.dim });
      ui.text('three), then it scores for you till they close it too.', right, 718, { size: 25, weight: 500, color: C.dim });
      dim(`Cricket: won ${D.cWins}, lost ${D.cLosses}  ·  best visit ${D.bestMarks ? `${D.bestMarks} marks` : '–'}`, 790);
    } else {
      label(local ? 'Players (take turns)' : 'Players (you and robots)', 640);
      ui.options('dartsKPlayers', L, 656, half, 84, [[2, '2'], [3, '3'], [4, '4']], settings.dartsKPlayers);
      ui.text('Lives', right, 640, { size: 32, weight: 650, color: C.dim });
      ui.options('dartsLives', right, 656, half, 84, [[3, '3 lives'], [5, '5 lives']], settings.dartsLives);
      dim(local ? 'Hit your number 3 times to be a killer, then hit the others\' numbers. Your own costs a life.'
        : `You v ${killers.map(r => r.name).join(', ')}  ·  Killer wins ${D.kWins} of ${D.kGames}`, 790);
    }
    if (G.lastResult && G.sport === 'darts') ui.text(G.lastResult, L, 836, { size: 32, weight: 700, color: G.lastResult.startsWith('You beat') ? C.good : C.text });
    const play = game === 'killer' ? (local ? `Play Killer (${settings.dartsKPlayers} players)` : 'Play Killer')
      : local ? 'Play (take turns)' : `Play ${rivalById(settings.dartsOpp).name}${game === 'cricket' ? ' at cricket' : ''}`;
    if (G.mode === 'darts' && darts.inProgress() && MATCH_GAMES.includes(darts.state.mode)) {
      ui.button('resume', L, 866, width / 2 - 10, 116, 'Resume', { primary: true, size: 48 });
      ui.button('darts:play', L + width / 2 + 10, 866, width / 2 - 10, 116, 'New match', { size: 42 });
    } else ui.button('darts:play', L, 866, width, 116, play, { primary: true, size: 50 });
  } else if (G.tab === 'dpractice') {
    const rows = [
      ['atc', 'Around the Clock', 'Hit 1, then 2, then 3, all the way to 20, then the bull. Fewest darts wins.', D.atcBest ? `Best: ${D.atcBest} darts` : ''],
      ['count', 'Count-up', 'Eight visits of three darts. Score as much as you can.', D.countBest ? `Best: ${D.countBest}` : ''],
      ['free', 'Free throw', 'No rules: just throw. Every dart\'s score pops up beside it.', ''],
    ];
    rows.forEach(([id, name, blurb, best], i) => {
      const y = 296 + i * 170, g = ui.g;
      roundRect(g, L, y, width, 150, 24);
      g.fillStyle = G.mode === 'darts' && darts.state.mode === id ? '#17284a' : '#1b2438'; g.fill();
      ui.text(name, L + 34, y + 58, { size: 42, weight: 800 });
      ui.text(blurb, L + 34, y + 108, { size: 27, weight: 500, color: C.dim });
      if (best) ui.text(best, R - 290, y + 58, { size: 32, weight: 800, color: '#d4af37', align: 'right' });
      ui.button(`darts:${id}`, R - 250, y + 36, 220, 78, 'Start', { primary: true, size: 36 });
    });
    if (G.mode === 'darts' && darts.inProgress() && !MATCH_GAMES.includes(darts.state.mode)) ui.button('resume', L, 830, width, 100, 'Resume', { primary: true, size: 46 });
  } else if (G.tab === 'dsettings') {
    label('Throwing hand', 298);
    ui.options('hand', L, 314, width / 2 - 20, 84, [['right', 'Right'], ['left', 'Left']], settings.hand);
    ui.text('Sound', L + width / 2 + 20, 298, { size: 32, weight: 650, color: C.dim });
    ui.options('sound', L + width / 2 + 20, 314, width / 2 - 20, 84, [[true, 'On'], [false, 'Off']], settings.sound);
    label('Aim help', 446);
    ui.options('dartsAssist', L, 462, width, 96, G.inXR
      ? [['off', 'Off', 'real throws'], ['light', 'Light', 'nudges near misses'], ['full', 'Full', 'bigger nudge + an aim dot']]
      : [['off', 'Off', 'a shaky hand'], ['light', 'Light', 'a steadier aim'], ['full', 'Full', 'rock steady']], settings.dartsAssist);
    label('Throw power', 600);
    ui.button('dpower:-', L, 616, 110, 84, '–', { size: 52 });
    ui.text(`${Math.round(settings.dartsPower * 100)}%`, L + 205, 660, { size: 44, weight: 800, align: 'center', base: 'middle', color: settings.dartsPower !== 1 ? '#ffd23f' : '#fff' });
    ui.button('dpower:+', L + 300, 616, 110, 84, '+', { size: 52 });
    ui.text('Darts landing low? Turn it up.', L, 736, { size: 25, weight: 500, color: C.dim });
    ui.text('Caller', L + width / 2 + 20, 600, { size: 32, weight: 650, color: C.dim });
    ui.options('dartsCaller', L + width / 2 + 20, 616, width / 2 - 20, 84, [[true, 'On', '"One hundred and eighty!"'], [false, 'Off']], settings.dartsCaller);
    label('Robot talk', 790);
    ui.options('talk', L, 806, width, 76, [['off', 'Off'], ['bubbles', 'Bubbles'], ['beeps', 'Beeps'], ['voice', 'Voice']], settings.talk);
    // Your last throws in VR, for tuning the power on a real headset.
    const log = darts.log.slice(-2).reverse();
    log.forEach((t, i) => ui.text(`Throw ${t.speed.toFixed(1)} m/s${t.moved > 0.005 ? ` · aim help moved it ${Math.round(t.moved * 100)} cm` : ''}${t.result ? ` · ${t.result}` : ''}`, L, 916 + i * 34, { size: 25, weight: 500, color: C.text }));
    if (G.inXR) {
      ui.button('recentre', L + width - 640, 900, 300, 70, 'Recentre', { size: 32 });
      ui.button('exit', L + width - 320, 900, 320, 70, G.mr ? 'Exit mixed reality' : 'Exit VR', { size: 32 });
    }
  } else if (G.tab === 'cup' || G.tab === 'dcup' || G.tab === 'gcup') {
    renderCup(ui, L, R, width, dim, { cup: 'tt', dcup: 'darts', gcup: 'golf' }[G.tab]);
  } else if (G.tab === 'share') {
    renderShare(ui, L, R, width, dim);
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
    const earned = LESSONS.reduce((n, l) => n + (stats.lessons[l.id] ?? 0), 0);
    ui.button('tab:lessons', L, 936, width, 72, `Stroke lessons: forehand, backhand, topspin, push, serve   ★ ${earned}/${LESSONS.length * 3}`, { size: 30 });
  } else if (G.tab === 'lessons') {
    dim('Learn the strokes one at a time. A ghost paddle shows you how, then the ball machine', 292);
    dim(`feeds you ${LESSON_BALLS} balls and tells you what to fix. Up to three stars each.`, 332);
    LESSONS.forEach((l, i) => {
      const y = 360 + i * 104, best = stats.lessons[l.id] ?? 0, g = ui.g;
      roundRect(g, L, y, width, 92, 22);
      g.fillStyle = G.lesson?.def.id === l.id && G.mode === 'lesson' ? '#17284a' : '#1b2438'; g.fill();
      ui.text(l.name, L + 30, y + 40, { size: 38, weight: 800 });
      ui.text(l.blurb, L + 30, y + 76, { size: 26, weight: 500, color: C.dim });
      ui.text('★'.repeat(best) + '☆'.repeat(3 - best), R - 290, y + 50, { size: 44, weight: 800, color: best ? '#d4af37' : '#55627e', align: 'right', base: 'middle' });
      ui.button(`lesson:${l.id}`, R - 250, y + 12, 230, 68, best ? 'Again' : 'Start', { primary: !best, size: 32 });
    });
    if (G.mode === 'lesson') {
      ui.button('resume', L, 900, width / 2 - 10, 90, 'Resume lesson', { primary: true, size: 38 });
      ui.button('lesson:demo', L + width / 2 + 10, 900, width / 2 - 10, 90, 'Show me the stroke', { size: 36 });
    } else ui.button('tab:practice', L, 920, 300, 70, '‹ Back', { size: 30 });
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
      const golfing = G.sport === 'golf';
      const gcName = (GOLF_COURSES[settings.golfCourse] ?? GOLF_COURSES.classic).name;
      const what = golfing ? `Mini golf: the ${gcName} course, taking turns (set on the Play tab)`
        : darting ? `Darts: ${dartsGameName()}${friendRobotsText()} (set on the Match tab)`
          : bowling ? `Bowling: ${settings.bowlFrames} frames${RIVALS.find(r => r.id === settings.bowlRobot) ? `, with ${rivalById(settings.bowlRobot).name}` : ''}${settings.bowlBumpers ? ', bumpers up' : ''} (set on the Play tab)`
            : `Match length: ${settings.games === 1 ? '1 game' : `best of ${settings.games}`} (set on the Match tab)`;
      ui.text(what, w / 2, 715, { size: 28, weight: 500, color: C.dim, align: 'center' });
      const inVersus = (G.mode === 'versus' && G.match && !G.match.over) || (G.mode === 'golf' && G.golfFriend && golf.inProgress()) || (G.mode === 'darts' && G.dartsFriend && darts.inProgress()) || (G.mode === 'bowl' && G.bowlFriend && bowl.inProgress());
      if (inVersus) ui.button('resume', L, 760, width / 2 - 10, 110, 'Resume', { primary: true, size: 46 });
      else ui.button(golfing ? 'golfversus' : darting ? 'dartsversus' : bowling ? 'bowlversus' : 'versus', L, 760, width / 2 - 10, 110, golfing ? 'Start a round together' : darting ? 'Start darts together' : bowling ? 'Bowl together' : 'Start match', { primary: !!n.friend, disabled: !n.friend, size: golfing || darting ? 38 : 44 });
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
      const y = 316 + i * 88, v = settings.feel[key];
      ui.text(s.label, L, y + 38, { size: 36, weight: 750 });
      ui.text(s.hint, L, y + 72, { size: 25, weight: 500, color: C.dim });
      ui.button(`feel:${key}:-`, R - 470, y + 4, 100, 76, '–', { size: 50 });
      ui.text(s.show(v), R - 235, y + 44, { size: 40, weight: 800, align: 'center', base: 'middle', color: Math.abs(v - FEEL[key]) > 1e-6 ? '#ffd23f' : '#fff' });
      ui.button(`feel:${key}:+`, R - 100, y + 4, 100, 76, '+', { size: 50 });
    });
    // Your last few hits, to see what the paddle is doing.
    const log = G.hitLog;
    ui.text('Your last hits', L, 808, { size: 30, weight: 700, color: C.dim });
    if (!log.length) dim('Play a few shots and they show up here.', 852, 28);
    log.slice(-2).reverse().forEach((h, i) => {
      ui.text(`Swing ${h.pad.toFixed(1)} m/s → ball ${Math.round(h.out * 3.6)} km/h · ${h.rpm} rpm${h.assisted ? ' · assist helped' : ''}${h.result ? ` · ${h.result}` : ''}`, L, 852 + i * 38, { size: 26, weight: 500, color: h.result === 'landed' ? C.good : h.result ? '#ffb4a8' : C.text });
    });
    ui.button('feel:share', R - 840, 930, 300, 70, 'Share these…', { size: 30 });
    ui.button('feel:reset', R - 520, 930, 250, 70, 'Reset all', { size: 30 });
    ui.button('tab:settings', R - 250, 930, 250, 70, '‹ Back', { size: 30 });
  }
  const help = darting
    ? (G.inXR ? 'Throwing hand: hold the trigger (or grip), throw, let go · X/Y = menu · click stick = recentre'
      : isTouch() ? 'Touch the board to aim, hold still, lift your finger to throw'
        : 'Point at the board, press and hold until it\'s steady, let go to throw · Esc = menu')
    : bowling ? (G.inXR ? 'Ball hand: hold the trigger (or grip), swing, let go · twist to hook · X/Y = menu · click stick = recentre'
      : isTouch() ? 'Slide to your spot, drag up the screen and lift your finger · curve it to hook'
        : 'Move along the line, press, drag up and let go · curve the drag to hook · Esc = menu')
    : golfing ? (G.inXR ? 'Swing the putter · free hand trigger: go to your ball · X/Y = menu · click stick = recentre'
      : 'Drag back from the ball and let go to putt · Esc = menu')
    : G.inXR
    ? 'Free hand: trigger = toss the ball · X/Y = menu · stick = move · click stick = recentre   |   point + trigger = click'
    : isTouch() ? 'Drag = move the paddle (it swings by itself) · Serve and Menu buttons are at the bottom'
      : 'Mouse = move the paddle (it swings by itself) · Space = toss · Esc = menu';
  ui.text(help, w / 2, 1046, { size: 27, weight: 500, color: C.dim, align: 'center' });
  ui.text(`v${VERSION}`, w - 40, 1080, { size: 22, weight: 500, color: '#55627e', align: 'right' });
}

// ------------------------------------------------------------------ cup --
// (FRIEND: the friend in a cup you're playing together: their name is kept with
// the cup, by default the cup of the sport on show.)
const sportCup = () => ({ golf: G.gcup, darts: G.dcup, bowl: G.bcup })[G.sport] ?? null;
const entrantName = (id, cup = sportCup()) => (id === YOU ? 'You' : id === FRIEND ? cup?.friend ?? 'Your friend' : rivalById(id).name);
const entrantColour = id => (id === YOU ? '#7fd1ff' : id === FRIEND ? '#ffae6b' : hex(rivalById(id).look.accent));
// A cup game's people (you first) and robots, as the game puts them in turn order.
const isPerson = id => id === YOU || id === FRIEND;
function cupSides(m) {
  const ids = [m.a, m.b], people = ids.filter(isPerson).sort((a, b) => (a === YOU ? -1 : b === YOU ? 1 : 0));
  return { people, bots: ids.filter(id => !isPerson(id)) };
}
// Playing a cup game together (your friend connected): the people's names as
// the game shows them, and where you and your friend are among them (-1: not playing).
function together(people) {
  return { names: people.map(id => (id === YOU ? HOST_NAME : G.net.friend.name)), me: people.indexOf(YOU), friendI: people.indexOf(FRIEND), host: true };
}

// Settings pages: the hand you play with and sound, side by side.
function handAndSound(ui, L, width, hand) {
  ui.text(hand, L, 298, { size: 32, weight: 650, color: C.dim });
  ui.options('hand', L, 314, width / 2 - 20, 84, [['right', 'Right'], ['left', 'Left']], settings.hand);
  ui.text('Sound', L + width / 2 + 20, 298, { size: 32, weight: 650, color: C.dim });
  ui.options('sound', L + width / 2 + 20, 314, width / 2 - 20, 84, [[true, 'On'], [false, 'Off']], settings.sound);
}
// A power setting (key: 'bpower' or 'gpower') on the left, robot talk on the right.
function powerAndTalk(ui, L, width, key, value, hint, y = 600) {
  ui.text(key === 'gpower' ? 'Putt power' : 'Throw power', L, y, { size: 32, weight: 650, color: C.dim });
  ui.button(`${key}:-`, L, y + 16, 110, 84, '–', { size: 52 });
  ui.text(`${Math.round(value * 100)}%`, L + 205, y + 60, { size: 44, weight: 800, align: 'center', base: 'middle', color: value !== 1 ? '#ffd23f' : '#fff' });
  ui.button(`${key}:+`, L + 300, y + 16, 110, 84, '+', { size: 52 });
  ui.text(hint, L, y + 136, { size: 25, weight: 500, color: C.dim });
  ui.text('Robot talk', L + width / 2 + 20, y, { size: 32, weight: 650, color: C.dim });
  ui.options('talk', L + width / 2 + 20, y + 16, width / 2 - 20, 84, [['off', 'Off'], ['bubbles', 'Bubbles'], ['beeps', 'Beeps'], ['voice', 'Voice']], settings.talk);
}
// In VR: recentre and exit, bottom right.
function vrButtons(ui, L, width) {
  if (!G.inXR) return;
  ui.button('recentre', L + width - 640, 940, 300, 70, 'Recentre', { size: 32 });
  ui.button('exit', L + width - 320, 940, 320, 70, G.mr ? 'Exit mixed reality' : 'Exit VR', { size: 32 });
}

// Robot games you watch can go faster: 1, 2 or 4 times.
const SPEEDS = [1, 2, 4];
function speedOptions(ui, x, y, w) {
  ui.text('Watching speed', x, y, { size: 32, weight: 650, color: C.dim });
  ui.options('watchSpeed', x, y + 16, w, 84, SPEEDS.map(k => [k, `${k}×`]), settings.watchSpeed);
}

// A robot ladder (bowling, darts, mini golf), like table tennis's: beat each
// robot to face the next. key: the buttons' prefix; lad: { beaten, champion };
// current: the robot you're playing now; detail(r, i): the line under its name.
function renderLadder(ui, L, R, width, dim, { key, lad, current, intro, champ, detail }) {
  const g = ui.g;
  dim(lad.champion ? champ : intro, 292);
  RIVALS.forEach((r, i) => {
    const y = 318 + i * 104, done = lad.beaten.includes(r.id), open = i === 0 || lad.beaten.includes(RIVALS[i - 1].id);
    roundRect(g, L, y, width, 92, 22);
    g.fillStyle = current === r.id ? '#17284a' : open ? '#1b2438' : '#141a29'; g.fill();
    g.beginPath(); g.arc(L + 50, y + 46, 26, 0, Math.PI * 2); g.fillStyle = open ? hex(r.look.accent) : '#3a4560'; g.fill();
    ui.text(String(i + 1), L + 50, y + 48, { size: 30, weight: 800, align: 'center', base: 'middle', color: '#0e1320' });
    ui.text(r.name, L + 100, y + 40, { size: 38, weight: 800, color: open ? '#fff' : '#6b7896' });
    ui.text(detail(r, i), L + 100, y + 76, { size: 25, weight: 500, color: open ? C.dim : '#4f5b78' });
    if (done) {
      ui.text('✓ Beaten', R - 250, y + 48, { size: 32, weight: 800, color: C.good, align: 'right', base: 'middle' });
      ui.button(`${key}:${r.id}`, R - 220, y + 14, 200, 64, 'Again', { size: 30 });
    } else if (open) ui.button(`${key}:${r.id}`, R - 260, y + 12, 240, 68, 'Challenge', { primary: true, size: 32 });
    else ui.text('Locked', R - 30, y + 48, { size: 30, weight: 700, color: '#55627e', align: 'right', base: 'middle' });
  });
}
// A ladder result: record a win (and maybe the championship) and say what it means.
function ladderNote(lad, id, won, sport) {
  const i = RIVALS.findIndex(r => r.id === id), r = RIVALS[i];
  if (!won) return { title: `${r.name} wins`, sub: 'Have another go from the Ladder tab', colour: C.bad, good: false };
  const first = !lad.beaten.includes(r.id);
  if (first) lad.beaten.push(r.id);
  const champ = i === RIVALS.length - 1 && !lad.champion;
  if (champ) { lad.champion = true; trophy.root.visible = true; }
  save('sh_stats', stats);
  const next = RIVALS[i + 1];
  return champ ? { title: `${sport.toUpperCase()} CHAMPION!`, sub: 'You beat all six robots', colour: '#d4af37', good: true }
    : { title: `You beat ${r.name}!`, sub: next ? (first ? `${next.name} is next on the ladder` : 'Beaten again') : 'Still the champion', colour: C.good, good: true };
}

// The table tennis cup, the darts cup, the mini golf cup or the bowling cup
// (kind 'tt' | 'darts' | 'golf' | 'bowl'): the same draw, the same buttons with
// 'cup:', 'dcup:', 'gcup:' or 'bcup:'.
function renderCup(ui, L, R, width, dim, kind = 'tt') {
  const dartsCup = kind === 'darts', bowlCup = kind === 'bowl', golfCup = kind === 'golf' || bowlCup;   // (bowling's works like golf's)
  const cup = { tt: G.cup, darts: G.dcup, golf: G.gcup, bowl: G.bcup }[kind], g = ui.g, k = { tt: 'cup', darts: 'dcup', golf: 'gcup', bowl: 'bcup' }[kind];
  const won = { tt: stats.cups, darts: stats.darts.cups, golf: stats.golfCups, bowl: stats.bowling.cups }[kind];
  if (!cup) {
    dim('Eight players, one cup: you and seven robots in a knockout.', 300);
    dim(bowlCup ? `Quarter-finals and semi-finals are a ${BOWL_CUP_FRAMES[0]}-frame game; the final is a full ${BOWL_CUP_FRAMES[2]} frames.`
      : golfCup ? 'Quarter-finals and semi-finals are a round of Classic; the final is a round of Trickshot.'
      : dartsCup ? `Quarter-finals and semi-finals are one leg of ${CUP_START}; the final is best of three legs.` : 'Quarter-finals and semi-finals are one game to 11; the final is best of three.', 345);
    dim(bowlCup ? 'Most pins goes through; a tie goes to a roll-off (one ball each). Watch the robots\' games or play them out.'
      : golfCup ? 'Fewest strokes goes through; a tie goes to sudden death. Watch the robots\' rounds or play them out.'
      : dartsCup ? `You only play your own matches; watch the robot matches or skip them. Finish: ${settings.dartsFinish === 'double' ? 'double out' : 'any finish'} (Match tab).`
        : 'You only play your own matches; watch the robot matches or skip them.', 390);
    ui.text(won ? `Cups won: ${won}` : 'No cups yet.', L, 470, { size: 40, weight: 800, color: won ? '#d4af37' : C.text });
    // Bowling, darts and mini golf: with a friend connected, the cup can be the
    // two of you and six robots.
    const fr = kind !== 'tt' ? G.net?.friend : null;
    if (fr) {
      ui.button(`${k}:new`, L, 560, width / 2 - 10, 120, 'Start a cup', { size: 44 });
      ui.button(`${k}:newfriend`, L + width / 2 + 10, 560, width / 2 - 10, 120, `Start a cup with ${fr.name}`, { primary: true, size: 40 });
      dim(`You and ${fr.name} go in opposite halves with six robots: you could meet in the final.`, 740, 28);
    } else {
      ui.button(`${k}:new`, L, 560, width, 120, 'Start a cup', { primary: true, size: 50 });
      if (kind !== 'tt') dim('Hosting a friend (Friend tab)? Then you can play the cup together.', 740, 28);
    }
    return;
  }
  const nx = nextMatch(cup), out = youAreOut(cup);
  let status;
  if (cup.champion === YOU) status = '★ You won the cup! ★';
  else if (cup.champion) status = `${entrantName(cup.champion)} won the cup.${out ? ' Better luck next time!' : ''}`;
  else status = `Next: ${ROUND_NAMES[nx.r]} · ${entrantName(nx.m.a)} v ${entrantName(nx.m.b)}${out && !involvesYou(nx.m) ? '   (you\'re out)' : ''}`;
  ui.text(status, L, 296, { size: 34, weight: 800, color: cup.champion === YOU ? '#d4af37' : C.text });

  // The bracket: quarter-finals, semi-finals, final.
  const cols = [L, L + 480, L + 960], bw = 420, bh = 100;
  const ys = [[345, 480, 615, 750], [412, 682], [547]];
  (bowlCup ? BOWL_CUP_FRAMES.map((f, r) => `${['Quarter-finals', 'Semi-finals', 'Final'][r]} (${f} frames)`)
    : golfCup ? ['Quarter-finals (Classic)', 'Semi-finals (Classic)', 'Final (Trickshot)'] : ['Quarter-finals', 'Semi-finals', dartsCup ? 'Final (best of 3 legs)' : 'Final (best of 3)'])
    .forEach((t, r) => ui.text(t, cols[r], 334, { size: 24, weight: 700, color: C.dim }));
  g.strokeStyle = '#3a4866'; g.lineWidth = 3;
  for (let r = 0; r < 2; r++) ys[r].forEach((y, i) => {
    const ny = ys[r + 1][i >> 1] + bh / 2;
    g.beginPath(); g.moveTo(cols[r] + bw, y + bh / 2); g.lineTo(cols[r] + bw + 30, y + bh / 2); g.lineTo(cols[r] + bw + 30, ny); g.lineTo(cols[r + 1], ny); g.stroke();
  });
  cup.rounds.forEach((round, r) => round.forEach((m, i) => {
    const x = cols[r], y = ys[r][i];
    const isNext = nx && nx.r === r && nx.i === i;
    roundRect(g, x, y + 12, bw, bh, 18);
    g.fillStyle = involvesPerson(m) ? '#17284a' : '#1b2438'; g.fill();
    g.lineWidth = isNext ? 5 : 2; g.strokeStyle = isNext ? C.accent : '#2c3954'; g.stroke();
    [['a', 0], ['b', 1]].forEach(([k, row]) => {
      const id = m[k], ty = y + 12 + 30 + row * 44;
      if (!id) { ui.text('–', x + 24, ty + 8, { size: 28, weight: 600, color: '#55627e' }); return; }
      const lost = m.winner && m.winner !== id;
      g.beginPath(); g.arc(x + 30, ty, 11, 0, Math.PI * 2); g.fillStyle = entrantColour(id); g.fill();
      ui.text(entrantName(id), x + 52, ty + 10, { size: 30, weight: m.winner === id ? 800 : 600, color: lost ? '#6b7896' : '#fff' });
      if (m.score) {
        const mine = s => (k === 'a' ? s.a : s.b), theirs = s => (k === 'a' ? s.b : s.a);
        // (Golf: strokes for the round, a playoff after it; bowling: pins, and a roll-off.)
        const shown = golfCup ? `${mine(m.score[0])}${m.score[1] ? ` (${mine(m.score[1])})` : ''}`
          : m.score.length === 1 ? mine(m.score[0]) : m.score.filter(s => mine(s) > theirs(s)).length;
        ui.text(String(shown), x + bw - 24, ty + 10, { size: 32, weight: 800, align: 'right', color: lost ? '#6b7896' : '#ffd23f' });
      }
    });
  }));

  // What next.
  const y = 890;
  const inCupMatch = bowlCup ? G.mode === 'bowl' && G.bcupRef && bowl.inProgress()
    : golfCup ? G.mode === 'golf' && G.gcupRef && golf.inProgress()
    : dartsCup ? G.mode === 'darts' && G.dcupRef && darts.inProgress()
      : (G.mode === 'match' || G.mode === 'exhibition') && G.cupRef && G.match && !G.match.over;
  const resumeText = bowlCup ? 'Resume the game' : golfCup ? 'Resume the round' : 'Resume the match';
  if (inCupMatch && watchingRobots()) {
    // Watching robots: how fast it goes.
    ui.button('resume', L, y, width - 420, 96, resumeText, { primary: true, size: 40 });
    ui.options('watchSpeed', R - 400, y + 6, 400, 84, SPEEDS.map(s => [s, `${s}×`]), settings.watchSpeed);
    ui.text('Watching speed', R - 400, y - 4, { size: 26, weight: 650, color: C.dim });
  } else if (inCupMatch) ui.button('resume', L, y, width - 320, 96, resumeText, { primary: true, size: 40 });
  else if (!nx) ui.button(`${k}:new`, L, y, width - 320, 96, 'Start a new cup', { primary: true, size: 40 });
  else if (involvesPerson(nx.m)) {
    // Yours (or, in a cup with a friend, theirs: they play it from their screen).
    const theirs = involvesFriend(nx.m), here = !theirs || !!G.net?.friend;
    const opp = involvesYou(nx.m) ? (nx.m.a === YOU ? nx.m.b : nx.m.a) : null;
    const verb = bowlCup ? 'bowls' : golfCup ? 'putts' : 'throws';
    const label = !here ? `Waiting for ${entrantName(FRIEND)}: host from the Friend tab`
      : opp ? `Play ${entrantName(opp)} · ${ROUND_NAMES[nx.r]}` : `${entrantName(nx.m.a)} v ${entrantName(nx.m.b)} · ${entrantName(FRIEND)} ${verb}`;
    ui.button(`${k}:play`, L, y, width - 320, 96, label, { primary: here, disabled: !here, size: 36 });
  } else {
    // Robots: watch it, or play it out (golf and bowling: from their usual
    // scores; table tennis and darts: skip it).
    const bothOut = out && (!cup.friend || friendIsOut(cup));
    const bw2 = (width - 320 - 40) / 3;
    ui.button(`${k}:watch`, L, y, bw2, 96, 'Watch it', { primary: true, size: 34 });
    ui.button(`${k}:skip`, L + bw2 + 20, y, bw2, 96, golfCup ? 'Play it out' : 'Skip it', { size: 34 });
    ui.button(`${k}:skipall`, L + 2 * (bw2 + 20), y, bw2, 96, bothOut ? (golfCup ? 'Play out the rest' : 'Skip to the end') : cup.friend ? 'On to the next of ours' : golfCup ? 'On to my match' : 'Skip to my match', { size: 30 });
    dim(G.inXR ? 'Watching, your free hand\'s trigger speeds it up (2×, 4×, then back to normal).'
      : `Watching, ${isTouch() ? 'the ⏩ button' : 'the ⏩ button or the F key'} speeds it up (2×, 4×, then back to normal).`, 1008, 25);
  }
  if (!inCupMatch && nx) ui.button(`${k}:new`, R - 300, y, 300, 96, 'New draw', { size: 32 });
}

// ------------------------------------------------------------ darts cup --
function saveDCup() { save('sh_dcup', G.dcup); }
function dartsGameName() {
  const legs = n => (n === 1 ? 'one leg' : `best of ${n} legs`), g = settings.dartsGame;
  return g === 'cricket' ? `Cricket, ${legs(settings.dartsLegs)}` : g === 'killer' ? `Killer, ${settings.dartsLives} lives`
    : `${settings.dartsStart}, ${settings.dartsFinish === 'double' ? 'double out' : 'any finish'}, ${legs(settings.dartsLegs)}`;
}
// Record a darts cup result; true if you've just won the cup.
function dcupRecord(r, i, winner, score) {
  cupRecordResult(G.dcup, r, i, winner, score);
  saveDCup();
  if (G.dcup.champion !== YOU) return false;
  stats.darts.cups = (stats.darts.cups ?? 0) + 1; save('sh_stats', stats);
  trophy.root.visible = true;
  return true;
}
function dcupSkip(all) {
  let nx;
  while ((nx = nextMatch(G.dcup)) && !involvesPerson(nx.m)) {
    const q = simulateMatch(nx.m.a, nx.m.b, { legs: ROUND_LEGS[nx.r], doubleOut: settings.dartsFinish === 'double' });
    dcupRecord(nx.r, nx.i, q.winner, q.score);
    if (!all) break;
  }
  if (G.dcup.champion && G.dcup.champion !== YOU) showBanner(`${entrantName(G.dcup.champion, G.dcup)} wins the cup`, '', entrantColour(G.dcup.champion), 3);
}
// The next match: yours, your friend's (they throw from their screen while you
// watch), or (watch) two robots'. In a cup with a friend who's here, every
// match shows on their screen too.
function dcupPlayNext(watch) {
  const nx = nextMatch(G.dcup);
  if (!nx) return;
  if (involvesFriend(nx.m) && !G.net?.friend) return;
  const { people, bots } = cupSides(nx.m);
  if (!people.length && !watch) return;
  const label = `Cup ${ROUND_NAMES[nx.r].toLowerCase()}`, base = { mode: 'x01', start: CUP_START, doubleOut: settings.dartsFinish === 'double', legs: ROUND_LEGS[nx.r], label };
  const remote = G.dcup.friend && G.net?.friend ? together(people) : null;
  const opts = remote ? { ...base, rivals: bots.map(rivalById), remote }
    : people.length ? { ...base, rival: rivalById(bots[0]) } : { ...base, robotsOnly: bots.map(rivalById) };
  startDarts('x01', { opts, cupRef: { r: nx.r, i: nx.i, ids: [...people, ...bots] } }, remote);
}
// The darts game's match is over: record it if it was a cup match, and say
// what it means (returned to the game to show; your friend's screen gets theirs).
// legsWon is in the game's player order (ref.ids).
function dartsCupResult({ winner, legsWon }) {
  const ref = G.dcupRef;
  if (!ref) return null;
  const cm = G.dcup.rounds[ref.r][ref.i];
  const winId = ref.ids[winner];
  dcupRecord(ref.r, ref.i, winId, [{ a: legsWon[ref.ids.indexOf(cm.a)], b: legsWon[ref.ids.indexOf(cm.b)] }]);
  if (G.dartsFriend) send({ t: 'dnote', note: cupNote(G.dcup, ref.r, cm, winId, FRIEND, 'darts') });
  return cupNote(G.dcup, ref.r, cm, winId, YOU, 'darts');
}

// --------------------------------------------------------- darts ladder --
// A match against each robot in turn (DARTS_LADDER says how long). Beat Omega
// to be darts champion.
function startDartsLadder(id) {
  const i = RIVALS.findIndex(r => r.id === id);
  if (i < 0) return;
  const r = RIVALS[i], f = DARTS_LADDER[i];
  startDarts('x01', { opts: { mode: 'x01', start: f.start, doubleOut: settings.dartsFinish === 'double', legs: f.legs, rival: r, label: `Ladder: ${r.name}` }, ladderRef: { id } });
}
function dartsLadderResult({ winner }) {
  return ladderNote(stats.darts.ladder, G.dladderRef.id, winner === 0, 'darts');
}

// ------------------------------------------------------- mini golf cup --
function saveGCup() { save('sh_gcup', G.gcup); }
// Record a golf cup result; true if you've just won the cup.
function gcupRecord(r, i, winner, score) {
  cupRecordResult(G.gcup, r, i, winner, score);
  saveGCup();
  if (G.gcup.champion !== YOU) return false;
  stats.golfCups = (stats.golfCups ?? 0) + 1; save('sh_stats', stats);
  trophy.root.visible = true;
  return true;
}
function gcupSkip(all) {
  let nx;
  while ((nx = nextMatch(G.gcup)) && !involvesPerson(nx.m)) {
    const q = simulateRound(nx.m.a, nx.m.b, GOLF_COURSES[CUP_COURSES[nx.r]].holes);
    gcupRecord(nx.r, nx.i, q.winner, q.score);
    if (!all) { showBanner(`${entrantName(q.winner, G.gcup)} goes through`, `${entrantName(nx.m.a, G.gcup)} ${q.score[0].a} · ${entrantName(nx.m.b, G.gcup)} ${q.score[0].b}${q.score[1] ? ' · after a playoff' : ''}`, entrantColour(q.winner), 3); break; }
  }
  if (G.gcup.champion && G.gcup.champion !== YOU) showBanner(`${entrantName(G.gcup.champion, G.gcup)} wins the cup`, '', entrantColour(G.gcup.champion), 3);
}
// Your next round, your friend's (they putt from their screen while you
// watch), or (watch) the robots' round that's next, putted out in front of you.
// In a cup with a friend who's here, every round shows on their screen too.
function gcupPlayNext(watch = false) {
  const nx = nextMatch(G.gcup);
  if (!nx) return;
  if (involvesFriend(nx.m) && !G.net?.friend) return;
  const { people, bots } = cupSides(nx.m);
  if (!people.length && !watch) return;
  const game = { rivals: bots.map(rivalById), course: CUP_COURSES[nx.r], cup: { label: `Cup ${ROUND_NAMES[nx.r].toLowerCase()}` }, ref: { r: nx.r, i: nx.i, ids: [...people, ...bots] } };
  if (G.gcup.friend && G.net?.friend) {
    const t = together(people);
    startGolf(t.names, t.me, game, { i: t.friendI });
  } else startGolf(people.length ? 1 : [], null, game);
}
// The golf game's cup round is over: record it and say what it means (for you,
// and for your friend on their screen). totals and po (playoff strokes) are in
// the game's player order (ref.ids).
function golfCupResult({ totals, winner, po }) {
  const ref = G.gcupRef;
  if (!ref) return null;
  const cm = G.gcup.rounds[ref.r][ref.i];
  const winId = ref.ids[winner ?? 0];
  const side = v => ({ a: v[ref.ids.indexOf(cm.a)], b: v[ref.ids.indexOf(cm.b)] });
  gcupRecord(ref.r, ref.i, winId, [side(totals), ...(po ? [side(po)] : [])]);
  return { host: cupNote(G.gcup, ref.r, cm, winId, YOU, 'mini golf'), friend: G.golfFriend ? cupNote(G.gcup, ref.r, cm, winId, FRIEND, 'mini golf') : null };
}

// ----------------------------------------------------- mini golf ladder --
// A round against each robot in turn: Classic for the first three, Trickshot
// for the rest (a tie goes to sudden death). Beat Omega to be champion.
function startGolfLadder(id) {
  const i = RIVALS.findIndex(r => r.id === id);
  if (i < 0) return;
  const r = RIVALS[i];
  startGolf(1, null, { rivals: [r], course: GOLF_LADDER[i], cup: { label: `Ladder: ${r.name}` }, ladder: { id } });
}
function golfLadderResult({ winner }) {
  return ladderNote(stats.golfLadder, G.gladderRef.id, winner === 0, 'mini golf');
}

// What a cup result means to the person at a screen (viewer: YOU, or FRIEND on
// their screen in a cup together): { title, sub, colour, good } where
// good is true (you're through or won it), false (you're out) or null (watching).
function cupNote(cup, r, m, winId, viewer, sport) {
  const name = id => (id === viewer ? 'You' : id === YOU ? HOST_NAME : entrantName(id, cup));
  const mine = m.a === viewer || m.b === viewer;
  if (cup.champion === winId && r === 2) {
    return winId === viewer ? { title: 'CUP WINNERS!', sub: `You won the ${sport} cup`, colour: '#d4af37', good: true }
      : { title: `${name(winId)} win${name(winId) === 'You' ? '' : 's'} the cup`, sub: `The ${sport} cup`, colour: entrantColour(winId), good: mine ? false : null };
  }
  if (mine) {
    return winId === viewer ? { title: 'Through!', sub: `You're in the ${ROUND_NAMES[r + 1].toLowerCase()}`, colour: C.good, good: true }
      : { title: 'Out of the cup', sub: `Knocked out in the ${ROUND_NAMES[r].toLowerCase()}`, colour: C.bad, good: false };
  }
  return { title: `${name(winId)} goes through`, sub: `to the ${ROUND_NAMES[r + 1].toLowerCase()}`, colour: entrantColour(winId), good: null };
}

// --------------------------------------------------------- bowling cup --
function saveBCup() { save('sh_bcup', G.bcup); }
// Record a bowling cup result; true if you've just won the cup.
function bcupRecord(r, i, winner, score) {
  cupRecordResult(G.bcup, r, i, winner, score);
  saveBCup();
  if (G.bcup.champion !== YOU) return false;
  stats.bowling.cups = (stats.bowling.cups ?? 0) + 1; save('sh_stats', stats);
  trophy.root.visible = true;
  return true;
}
function bcupSkip(all) {
  let nx;
  while ((nx = nextMatch(G.bcup)) && !involvesPerson(nx.m)) {
    const q = quickCupGame(nx.m.a, nx.m.b, BOWL_CUP_FRAMES[nx.r]);
    bcupRecord(nx.r, nx.i, q.winner, q.score);
    if (!all) { showBanner(`${entrantName(q.winner)} goes through`, `${entrantName(nx.m.a)} ${q.score[0].a} · ${entrantName(nx.m.b)} ${q.score[0].b}${q.score[1] ? ' · after a roll-off' : ''}`, entrantColour(q.winner), 3); break; }
  }
  if (G.bcup.champion && G.bcup.champion !== YOU) showBanner(`${entrantName(G.bcup.champion)} wins the cup`, '', entrantColour(G.bcup.champion), 3);
}
// The next game: yours, your friend's (they bowl from their screen and you
// watch), or (watch) two robots bowling it out. In a cup with a friend who's
// here, every game shows on their screen too.
function bcupPlayNext(watch = false) {
  const nx = nextMatch(G.bcup);
  if (!nx) return;
  const m = nx.m;
  if (involvesFriend(m) && !G.net?.friend) return;
  const ids = [m.a, m.b], people = ids.filter(id => id === YOU || id === FRIEND).sort((a, b) => (a === YOU ? -1 : b === YOU ? 1 : 0));
  if (!people.length && !watch) return;
  const bots = ids.filter(id => !people.includes(id));
  const game = { kind: 'cup', people, rivals: bots.map(rivalById), frames: BOWL_CUP_FRAMES[nx.r], label: `Cup ${ROUND_NAMES[nx.r].toLowerCase()}`, ref: { r: nx.r, i: nx.i, ids: [...people, ...bots] } };
  const together = !!G.bcup.friend && !!G.net?.friend;
  startBowling(game, together ? { names: people.map(id => (id === YOU ? HOST_NAME : G.net.friend.name)), me: people.indexOf(YOU), friendI: people.indexOf(FRIEND), host: true } : null);
}
// The bowling game's cup game is over: record it and say what it means (for
// you, and for your friend on their screen). scores and rolloff (roll-off pins)
// are in the game's player order (ref.ids).
function bowlCupResult({ scores, winner, rolloff }) {
  const ref = G.bcupRef;
  if (!ref) return null;
  const cm = G.bcup.rounds[ref.r][ref.i];
  const winId = ref.ids[winner];
  const side = v => ({ a: v[ref.ids.indexOf(cm.a)], b: v[ref.ids.indexOf(cm.b)] });
  bcupRecord(ref.r, ref.i, winId, [side(scores), ...(rolloff ? [side(rolloff)] : [])]);
  return { host: cupNote(G.bcup, ref.r, cm, winId, YOU, 'bowling'), friend: G.bowlFriend ? cupNote(G.bcup, ref.r, cm, winId, FRIEND, 'bowling') : null };
}

// ------------------------------------------------------- bowling ladder --
// Beat each robot to face the next: the first three are 5-frame games, the
// last three a full 10 (a tie goes to a roll-off). Beat Omega to be champion.
const BOWL_LADDER_FRAMES = [5, 5, 5, 10, 10, 10];
function startBowlLadder(id) {
  const i = RIVALS.findIndex(r => r.id === id);
  if (i < 0) return;
  const r = RIVALS[i];
  startBowling({ kind: 'ladder', people: [YOU], rivals: [r], frames: BOWL_LADDER_FRAMES[i], label: `Ladder: ${r.name}`, ref: { id } });
}
function bowlLadderResult({ winner }) {
  return { host: ladderNote(stats.bowling.ladder, G.bladderRef.id, winner === 0, 'bowling') };
}

function saveCup() { save('sh_cup', G.cup); }

// Record a cup result (score as games of { a, b } from the match's a side).
function cupResult(r, i, winner, score) {
  cupRecordResult(G.cup, r, i, winner, score);
  saveCup();
  if (G.cup.champion === YOU) {
    stats.cups++; save('sh_stats', stats);
    trophy.root.visible = true;
    later(1.0, () => { burst(1.5); sound('fanfare'); W.crowd.cheer(2); });
    return true;
  }
  return false;
}

function cupSkip(all) {
  let nx;
  while ((nx = nextMatch(G.cup)) && !involvesYou(nx.m)) {
    const q = quickMatch(nx.m.a, nx.m.b, ROUND_GAMES[nx.r]);
    cupResult(nx.r, nx.i, q.winner, q.score);
    if (!all) break;
  }
  if (G.cup.champion && G.cup.champion !== YOU) showBanner(`${entrantName(G.cup.champion)} wins the cup`, '', hex(rivalById(G.cup.champion).look.accent), 3);
}

function cupPlayNext(watch) {
  const nx = nextMatch(G.cup);
  if (!nx) return;
  const ref = { r: nx.r, i: nx.i }, games = ROUND_GAMES[nx.r];
  if (watch) startExhibition({ near: nx.m.a, far: nx.m.b, games, cupRef: ref });
  else startMatch({ rival: rivalById(nx.m.a === YOU ? nx.m.b : nx.m.a), games, cupRef: ref });
}

// ---------------------------------------------------- sharing paddle feel --
let qrLib = null;
async function loadQR() {
  if (qrLib !== null) return;
  try { qrLib = (await import('https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/+esm')).default; } catch { qrLib = false; }
  if (G.tab === 'share') menu.redraw();
}
const shareLink = () => feelLink(location.origin + location.pathname, settings.feel, settings.angle);

function renderShare(ui, L, R, width, dim) {
  const link = shareLink(), g = ui.g;
  dim('Send a friend your paddle feel and angle. When they open the link,', 300);
  dim('the game asks them before it changes anything.', 340);
  const size = 520, x = L, y = 380;
  g.fillStyle = '#ffffff';
  roundRect(g, x, y, size, size, 24); g.fill();
  if (qrLib) {
    const qr = qrLib(0, 'M'); qr.addData(link); qr.make();
    const n = qr.getModuleCount(), cell = Math.floor((size - 60) / n), off = x + (size - cell * n) / 2, offY = y + (size - cell * n) / 2;
    g.fillStyle = '#0e1320';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * cell, offY + r * cell, cell, cell);
  } else ui.text(qrLib === false ? 'QR code unavailable' : 'Making the code…', x + size / 2, y + size / 2, { size: 30, weight: 600, align: 'center', base: 'middle', color: '#55627e' });
  const tx = x + size + 50;
  ui.text('Scan with a phone camera', tx, 420, { size: 38, weight: 800 });
  ui.text('or send the link:', tx, 466, { size: 30, weight: 500, color: C.dim });
  const [base, query] = link.split('?');
  ui.text(base, tx, 530, { size: 28, weight: 600, color: '#9fd8ff' });
  ui.text(`?${query}`, tx, 572, { size: 28, weight: 600, color: '#9fd8ff' });
  const f = settings.feel;
  ui.text(`Sweet spot ${Math.round(f.size * 200)} cm · bounce ${Math.round(f.bounce * 100)}% · grip ${Math.round(f.grip * 100)}%`, tx, 650, { size: 26, weight: 500, color: C.dim });
  ui.text(`power ${Math.round(f.power * 100)}% · smoothing ${Math.round(f.smooth * 100)}% · angle ${settings.angle}°`, tx, 690, { size: 26, weight: 500, color: C.dim });
  ui.button('share:copy', tx, 760, R - tx, 90, navigator.share && isTouch() ? 'Share the link' : 'Copy the link', { primary: true, size: 36 });
  if (G.shareNote) ui.text(G.shareNote, tx, 890, { size: 28, weight: 600, color: G.shareNote.startsWith('Link') ? C.good : C.bad });
  ui.button('tab:feel', R - 250, 930, 250, 70, '‹ Back', { size: 30 });
}

async function copyShareLink() {
  const link = shareLink();
  try {
    if (navigator.share && isTouch()) { await navigator.share({ title: 'My Sports Hall paddle', url: link }); G.shareNote = 'Link shared'; }
    else { await navigator.clipboard.writeText(link); G.shareNote = 'Link copied. Paste it into a message.'; }
  } catch { G.shareNote = 'Can\'t copy here: scan the code with a phone instead.'; }
  menu.redraw();
}

function onMenuClick(id) {
  sfx.play('click');
  const [k, v, dir] = id.split(':');
  if (k === 'tab') { G.tab = v; G.shareNote = ''; }
  else if (k === 'sport') {
    if (v !== G.sport) {
      if (G.mode !== 'menu' || darts.active || golf.active || bowl.active) { clearPlay(); G.mode = 'menu'; }
      G.sport = settings.sport = v;
      G.tab = v === 'golf' ? 'golf' : v === 'darts' ? 'darts' : v === 'bowl' ? 'bowl' : 'match';
    }
  }
  else if (k === 'darts') startDarts(v);
  else if (id === 'dartsversus') startDartsVersus();
  else if (k === 'bcup') {
    if (v === 'new') { G.bcup = newCup(); saveBCup(); }
    else if (v === 'newfriend' && G.net?.friend) { G.bcup = newCup(Math.random, G.net.friend.name); saveBCup(); }
    else if (v === 'play') bcupPlayNext(false);
    else if (v === 'watch') bcupPlayNext(true);
    else if (v === 'skip') bcupSkip(false);
    else if (v === 'skipall') bcupSkip(true);
  }
  else if (k === 'bladder') startBowlLadder(v);
  else if (k === 'dladder') startDartsLadder(v);
  else if (k === 'gladder') startGolfLadder(v);
  else if (k === 'watchSpeed') setSpeed(+v);
  else if (k === 'bprac') startBowlPractice(v);
  else if (id === 'bowlversus') startBowlVersus();
  else if (k === 'gcup') {
    if (v === 'new') { G.gcup = newCup(); saveGCup(); }
    else if (v === 'newfriend' && G.net?.friend) { G.gcup = newCup(Math.random, G.net.friend.name); saveGCup(); }
    else if (v === 'play') gcupPlayNext(false);
    else if (v === 'watch') gcupPlayNext(true);
    else if (v === 'skip') gcupSkip(false);
    else if (v === 'skipall') gcupSkip(true);
  }
  else if (k === 'dcup') {
    if (v === 'new') { G.dcup = newCup(); saveDCup(); }
    else if (v === 'newfriend' && G.net?.friend) { G.dcup = newCup(Math.random, G.net.friend.name); saveDCup(); }
    else if (v === 'play') dcupPlayNext(false);
    else if (v === 'watch') dcupPlayNext(true);
    else if (v === 'skip') dcupSkip(false);
    else if (v === 'skipall') dcupSkip(true);
  }
  else if (k === 'dartsOpp' || k === 'dartsFinish' || k === 'dartsAssist') settings[k] = v;
  else if (k === 'dartsGame') { if (+v) { settings.dartsGame = 'x01'; settings.dartsStart = +v; } else settings.dartsGame = v; }
  else if (k === 'dartsStart' || k === 'dartsLegs' || k === 'dartsKPlayers' || k === 'dartsLives') settings[k] = +v;
  else if (k === 'dartsCaller') settings.dartsCaller = v === 'true';
  else if (k === 'dpower') settings.dartsPower = +Math.max(0.7, Math.min(1.5, settings.dartsPower + (v === '+' ? 0.05 : -0.05))).toFixed(2);
  else if (id === 'golf:start') startGolf();
  else if (id === 'golfversus') startGolfVersus();
  else if (k === 'golfPlayers') settings.golfPlayers = +v;
  else if (k === 'golfRobot') settings.golfRobot = v;
  else if (id === 'bowl:play') startBowling();
  else if (k === 'bowlRobot' || k === 'bowlAssist') settings[k] = v;
  else if (k === 'bowlPlayers' || k === 'bowlFrames') settings[k] = +v;
  else if (k === 'bowlBumpers') settings.bowlBumpers = v === 'true';
  else if (k === 'bpower') settings.bowlPower = +Math.max(0.6, Math.min(1.6, (settings.bowlPower ?? 1) + (v === '+' ? 0.05 : -0.05))).toFixed(2);
  else if (k === 'gpower') settings.golfPower = +Math.max(0.6, Math.min(1.6, (settings.golfPower ?? 1) + (v === '+' ? 0.05 : -0.05))).toFixed(2);
  else if (k === 'golfCourse') settings.golfCourse = v;
  else if (k === 'cup') {
    if (v === 'new') { G.cup = newCup(); saveCup(); }
    else if (v === 'play') cupPlayNext(false);
    else if (v === 'watch') cupPlayNext(true);
    else if (v === 'skip') cupSkip(false);
    else if (v === 'skipall') cupSkip(true);
  }
  else if (id === 'share:copy') copyShareLink();
  else if (id === 'lesson:demo') { closeMenu(); showDemo(1); }
  else if (k === 'lesson') startLesson(v);
  else if (id === 'feel:share') { G.tab = 'share'; G.shareNote = ''; loadQR(); }
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
  menuScene();
  menu.redraw();
  drawScoreboard();
}

const _mf = new V3();
function openMenu(tab) {
  if (tab) G.tab = tab;
  else if (G.sport === 'golf' && !['golf', 'gladder', 'gcup', 'friend', 'gsettings'].includes(G.tab)) G.tab = 'golf';
  else if (G.sport === 'darts' && !['darts', 'dladder', 'dcup', 'dpractice', 'friend', 'dsettings'].includes(G.tab)) G.tab = 'darts';
  else if (G.sport === 'bowl' && !['bowl', 'bladder', 'bcup', 'bpractice', 'friend', 'bsettings'].includes(G.tab)) G.tab = 'bowl';
  else if (G.sport === 'tt' && ['golf', 'gladder', 'gcup', 'gsettings', 'darts', 'dladder', 'dcup', 'dpractice', 'dsettings', 'bowl', 'bladder', 'bcup', 'bpractice', 'bsettings'].includes(G.tab)) G.tab = 'match';
  G.paused = true;
  menu.mesh.visible = true;
  menuScene();
  // Mini golf and bowling on a screen have their own cameras, and your
  // standing spot isn't where they look from, so put the menu right in front of the camera.
  if (!G.inXR && (golf.active || bowl.active)) {
    camera.getWorldDirection(_mf);
    menu.mesh.position.copy(camera.position).addScaledVector(_mf, 1.5);
    menu.mesh.quaternion.copy(camera.quaternion);
  }
  menu.redraw();
}
function closeMenu() {
  if (G.mode === 'menu') return;
  G.paused = false;
  menu.mesh.visible = false;
  pose.invalidate();    // no velocity spike from where the paddle was when we paused
}
function toggleMenu() { if (G.paused) closeMenu(); else openMenu(); }

// In the menu, the hall shows the sport you've picked: the table, the darts
// stage or the course's first hole, and in VR you stand where you'd play it.
const golfViews = {};      // one per course, so opening the menu again doesn't recentre you
function menuScene() {
  if (G.mode !== 'menu' || G.role === 'guest') return;
  const s = G.sport;
  // After a round, picking the other course shows that one.
  if (golf.active && !golf.inProgress() && golf.courseId !== settings.golfCourse) { clearPlay(); G.mode = 'menu'; }
  if ((s === 'golf' && golf.active) || (s === 'darts' && darts.active) || (s === 'bowl' && bowl.active)) return;   // a finished game is still on show
  darts.preview(s === 'darts', G.mr);
  golf.preview(s === 'golf' ? settings.golfCourse : null);
  bowl.preview(s === 'bowl');
  W.table.visible = scoreboard.mesh.visible = W.robot.root.visible = desk.outer.visible = s === 'tt';
  attachHands();      // a dart or ball in your hand for darts or bowling, the paddle for table tennis
  if (G.inXR) setView(s === 'darts' ? DARTS_VIEW : s === 'bowl' ? BOWL_VIEW : s === 'golf' ? (golfViews[settings.golfCourse] ??= golf.previewView()) : null);
}

// ------------------------------------------------------------ game flow --
function clearPlay() {
  darts.preview(false); golf.preview(null); bowl.preview(false);     // the menu's view of them
  G.timers = []; G.ball = null; G.ballState = 'none'; G.ref = null; G.ladder = false; G.cupRef = null;
  G.streak = { who: null, n: 0 };
  W.setBall(null);
  targets.root.visible = false;
  bubble.hide(); bubble2.hide(); ghost.stop();
  G.lesson = null; desk.style = 'drive';
  W.robot.root.visible = true; W.machine.root.visible = false;
  robot2.root.visible = false; desk.outer.visible = true;
  friendAvatar.root.visible = false; friendDesk.outer.visible = false;
  // Back from mini golf: the table and its scoreboard return.
  if (G.golfFriend) { send({ t: 'gend' }); G.golfFriend = false; }
  if (G.bowlFriend) { send({ t: 'bend' }); G.bowlFriend = false; }
  if (golf?.active || bowl?.active) {
    if (golf.active) golf.stop();
    if (bowl.active) { bowl.stop(); fitCamera(); placeBoards(); banner.mesh.scale.setScalar(1); }
    attachHands();
    // A robot golfer or bowler goes back to being a table tennis robot (and
    // the second one, from watching a cup game, goes).
    for (const r of [W.robot, robot2]) { r.showPaddle(true); r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0); }
    robot2.root.visible = false;
    G.speaker = null; setRival(G.rival);
  }
  // Back from darts: the robot picks its paddle up again.
  if (G.dartsFriend) { send({ t: 'dend' }); G.dartsFriend = false; }
  G.dcupRef = null; G.gcupRef = null; G.bcupRef = null; G.bladderRef = null; G.dladderRef = null; G.gladderRef = null;
  if (darts?.active) {
    darts.stop(); attachHands();
    for (const r of [W.robot, robot2, robot3]) { r.showPaddle(true); r.root.position.set(0, 0, 0); }
    robot3.root.visible = false; G.speaker = null;
    setRival(G.rival);
    fitCamera(); placeBoards(); banner.mesh.scale.setScalar(1);
  }
  W.table.visible = true; scoreboard.mesh.visible = true;
  setView(null);
  // The boards come back from the courtside spots (after an exhibition, even one
  // that's already over).
  if (G.mode === 'exhibition') G.mode = 'menu';
  placeBoards();
  attachHands();      // the paddle (a menu's dart or bare controller included)
  serveButton(true);
}
// The touch screen's Serve button is only for table tennis.
function serveButton(on) { document.getElementById('touch-serve').hidden = !on; }

// The robots for a game of Killer: the one you picked, then its neighbours on the ladder.
function killerField(id, n) {
  const i = Math.max(0, RIVALS.findIndex(r => r.id === id));
  return [...RIVALS].sort((a, b) => Math.abs(RIVALS.indexOf(a) - i) - Math.abs(RIVALS.indexOf(b) - i) || RIVALS.indexOf(a) - RIVALS.indexOf(b)).slice(0, n);
}

// Darts: mode 'play' (the match picked on the Match tab: x01, cricket or
// killer), atc, count or free. game: a cup or ladder match { opts (the darts
// game's own), cupRef or ladderRef }; remote: a game with the friend you're
// hosting ({ names, me, friendI (where they are in names; -1: watching), host,
// robots (Killer) }), which their screen shows too.
function startDarts(mode, game = null, remote = null) {
  clearPlay();
  G.mode = 'darts';
  W.table.visible = false; scoreboard.mesh.visible = false;
  desk.outer.visible = false;
  const local = settings.dartsOpp === 'local' || !!remote;
  if (mode === 'play') mode = settings.dartsGame;
  setView(DARTS_VIEW);
  closeMenu();
  const rival = ['x01', 'cricket'].includes(mode) && !local ? rivalById(settings.dartsOpp) : null;
  const rivals = mode !== 'killer' ? null : remote ? remote.robots ?? null : !local ? killerField(settings.dartsOpp, settings.dartsKPlayers - 1) : null;
  const opts = game ? game.opts
    : { mode, start: settings.dartsStart, doubleOut: settings.dartsFinish === 'double', legs: settings.dartsLegs, rival, rivals, players: remote ? 2 : settings.dartsKPlayers, lives: settings.dartsLives, remote };
  G.dcupRef = game?.cupRef ?? null;
  G.dladderRef = game?.ladderRef ?? null;
  darts.start(opts);
  if (onlyWatching()) setView(DARTS_WATCH);       // (not in it: watch from a step back)
  if (remote) {
    // Their screen: the same game, from the same start (their darts come here).
    G.dartsFriend = true; G.dartsFriendI = remote.friendI;
    friendAvatar.root.visible = remote.friendI >= 0;
    const o = darts.state.opts;
    send({ t: 'dstart', opts: { mode: o.mode, start: o.start, doubleOut: o.doubleOut, legs: o.legs, lives: o.lives }, names: remote.names, me: remote.friendI,
      robots: (o.rivals ?? []).map(r => r.id), label: o.label ?? null, ...darts.setup });
  }
  attachHands();
  serveButton(false);
  if (!G.inXR) darts.snapCamera();
}

// Darts with the friend you're hosting, at the game picked on the Match tab:
// you're player 1, they're player 2 and throw from beside you.
function startDartsVersus() {
  if (!G.net?.friend) return;
  startDarts('play', null, { names: [HOST_NAME, G.net.friend.name], me: 0, friendI: 1, host: true, robots: friendKillerRobots() });
}
// Killer with a friend: robots make up the players picked on the Match tab
// (3 or 4 players: one or two robots, round the robot picked there).
function friendKillerRobots() {
  if (settings.dartsGame !== 'killer' || settings.dartsKPlayers <= 2) return [];
  return killerField(settings.dartsOpp, settings.dartsKPlayers - 2);
}
const friendRobotsText = () => { const r = friendKillerRobots().map(b => b.name); return r.length ? `, with ${r.join(' and ')}` : ''; };

// players: a number (sharing this screen) or a list of names; me: our index
// (-1: we're watching our friend's cup round). cup: a cup or ladder round
// { rivals, course, cup: { label }, ref (cup) or ladder }. friend: a round with
// the friend you're hosting, { i: where they are in players (-1: watching) },
// which their screen shows too.
function startGolf(players = settings.golfPlayers, me = null, cup = null, friend = null) {
  clearPlay();
  G.mode = 'golf';
  G.gcupRef = cup?.ref ?? null;
  G.gladderRef = cup?.ladder ?? null;
  W.table.visible = false; W.robot.root.visible = false; scoreboard.mesh.visible = false;
  desk.outer.visible = false;
  closeMenu();
  // A robot plays the round too, unless it's a round with a friend (a cup
  // round: its robot, or two robots to watch).
  const rival = cup ? cup.rivals : Array.isArray(players) ? null : RIVALS.find(r => r.id === settings.golfRobot) ?? null;
  const course = cup?.course ?? settings.golfCourse;
  if (friend) {
    G.golfFriend = true; G.golfFriendI = friend.i;
    send({ t: 'gstart', course, names: players, me: friend.i, robots: [rival ?? []].flat().map(r => r.id) });
  }
  golf.start(players, course, me, rival, cup?.cup ?? null);
  attachHands();
  serveButton(false);
  if (!G.inXR) golf.snapCamera();
}

// Bowling: the people on the Play tab take turns, with the robot picked there.
// game: a cup or ladder game { kind: 'cup' | 'ladder', people (YOU / FRIEND),
// rivals, frames, label, ref }; remote: a game with the friend you're hosting
// { names (the people), me, friendI (where you and they are in names, -1: not
// bowling), host }, which their screen shows too.
function startBowling(game = null, remote = null) {
  clearPlay();
  G.mode = 'bowl';
  G.bcupRef = game?.kind === 'cup' ? game.ref : null;
  G.bladderRef = game?.kind === 'ladder' ? game.ref : null;
  W.table.visible = false; W.robot.root.visible = false; scoreboard.mesh.visible = false;
  desk.outer.visible = false;
  setView(BOWL_VIEW);
  closeMenu();
  const rivals = game ? game.rivals : [RIVALS.find(r => r.id === settings.bowlRobot)].filter(Boolean);
  bowl.start(game ? { players: game.people.length, rivals, frames: game.frames, bumpers: false, [game.kind]: { label: game.label }, remote }
    : { players: remote ? 2 : settings.bowlPlayers, rivals, frames: settings.bowlFrames, bumpers: !!settings.bowlBumpers, remote });
  bowlBegun();
  if (remote) {
    // Their screen: the same game (their place in it, if they're bowling).
    G.bowlFriend = true; G.bowlFriendI = remote.friendI;
    friendAvatar.root.visible = remote.friendI >= 0;
    const o = bowl.state.opts;
    send({ t: 'bstart', names: remote.names, me: remote.friendI, robots: rivals.map(r => r.id), frames: o.frames, bumpers: !!o.bumpers, label: game?.label ?? null, kind: game?.kind ?? null });
    send({ t: 'bev', ev: { k: 'start' } });
  }
}
function bowlBegun() {
  attachHands();
  serveButton(false);
  if (!G.inXR) bowl.snapCamera();
}
// Spare practice (which: a spare's id, or 'round').
function startBowlPractice(which) {
  clearPlay();
  G.mode = 'bowl';
  W.table.visible = false; W.robot.root.visible = false; scoreboard.mesh.visible = false;
  desk.outer.visible = false;
  setView(BOWL_VIEW);
  closeMenu();
  bowl.startPractice(which);
  bowlBegun();
}
// Bowling with the friend you're hosting: you're player 1, they're player 2,
// with the robot picked on the Play tab if there is one.
function startBowlVersus() {
  if (!G.net?.friend) return;
  startBowling(null, { names: [HOST_NAME, G.net.friend.name], me: 0, friendI: 1, host: true });
}

// Mini golf with the friend you're hosting: you're player 1, they're player 2.
function startGolfVersus() {
  if (!G.net?.friend) return;
  startGolf([HOST_NAME, G.net.friend.name], 0, null, { i: 1 });    // (ends any earlier round first)
  send({ t: 'g', s: golf.snapshot() });
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
  const low = s === DARTS_VIEW ? 0.2 : 0;     // at the oche: under the board, so you can see it
  menu.mesh.position.set(s.x + fx * 1.12, 1.32 + (s.lift || 0) - low, s.z + fz * 1.12);
  menu.mesh.rotation.set(-0.12, s.th, 0, 'YXZ');
}

// opts: { near, far, games, cupRef } (default: the robots picked on the Watch page)
function startExhibition({ near = settings.exNear, far = settings.exFar, games = settings.games, cupRef = null } = {}) {
  clearPlay();
  G.mode = 'exhibition';
  G.cupRef = cupRef;
  setRival(rivalById(far));
  G.rivalP = rivalById(near);
  robot2.setLook(G.rivalP.look);
  G.botP.setLevel(G.rivalP.level, G.rivalP.tweak);
  G.botP.reset();
  robot2.root.visible = true;
  desk.outer.visible = false;
  G.match = new Match({ games, firstServer: Math.random() < 0.5 ? P : O });
  setView(COURTSIDE);
  placeBoards();
  closeMenu();
  drawScoreboard();
  showBanner(`${G.rivalP.name} v ${G.rival.name}`, cupRef ? `Cup ${ROUND_NAMES[cupRef.r].toLowerCase()}` : 'Exhibition · sit back and enjoy it', C.accent, 3);
  later(0.8, () => robotSay('start', true, P));
  later(2.4, () => robotSay('start', true, O));
  later(3.6, newPoint);
}

// opts: { rival, ladder, games, cupRef } (default: the quick-play robot for the chosen level)
function startMatch({ rival = rivalById(QUICK[settings.level]), ladder = false, games = null, cupRef = null } = {}) {
  clearPlay();
  G.mode = 'match';
  G.ladder = ladder;
  G.cupRef = cupRef;
  setRival(rival);
  G.match = new Match({ games: games ?? (ladder ? rival.games : settings.games), firstServer: Math.random() < 0.5 ? P : O });
  closeMenu();
  drawScoreboard();
  showBanner(cupRef ? `Cup ${ROUND_NAMES[cupRef.r].toLowerCase()}: ${rival.name}` : ladder ? `Ladder: ${rival.name}` : `You v ${rival.name}`, `${G.match.server === P ? 'You serve first' : `${rival.name} serves first`}${G.match.games > 1 ? ` · best of ${G.match.games}` : ''}`, hex(rival.look.accent), 2.4);
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

// -------------------------------------------------------------- lessons --
// Where you're standing, for the ghost demo (table space x and z).
function viewerSpot() {
  if (G.inXR) { const p = renderer.xr.getCamera().getWorldPosition(new V3()); return { x: p.x, z: p.z }; }
  return { x: 0, z: TB.halfL + 0.6 };
}

function showDemo(count = 1) {
  if (!G.lesson) return;
  const s = viewerSpot();
  ghost.play(G.lesson.def.stroke, { dx: s.x, dz: s.z - (TB.halfL + 0.6), left: settings.hand === 'left', count });
}

function startLesson(id) {
  const def = lessonById(id);
  if (!def) return;
  clearPlay();
  G.mode = 'lesson';
  G.lesson = { def, n: 0, good: 0, tip: def.how.join(' '), tipGood: null, hit: null, last: [] };
  desk.style = { topspin: 'topspin', push: 'push' }[def.stroke] ?? 'drive';   // the screen paddle's swing
  W.robot.root.visible = false;
  W.machine.root.visible = !def.serve;
  if (def.serve) { targets.root.visible = true; targets.list.forEach(placeTarget); }
  closeMenu();
  drawScoreboard();
  showBanner(`Lesson: ${def.name}`, 'Watch the ghost paddle first', C.accent, 3);
  showDemo(2);
  later(5.2, nextLessonBall);
}

function nextLessonBall() {
  const L = G.lesson;
  if (G.mode !== 'lesson' || !L) return;
  if (L.n >= LESSON_BALLS) return finishLesson();
  L.hit = null; L.judged = false;
  G.lastEventT = G.now;
  if (L.def.serve) {
    G.ref = new Referee(P, { casualServe: false });
    holdBall(P);
    showBanner(`Serve ${L.n + 1} of ${LESSON_BALLS}`, tossHint(), C.accent2, 2.2);
  } else {
    G.machine = new Machine({ ...L.def.feed, hand: settings.hand });
    const f = G.machine.feed();
    G.ball = f.ball;
    G.ballState = 'live';
    G.ref = new Referee(O, { casualServe: true });
    G.ref.event({ type: 'hit', who: O, t: G.now });
    W.machine.kick = 1;
    sfx.play('machine', G.ball.p);
  }
  drawScoreboard();
}

// The referee's view of the ball, turned into a lesson verdict.
function lessonAfterRef(res, info) {
  const L = G.lesson;
  if (!L || L.judged) return;
  let verdict = null;
  if (L.def.serve) {
    if (res?.retoss) { G.ballState = 'dead'; later(0.5, () => { if (G.ref?.stage === 'toss') holdBall(P); }); return; }
    if (info?.type === 'landed' && info.serve) {
      verdict = judgeServe({ landed: true });
      const hitT = info.p && targets.list.find(t => Math.hypot(t.g.position.x - info.p.x, t.g.position.z - info.p.z) < 0.17);
      if (hitT) { hitT.flash = 1; sfx.play('target', info.p); later(0.5, () => placeTarget(hitT)); verdict.text += ' And it hit a target!'; }
    } else if (res) verdict = judgeServe(res);
  } else if (info?.type === 'landed' && info.hitter === P) {
    verdict = judgeShot(L.def, L.hit, { landed: true });
  } else if (res && !res.retoss) {
    verdict = judgeShot(L.def, L.hit, { landed: false, reason: res.reason, missed: !L.hit });
  }
  if (verdict) lessonVerdict(verdict);
}

function lessonVerdict(v) {
  const L = G.lesson;
  L.judged = true;
  G.ballState = 'dead';
  L.tip = v.text; L.tipGood = v.retry ? null : v.good;
  if (v.retry) { drawScoreboard(); later(1.4, nextLessonBall); return; }
  L.n++;
  if (v.good) L.good++;
  L.last.push(v.good);
  sfx.play(v.good ? 'win' : 'lose');
  if (v.good) W.crowd.cheer(0.3);
  showBanner(v.good ? 'Good!' : 'Not quite', `${L.good} good out of ${L.n}`, v.good ? C.good : C.bad, 1.4);
  drawScoreboard();
  // Two misses in a row: show the stroke again.
  const twoBad = L.last.length >= 2 && !L.last[L.last.length - 1] && !L.last[L.last.length - 2];
  if (twoBad && !ghost.playing) later(1.0, () => showDemo(1));
  later(v.good ? 1.4 : twoBad ? 3.6 : 2.4, nextLessonBall);
}

function finishLesson() {
  const L = G.lesson, id = L.def.id;
  const stars = starsFor(L.good);
  const best = Math.max(stars, stats.lessons[id] ?? 0);
  const improved = stars > (stats.lessons[id] ?? 0);
  stats.lessons[id] = best;
  save('sh_stats', stats);
  L.done = true;
  L.tip = stars === 3 ? 'Brilliant! You\'ve got this stroke. Try the next lesson, or use it in a match.'
    : stars ? 'Good progress. Have another go to earn more stars.' : 'Keep at it: watch the ghost paddle, then try again.';
  L.tipGood = stars > 0;
  drawScoreboard();
  showBanner(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${L.def.name}`, `${L.good} of ${LESSON_BALLS} good${improved ? ' · new best!' : ''}`, stars === 3 ? '#d4af37' : C.accent, 4);
  if (stars === 3) { sound('fanfare'); burst(0.8); }
  later(4.5, () => { G.mode = 'menu'; openMenu('lessons'); });
}

// Wrap text into lines that fit `width` on a canvas.
function wrapText(g, text, width) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > width && line) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
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
  let a = serving && assist !== 'off' ? 1 : ASSIST[assist];
  // Lessons are a real test: no more than Light assist, and none on serves.
  if (G.mode === 'lesson') a = G.lesson?.def.serve ? 0 : Math.min(ASSIST[assist], ASSIST.light);
  if (who === P) G.lastHitInfo = { p: { ...G.ball.p }, v: { ...G.ball.v }, w: { ...G.ball.w }, padVel: tracker.vel, n: toP(tracker.n) };
  let assisted = false;
  if (a && !(serving && settings.serve === 'proper')) {
    const v = assistShot(G.ball, a, who === P ? 1 : -1);
    if (v) { G.ball.v = v; assisted = true; }
  }
  // The screen paddle's stroke styles add the spin a wrist brush would (see desk.js).
  if (who === P && !G.inXR && G.desk && desk.S.spin && G.ref.stage !== 'toss') G.ball.w.x += desk.S.spin;
  if (who === P && G.mode === 'lesson' && G.lesson && !G.lesson.def.serve && !G.lesson.hit) {
    G.lesson.hit = judgeHit(G.lesson.def, { contactX: G.ball.p.x, bodyX: viewerSpot().x, hand: settings.hand, w: G.ball.w });
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
  if (G.mode === 'lesson') return lessonAfterRef(res, info);
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
    if (G.cupRef) {
      const { r: cr, i: ci } = G.cupRef, cm = G.cup.rounds[cr][ci], youA = cm.a === YOU;
      const won = cupResult(cr, ci, you ? YOU : G.rival.id, m.history.map(s => (youA ? { a: s.P, b: s.O } : { a: s.O, b: s.P })));
      tab = 'cup';
      if (won) { title = 'CUP WINNERS!'; sub = `You beat ${them} in the final: ${games}`; }
      else if (you) sub = `${games} · through to the ${ROUND_NAMES[cr + 1].toLowerCase()}`;
      else sub = `${games} · out in the ${ROUND_NAMES[cr].toLowerCase()}`;
    }
    save('sh_stats', stats);
    G.lastResult = `${you ? 'You won' : `${them} won`} against ${them}: ${games}`;
    showBanner(title, sub, you ? (title === 'CHAMPION!' || title === 'CUP WINNERS!' ? '#d4af37' : C.good) : C.bad, 4.5);
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
    let tab = 'watch';
    if (G.cupRef) {
      // In a cup match the near robot (P) is the match's a side.
      const { r: cr, i: ci } = G.cupRef, cm = G.cup.rounds[cr][ci];
      cupResult(cr, ci, win === P ? cm.a : cm.b, G.match.history.map(s => ({ a: s.P, b: s.O })));
      tab = 'cup';
    }
    showBanner(`${name} wins!`, games, hex(rival(win).look.accent), 5);
    // Back to your own end of the table for the menu.
    later(6.5, () => { G.mode = 'menu'; robot2.root.visible = false; desk.outer.visible = true; setView(null); openMenu(tab); });
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
  // A game with them in it can't go on without them (one they only watch can).
  dropFriendFromGames();
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
  if (dropFriendFromGames()) openMenu('friend');
  showBanner(`${name} left`, reason, C.bad, 3);
  if (menu.mesh.visible) menu.redraw();
}
// The friend's gone (or you've stopped hosting): a game they're playing in
// ends; one they were only watching (your own cup game, robots') carries on
// here. True if a game ended.
function dropFriendFromGames() {
  const any = G.golfFriend || G.dartsFriend || G.bowlFriend;
  const seat = G.golfFriend ? G.golfFriendI : G.dartsFriend ? G.dartsFriendI : G.bowlFriend ? G.bowlFriendI : -1;
  G.golfFriend = G.dartsFriend = G.bowlFriend = false;
  friendAvatar.root.visible = false;
  if (G.mode === 'versus' || (any && seat >= 0)) { clearPlay(); G.mode = 'menu'; return true; }
  return false;
}

function onGuestData(m) {
  if (!m || typeof m !== 'object') return;
  if (G.net) G.net.heard = performance.now();
  if (m.t === 'bye') return friendLeft('They closed the game');
  if (m.t === 'join') {
    // ("You" would read as you on every scoreboard and banner.)
    const typed = String(m.name || '').trim().slice(0, 16);
    const name = !typed || /^you$/i.test(typed) || typed === HOST_NAME ? 'Player 2' : typed;
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
  } else if (m.t === 'gputt') {
    // The friend's putt on their turn (they're usually player 2; in a cup round of theirs, player 1).
    if (G.golfFriend && G.golfFriendI >= 0 && [m.dx, m.dz, m.speed].every(Number.isFinite)) golf.remotePutt(G.golfFriendI, m.dx, m.dz, m.speed);
  } else if (m.t === 'dthrow') {
    // The friend's dart (where on the board they let go); we throw it for them.
    if (G.dartsFriend) darts.remoteThrow(m);
  } else if (m.t === 'bshot') {
    // The friend's ball (where they let it go, how fast, the hook); we bowl it for them.
    if (G.bowlFriend) bowl.remoteShot(m);
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
// Mini golf with a friend: the round's state, plus (in VR) where your head and
// putter are, so they can see you on the course.
function streamGolf() {
  const msg = { t: 'g', s: golf.snapshot(), paused: G.paused, k: gameSpeed() };
  if (G.inXR && golf.putterRig.parent) {
    const r = v => Math.round(v * 1000) / 1000;
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(_p); cam.getWorldQuaternion(_q);
    msg.hh = [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w].map(r);
    golf.putterRig.getWorldPosition(_p); golf.putterRig.getWorldQuaternion(_q);
    msg.gp = [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w].map(r);
  }
  send(msg);
}

// Bowling with a friend: the game as it is now, plus (in VR) your head and hand.
function streamBowl() {
  const msg = { t: 'b', s: bowl.snapshot(), paused: G.paused && bowl.inProgress(), k: gameSpeed() };
  if (G.inXR && bowl.handRig.parent) {
    const r = v => Math.round(v * 1000) / 1000;
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(_p); cam.getWorldQuaternion(_q);
    msg.hh = [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w].map(r);
    bowl.handRig.getWorldPosition(_p);
    msg.hp = [_p.x, _p.y, _p.z].map(r);
  }
  send(msg);
}

function streamState() {
  if (G.role !== 'host') return;
  // 20 s of silence: they've gone (closing the page says goodbye straight away;
  // this is for a dropped connection, and allows for a browser slowing a background tab).
  if (G.net?.friend && performance.now() - (G.net.heard ?? performance.now()) > NET_TIMEOUT) return friendLeft('Lost the connection');
  if (!G.net?.link?.connected || ++sendTick % 2) return;
  if (G.golfFriend) return streamGolf();
  if (G.bowlFriend) return streamBowl();
  // Darts go one by one as they're thrown; between them, whether we've paused.
  // (Only while a game's going: once it's over the friend's screen plays out its last
  // darts and the result even if our menu is open. Leaving darts sends dend.)
  // (And how fast robot darts go, when you're both watching robots at 2× or 4×.)
  if (G.dartsFriend) { const k = gameSpeed(); if (sendTick % 30 === 0 || k !== G.sentSpeed) { G.sentSpeed = k; send({ t: 'dhb', paused: G.paused && darts.inProgress(), k }); } return; }
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
    // Mini golf with the host: we're player 2 and only send our putts.
    case 'gstart': guestGolf(true, m); break;
    // Darts with the host: we're player 2; every dart comes from the host.
    case 'dstart': if (G.mode === 'bowl') guestBowl(false); guestDarts(true, m); break;
    // Bowling with the host: we're player 2; the host's game streams to us, we send our ball.
    case 'bstart': guestBowl(true, m); break;
    case 'b': if (G.mode === 'bowl') { bowl.applyRemote(m.s); gs.bowl = m; } break;
    case 'bev': if (G.mode === 'bowl') bowl.remoteAnnounce(m.ev); break;
    // (Leaving a game: unless a result is still showing, say we're waiting.)
    case 'bend': if (G.mode === 'bowl') { guestBowl(false); if (bannerLeft <= 0) showBanner('Bowling over', 'Waiting for the host', C.accent2, 4); } break;
    case 'dart': if (G.mode === 'darts') darts.remoteDart(m); break;
    case 'dhb': gs.dartsPaused = !!m.paused; gs.speed = SPEEDS.includes(m.k) ? m.k : 1; break;
    // A darts cup result, worded for us: it shows after the match's own banner
    // (our game picks it up when its match ends; if that's been, it shows now).
    case 'dnote': {
      const n = m.note;
      if (!n || typeof n.title !== 'string') break;
      const note = { title: n.title.slice(0, 60), sub: String(n.sub ?? '').slice(0, 80), colour: String(n.colour ?? C.accent2) };
      if (G.mode === 'darts' && darts.phase !== 'done') gs.dnote = note;
      else setTimeout(() => showBanner(note.title, note.sub, note.colour, 3.4), 1500);
      break;
    }
    case 'dend': if (G.mode === 'darts') { guestDarts(false); if (bannerLeft <= 0) showBanner('Darts over', 'Waiting for the host', C.accent2, 4); } break;
    case 'g': if (G.mode !== 'golf') guestGolf(true, { course: m.s.course, names: gs.golfNames ?? [gs.hostName, gs.name], me: gs.golfMe ?? 1, robots: gs.golfRobots ?? [] }); if (G.mode === 'golf') { golf.applyRemote(m.s); gs.golf = m; } break;
    case 'gev': if (G.mode === 'golf') golf.remoteAnnounce(m.ev); break;
    case 'gend': guestGolf(false); if (bannerLeft <= 0) showBanner('Round over', 'Waiting for the host', C.accent2, 4); break;
    // A robot golfer's words (the host's game decides what it says).
    case 'say': {
      const rv = ALL_ROBOTS.find(r => r.id === m.r), model = [W.robot, robot2][m.m];
      if (G.mode === 'golf' && rv && model && typeof m.line === 'string') { G.speaker = model; robotSpeak(rv, m.line.slice(0, 160), O); }
      break;
    }
    // (The host's table tennis; while they play golf, darts or bowling without us
    // we just wait in the menu, and while we're in one of those with them, it's that.)
    case 's': gs.state = m; gs.recvT = performance.now(); G.mode = guestMode(m.mode); break;
    case 'score': G.match = m.m; G.mode = guestMode(m.mode); drawScoreboard(); break;
    case 'sfx': sfx.play(m.k, m.p && { x: m.p[0], y: m.p[1], z: m.p[2] }, m.s); break;
    case 'confetti': confetti.burst({ x: -0.9, y: 1.0, z: -0.4 }, 160, m.power); confetti.burst({ x: 0.9, y: 1.0, z: -0.4 }, 160, m.power); break;
    case 'msg': guestMessage(m); break;
  }
}

const OTHER_SPORTS = ['golf', 'darts', 'bowl'];
const guestMode = hostMode => (OTHER_SPORTS.includes(G.mode) ? G.mode : OTHER_SPORTS.includes(hostMode) ? 'menu' : String(hostMode));

// The guest switching into (or out of) the host's mini golf round.
let remotePutter = null;
function guestGolf(on, m = {}) {
  const gs = G.guest;
  if (on) {
    // names: the people putting (none: two robots in a cup round); me: which is
    // us (-1: we watch); robots: the robots putting too.
    if (!Array.isArray(m.names) || m.names.length > 2 || !GOLF_COURSES[m.course]) return;
    const names = m.names.map(n => String(n).slice(0, 16));
    const me = Number.isInteger(m.me) && m.me >= -1 && m.me < names.length ? m.me : names.length === 2 ? 1 : -1;
    const robots = (Array.isArray(m.robots) ? m.robots : []).slice(0, 2).map(id => ALL_ROBOTS.find(r => r.id === id)).filter(Boolean);
    if (G.mode === 'darts') guestDarts(false);
    if (G.mode === 'bowl') guestBowl(false);
    gs.golfNames = names; gs.golfMe = me; gs.golfRobots = robots.map(r => r.id);
    G.mode = 'golf';
    W.table.visible = false; scoreboard.mesh.visible = false; banner.mesh.visible = true;
    friendDesk.outer.visible = false; hostPaddle.group.visible = false; W.setBall(null);
    if (!remotePutter) { remotePutter = golf.makePutter(); scene.add(remotePutter.group); }
    golf.startRemote(m.course, names, me, robots);
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Drag back from the ball and let go' : 'Drag back from the ball with the mouse and let go';
    // The boards face the usual way in golf.
    banner.mesh.position.set(0, 2.05, -1.75); banner.mesh.rotation.set(0, 0, 0);
  } else {
    golf.stop();
    G.mode = 'menu';
    W.table.visible = true; scoreboard.mesh.visible = true;
    friendDesk.outer.visible = true; hostPaddle.group.visible = true; hostAvatar.root.visible = true;
    if (remotePutter) remotePutter.group.visible = false;
    // The robot golfers go (the friend's screen shows the host, not a robot, at the table).
    for (const r of [W.robot, robot2]) { r.root.visible = false; r.showPaddle(true); r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0); }
    G.speaker = null; bubble.hide();
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Drag to move your paddle · tap Serve when it\'s your serve' : 'Mouse = paddle · Space = toss when serving';
    placeBoards(); resetDeskCamera();
  }
}

// The guest switching into (or out of) the host's darts. The game runs here
// too, from the same start; the darts themselves all come from the host.
function guestDarts(on, m = {}) {
  const gs = G.guest;
  if (on) {
    const o = m.opts ?? {};
    // names: the people throwing (none: two robots in a cup match); me: which is us (-1: we watch).
    if (!['x01', 'cricket', 'killer'].includes(o.mode) || !Array.isArray(m.names) || m.names.length > 2) return;
    const names = m.names.map(n => String(n).slice(0, 16));
    const me = Number.isInteger(m.me) && m.me >= -1 && m.me < names.length ? m.me : 1;
    // Robots can be in it too: Killer's, or a cup match's (their darts come from the host).
    const robots = Array.isArray(m.robots) ? m.robots.slice(0, 2).map(id => ALL_ROBOTS.find(r => r.id === id)).filter(Boolean) : [];
    const n = names.length + robots.length;
    if (n < 2) return;
    if (G.mode === 'golf') guestGolf(false);
    if (G.mode === 'bowl') guestBowl(false);
    G.mode = 'darts';
    gs.dartsPaused = false; gs.speed = 1; gs.dnote = null;
    W.table.visible = false; scoreboard.mesh.visible = false; banner.mesh.visible = true;
    friendDesk.outer.visible = false; hostPaddle.group.visible = false; hostAvatar.root.visible = false; W.setBall(null);
    darts.start({
      mode: o.mode, start: [301, 501].includes(o.start) ? o.start : 501, doubleOut: !!o.doubleOut,
      legs: [1, 3, 5].includes(o.legs) ? o.legs : 1, lives: [3, 5].includes(o.lives) ? o.lives : 3, rivals: robots,
      label: typeof m.label === 'string' ? m.label.slice(0, 40) : undefined,
      remote: { names, me, host: false, first: Number.isInteger(m.first) && m.first >= 0 && m.first < n ? m.first : 0, numbers: Array.isArray(m.numbers) ? m.numbers : null },
    });
    darts.snapCamera();
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Touch the board to aim, hold still, lift your finger to throw' : 'Point at the board, press, let go when it\'s steady';
  } else {
    darts.stop();
    G.mode = 'menu';
    W.table.visible = true; scoreboard.mesh.visible = true;
    friendDesk.outer.visible = true; hostPaddle.group.visible = true; hostAvatar.root.visible = true;
    // Killer's robots go (the friend's screen shows the host, not a robot, at the table).
    for (const r of [W.robot, robot2, robot3]) { r.root.visible = false; r.showPaddle(true); r.root.position.set(0, 0, 0); }
    G.speaker = null; bubble.hide();
    banner.mesh.scale.setScalar(1);
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Drag to move your paddle · tap Serve when it\'s your serve' : 'Mouse = paddle · Space = toss when serving';
    fitCamera(); placeBoards(); resetDeskCamera();
  }
}

// The guest switching into (or out of) the host's bowling. The host's game
// streams to us (with the robot, if there is one); we send our ball.
function guestBowl(on, m = {}) {
  const gs = G.guest;
  if (on) {
    // names: the people bowling (none: two robots in a cup game); me: which is us (-1: we watch).
    if (!Array.isArray(m.names) || m.names.length > 2) return;
    const names = m.names.map(n => String(n).slice(0, 16));
    const me = Number.isInteger(m.me) && m.me < names.length ? m.me : names.length === 2 ? 1 : -1;
    const ids = Array.isArray(m.robots) ? m.robots : m.robot ? [m.robot] : [];
    const rivals = ids.slice(0, 2).map(id => ALL_ROBOTS.find(r => r.id === id)).filter(Boolean);
    if (G.mode === 'golf') guestGolf(false);
    if (G.mode === 'darts') guestDarts(false);
    G.mode = 'bowl';
    gs.bowl = null;
    W.table.visible = false; scoreboard.mesh.visible = false; banner.mesh.visible = true;
    friendDesk.outer.visible = false; hostPaddle.group.visible = false; hostAvatar.root.visible = false; W.setBall(null);
    const label = m.label ? { label: String(m.label).slice(0, 40) } : null;
    bowl.start({
      remote: { names, me, host: false }, rivals, frames: m.frames === 5 ? 5 : 10, bumpers: !!m.bumpers,
      ...(label ? { [m.kind === 'ladder' ? 'ladder' : 'cup']: label } : {}),
    });
    bowl.snapCamera();
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Slide to your spot, drag up the screen and lift your finger · curve it to hook' : 'Move along the line, press, drag up and let go · curve the drag to hook';
  } else {
    bowl.stop();
    G.mode = 'menu';
    W.table.visible = true; scoreboard.mesh.visible = true;
    friendDesk.outer.visible = true; hostPaddle.group.visible = true; hostAvatar.root.visible = true;
    // The robots go (the friend's screen shows the host, not a robot, at the table).
    for (const r of [W.robot, robot2]) { r.root.visible = false; r.showPaddle(true); r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0); }
    G.speaker = null; bubble.hide();
    banner.mesh.scale.setScalar(1);
    document.querySelector('#guest-hud .keys').textContent = isTouch() ? 'Drag to move your paddle · tap Serve when it\'s your serve' : 'Mouse = paddle · Space = toss when serving';
    fitCamera(); placeBoards(); resetDeskCamera();
  }
}

// Banners from the guest's point of view (the guest is O).
function guestMessage(m) {
  const host = G.guest.hostName;
  const you = m.winner === O;
  const reason = r => (m.loser === O ? r : `${host}: ${r.charAt(0).toLowerCase()}${r.slice(1)}`);
  switch (m.k) {
    case 'start':
      if (G.mode === 'golf') guestGolf(false);    // the host has switched back to table tennis
      if (G.mode === 'darts') guestDarts(false);
      if (G.mode === 'bowl') guestBowl(false);
      showBanner(`You v ${host}`, m.first === O ? 'You serve first' : `${host} serves first`, C.accent, 2.4); break;
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
  if (G.mode === 'darts') {
    const now = performance.now();
    if (!gs.ended && now - (gs.heard ?? now) > NET_TIMEOUT) { gs.ended = true; showBanner('Lost the host', 'Reload the page to join again', C.bad, 30); }
    // Long spells of watching (Killer's robots) send nothing, so keep the host sure we're here.
    if (now - (gs.lastSend ?? 0) > 1000) { gs.lastSend = now; G.net.link.send({ t: 'hb' }); }
    darts.update(dt * (gs.speed ?? 1), { xr: false, paused: !!gs.dartsPaused || !!gs.ended, holding: false });
    const ph = darts.phase, host = gs.hostName, DS = darts.state;
    // (In a cup match the host isn't in, it's yours against a robot, or two robots'.)
    const vs = DS.players.some(p => p.kind === 'remote') ? `Playing ${host}` : DS.opts?.label ?? DS.players.map(p => p.name).join(' v ');
    document.getElementById('guest-status').textContent = gs.ended ? 'Disconnected' : ph === 'done' ? 'Match over: waiting for the host'
      : gs.dartsPaused ? `${host} paused the game` : ph === 'aim' ? 'Your turn: point at the board, press, let go when it\'s steady'
        : ph === 'waiting' ? 'Throwing…' : ph === 'remote' ? `${host} is throwing`
          : ph === 'robot' ? `${DS.players[DS.game?.turn ?? 0]?.name ?? 'A robot'} is throwing` : vs;
    return;
  }
  if (G.mode === 'bowl') {
    // Bowling: draw the host's game; our ball goes to the host.
    const now = performance.now(), bm = gs.bowl;
    if (now - (gs.lastSend ?? 0) > 1000) { gs.lastSend = now; G.net.link.send({ t: 'hb' }); }
    if (!gs.ended && now - (gs.heard ?? now) > NET_TIMEOUT) { gs.ended = true; showBanner('Lost the host', 'Reload the page to join again', C.bad, 30); }
    bowl.update(dt * (SPEEDS.includes(bm?.k) ? bm.k : 1), { xr: false, paused: !!bm?.paused || !!gs.ended, holding: false });
    // The host, when they're in VR: their head, and the ball in their hand.
    hostAvatar.root.visible = !!bm?.hh;
    if (bm?.hh) {
      const [hx, hy, hz, qx, qy, qz, qw] = bm.hh, hp = { x: bm.hp[0], y: bm.hp[1], z: bm.hp[2] };
      hostAvatar.set({ x: hx, y: hy, z: hz }, new THREE.Quaternion(qx, qy, qz, qw).multiply(FLIP), hp);
      bowl.otherHand(hp);
    } else bowl.otherHand(null);
    const S = bowl.state, p = S.players[S.rolloff ? S.rolloff.turn : S.game?.turn ?? 0], host = gs.hostName;
    document.getElementById('guest-status').textContent = gs.ended ? 'Disconnected' : bm?.paused ? `${host} paused the game` : S.phase === 'done' ? 'Game over: waiting for the host'
      : S.phase === 'aim' && p?.kind === 'you' ? (S.sentAt ? 'Bowling…' : 'Your turn: move along the line, then drag up and let go')
        : p?.kind === 'you' ? 'Your ball' : p?.kind === 'robot' ? `${p.name} is bowling` : `${host} is bowling`;
    return;
  }
  if (G.mode === 'golf') {
    // Mini golf: draw the host's round; our putts go to the host.
    const gm = gs.golf;
    golf.update(dt * (SPEEDS.includes(gm?.k) ? gm.k : 1), { xr: false, paused: false });
    hostAvatar.root.visible = !!gm?.hh;
    if (remotePutter) remotePutter.group.visible = !!gm?.gp;
    if (gm?.hh) {
      const [hx, hy, hz, qx, qy, qz, qw] = gm.hh;
      remotePutter.group.position.set(gm.gp[0], gm.gp[1], gm.gp[2]);
      remotePutter.group.quaternion.set(gm.gp[3], gm.gp[4], gm.gp[5], gm.gp[6]);
      hostAvatar.set({ x: hx, y: hy, z: hz }, new THREE.Quaternion(qx, qy, qz, qw).multiply(FLIP), { x: gm.gp[0], y: gm.gp[1], z: gm.gp[2] });
    }
    const now = performance.now();
    // Golf sends nothing between putts, so keep the host sure we're still here.
    if (now - (gs.lastSend ?? 0) > 1000) { gs.lastSend = now; G.net.link.send({ t: 'hb' }); }
    if (!gs.ended && now - (gs.heard ?? now) > NET_TIMEOUT) { gs.ended = true; showBanner('Lost the host', 'Reload the page to join again', C.bad, 30); }
    const S = golf.state, p = S.players[S.turn];
    document.getElementById('guest-status').textContent = gs.ended ? 'Disconnected' : gm?.paused ? `${gs.hostName} paused the game` : S.phase === 'done' ? 'Round over: waiting for the host'
      : golf.myTurn() ? 'Your turn: drag back from the ball and let go' : `${p?.name ?? gs.hostName} is putting`;
    return;
  }
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
  if (!gs.ended && now - (gs.heard ?? now) > NET_TIMEOUT) { gs.ended = true; showBanner('Lost the host', 'Reload the page to join again', C.bad, 30); }
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
  if (c !== offCtrl()) return;
  // Watching robots: the free hand's trigger speeds them up (and back again).
  if (watchingRobots()) { cycleSpeed(); haptic(c, 0.4, 40); return; }
  // Mini golf: the free hand's trigger takes you to your ball.
  if (G.mode === 'golf') { if (golf.phase === 'aim') golf.goToBall(); return; }
  if (G.mode === 'darts' || G.mode === 'bowl') return;
  // In a lesson, the free hand's trigger replays the stroke (unless you're holding a ball to serve).
  if (G.mode === 'lesson' && G.ballState !== 'held') showDemo(1);
  else toss(P);
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
    // Darts: the throwing hand holds its dart while the trigger or grip is down.
    // (So does the bowling hand its ball.)
    if (c === paddleCtrl()) G.dartHold = !menu.mesh.visible && (btn(0) || btn(1));
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
    if (G.mode === 'menu') setView(null);     // the menu's standing spot is for VR only
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
const ndcOf = e => new THREE.Vector2(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
// Darts aim a little above a finger, so it doesn't hide the board.
const dartNdc = e => ndcOf(e.pointerType === 'touch' ? { clientX: e.clientX, clientY: e.clientY - 70 } : e);
const pxOf = e => ({ x: e.clientX, y: e.clientY });
renderer.domElement.addEventListener('pointermove', e => {
  if (G.mode === 'golf' && !menu.mesh.visible && !G.inXR) { desk.mouse.copy(ndcOf(e)); golf.pointerMove(ndcOf(e)); return; }
  if (G.mode === 'darts' && !menu.mesh.visible && !G.inXR) { desk.mouse.copy(ndcOf(e)); darts.pointerMove(dartNdc(e)); return; }
  if (G.mode === 'bowl' && !menu.mesh.visible && !G.inXR) { desk.mouse.copy(ndcOf(e)); bowl.pointerMove(ndcOf(e), pxOf(e)); return; }
  aimAt(e);
});
renderer.domElement.addEventListener('pointerup', () => {
  if (G.mode === 'golf' && !G.inXR) golf.pointerUp();
  if (G.mode === 'darts' && !G.inXR) darts.pointerUp();
  if (G.mode === 'bowl' && !G.inXR) bowl.pointerUp();
});
renderer.domElement.addEventListener('pointerdown', e => {
  sfx.unlock();
  // Mini golf on a screen: press, drag back from the ball, let go.
  if (G.mode === 'golf' && !menu.mesh.visible && !G.inXR) { golf.pointerDown(ndcOf(e)); return; }
  // Darts: press to steady your aim, let go to throw.
  if (G.mode === 'darts' && !menu.mesh.visible && !G.inXR) { darts.pointerDown(dartNdc(e)); return; }
  // Bowling: press, drag up the screen and let go.
  if (G.mode === 'bowl' && !menu.mesh.visible && !G.inXR) { bowl.pointerMove(ndcOf(e), pxOf(e)); bowl.pointerDown(ndcOf(e), pxOf(e)); return; }
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
  else if (e.code === 'KeyD' && G.mode === 'lesson') showDemo(1);
  else if (e.code === 'KeyF' && watchingRobots()) cycleSpeed();
});

function deskUpdate(dt) {
  raycaster.setFromCamera(desk.mouse, camera);
  if (menu.mesh.visible) {
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    menu.hover(hit ? hit.uv : null);
  }
  if (G.mode === 'golf' || G.mode === 'darts' || G.mode === 'bowl') return;          // the other sports handle their own pointer
  const p = new V3();
  if (!G.autoplay && raycaster.ray.intersectPlane(deskPlane, p)) desk.aim(p.x, p.y);
  const b = G.ball;
  // Test hook (__sh.autoplay = true): the paddle plays by itself.
  if (G.autoplay && G.ballState === 'held' && G.holder === P && !G.paused) toss(P);
  if (G.autoplay && b && G.ballState === 'live' && G.ref?.due === P) desk.plan(b, `${G.ref.hits}:${G.lastEventT.toFixed(3)}`);
  desk.update(dt, {
    ball: b, inPlay: !G.paused && (G.ballState === 'live' || G.ballState === 'toss'), due: G.ref?.due === P, tossed: G.ballState === 'toss',
    properServe: G.ref ? !G.ref.casualServe : false,
  });
}

// ------------------------------------------------------- watching speed --
// Watching robots play (an exhibition, or a cup game between robots), the game
// can go 2 or 4 times as fast. (Never when a person is playing in it.)
function watchingRobots() {
  if (G.role === 'guest') return false;
  if (G.mode === 'exhibition') return !!G.match && !G.match.over;
  const S = G.mode === 'golf' && golf.active ? golf.state : G.mode === 'darts' && darts.active ? darts.state : G.mode === 'bowl' && bowl.active ? bowl.state : null;
  return !!S && S.phase !== 'done' && S.players.length > 0 && S.players.every(p => p.kind === 'robot');
}
const gameSpeed = () => (watchingRobots() && SPEEDS.includes(settings.watchSpeed) ? settings.watchSpeed : 1);
function setSpeed(k) {
  settings.watchSpeed = SPEEDS.includes(k) ? k : 1;
  save('sh_settings', settings);
  speedBtn.textContent = `⏩ ${settings.watchSpeed}×`;
}
// The ⏩ button, the F key or (VR) the free hand's trigger: 1×, 2×, 4×, 1×...
function cycleSpeed() {
  setSpeed(SPEEDS[(SPEEDS.indexOf(settings.watchSpeed) + 1) % SPEEDS.length]);
  const k = settings.watchSpeed;
  showBanner(k === 1 ? 'Normal speed' : `${k}× speed`, k === 4 ? 'Again for normal speed' : 'Again to go faster', C.accent2, 1.4);
  if (menu.mesh.visible) menu.redraw();
}
const speedBtn = document.getElementById('speed-btn');
speedBtn.textContent = `⏩ ${settings.watchSpeed}×`;
speedBtn.onclick = () => { sfx.unlock(); cycleSpeed(); };
// (Shown on a screen while you watch, out of the menu.)
function showSpeedButton() {
  const on = !G.inXR && !G.paused && watchingRobots();
  if (speedBtn.hidden === on) speedBtn.hidden = !on;
}

// ---------------------------------------------------------------- frame --
let lastT = 0;
renderer.setAnimationLoop(onFrame);
const _hp = new V3(), _cp = new V3(), _cq = new THREE.Quaternion();
let hallSign = 'TABLE TENNIS';     // what the far wall's sign says
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
    // Watching robots at 2× or 4×: the game runs that much further each frame
    // (bowling in steps, so the pins topple as usual).
    const k = gameSpeed();
    if (G.mode === 'golf') golf.update(dt * k, { xr: G.inXR, paused: G.paused, holder: golf.putterRig.parent });
    else if (darts.active) darts.update(dt * k, { xr: G.inXR, mr: G.mr, paused: G.paused || G.mode !== 'darts', holding: G.dartHold });
    else if (bowl.active) for (let i = 0; i < k; i++) bowl.update(dt, { xr: G.inXR, paused: G.paused || G.mode !== 'bowl', holding: G.dartHold });
    else if (!G.paused) simulate(dt * k);
    if (G.ballState === 'held' && G.ball) G.ball.p = heldBallPos();

    W.setBall(G.ball ? G.ball.p : null, G.ball ? PH.len(G.ball.v) : 0);
    if (!G.paused) { G.bot.update(dt * k, G.now); G.botP.update(dt * k, G.now); }
    if (W.robot.root.visible && !darts.active && !golf.active && !bowl.active) W.robot.update(G.bot, G.ball?.p ?? null, dt * k);
    if (robot2.root.visible && !darts.active && !golf.active && !bowl.active) robot2.update(G.botP, G.ball?.p ?? null, dt * k);
    showSpeedButton();
    if (friendAvatar.root.visible && G.dartsFriend) {
      // Darts: your friend stands beside you and steps up to throw (arm up, then a flick).
      const f = darts.friend;
      if (f) {
        const flick = f.since < 0.35, armY = f.up ? (flick ? 1.72 : 1.64) : 1.0, armZ = f.up ? (flick ? -0.38 : -0.12) : -0.08;
        friendAvatar.set({ x: f.pos.x, y: 1.62, z: f.pos.z }, _cq.setFromAxisAngle(new V3(0, 1, 0), Math.PI), { x: f.pos.x + 0.22, y: armY, z: f.pos.z + armZ });
      }
    } else if (friendAvatar.root.visible && G.bowlFriend) {
      // Bowling: your friend waits by the ball return, then steps up to the line,
      // and their arm follows through once the ball's away.
      const f = bowl.friend;
      if (f) {
        const armY = f.thrown ? 1.3 : f.up ? 0.72 : 0.95, armZ = f.thrown ? -0.45 : -0.08;
        friendAvatar.set({ x: f.pos.x, y: 1.62, z: f.pos.z }, _cq.setFromAxisAngle(new V3(0, 1, 0), Math.PI), { x: f.pos.x + 0.2, y: armY, z: f.pos.z + armZ });
      }
    } else if (friendAvatar.root.visible) {
      friendPaddle.group.getWorldPosition(_hp);
      const hx = friendDesk.target.x * 0.55;
      const look = G.ball ? Math.atan2(G.ball.p.x - hx, G.ball.p.z + TB.halfL + 0.75) * 0.5 : 0;
      friendAvatar.set({ x: hx, y: 1.6, z: -(TB.halfL + 0.75) }, _cq.setFromAxisAngle(new V3(0, 1, 0), look), _hp);
    }
    streamState();
  }

  // Shared visuals.
  const sign = golf.active || golf.state.preview ? 'MINI GOLF' : darts.active || darts.state.preview ? 'DARTS'
    : bowl.active || bowl.state.preview ? 'BOWLING' : 'TABLE TENNIS';
  if (sign !== hallSign) { hallSign = sign; W.setSign(sign); }
  W.crowd.update(dt);
  confetti.update(dt);
  trophy.update(dt);
  ghost.update(dt);
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
  // Bubbles are sized for a robot across the table; one standing beside you
  // (darts) gets a smaller bubble, nearer its head, not one in your face.
  cam.getWorldPosition(_cp);
  const sayAt = (b, r) => {
    r.headPos(_hp);
    const k = Math.min(1, Math.max(0.3, _hp.distanceTo(_cp) / 3.4));
    b.mesh.scale.setScalar(k);
    b.update(dt, _hp.addScaledVector(side, k), _cq);
  };
  const sp = speaker();
  if (sp.root.visible) sayAt(bubble, sp);
  else bubble.hide();      // (its robot's away: golf, or the darts menu)
  if (robot2.root.visible && !darts.active) sayAt(bubble2, robot2);

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
  // Paddle settings shared by a friend (?feel=...): ask before using them.
  const offered = decodeFeel(new URLSearchParams(location.search).get('feel'));
  if (offered) {
    const f = offered.feel, box = $('feel-offer');
    $('feel-offer-text').textContent = `Sweet spot ${Math.round(f.size * 200)} cm · bounce ${Math.round(f.bounce * 100)}% · spin grip ${Math.round(f.grip * 100)}% · swing power ${Math.round(f.power * 100)}% · smoothing ${Math.round(f.smooth * 100)}% · paddle angle ${offered.angle}°`;
    box.hidden = false;
    const done = text => {
      box.querySelector('.row').remove();
      $('feel-offer-text').textContent = text;
      const u = new URL(location.href); u.searchParams.delete('feel');
      history.replaceState(null, '', u);
    };
    $('feel-yes').onclick = () => {
      settings.feel = { ...offered.feel }; settings.angle = offered.angle;
      save('sh_settings', settings); applyFeel(); applyAngle();
      done('Done: you\'re using their paddle settings. Settings > Paddle feel has a Reset button.');
    };
    $('feel-no').onclick = () => { done('No changes made.'); setTimeout(() => { box.hidden = true; }, 1500); };
  }
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
menuScene();
menu.redraw();
menu.mesh.visible = false;

// Handy for testing from the console.
window.__sh = {
  debugXR: () => ({ needRecentre, tablePose: { ...tablePose }, hasBase: !!baseSpace, custom: renderer.xr.getReferenceSpace() !== baseSpace }),
  get golf() { return golf; }, startGolf, get darts() { return darts; }, startDarts, get bowl() { return bowl; }, startBowling, startBowlPractice, startBowlVersus, bcupPlayNext,
  gcupPlayNext, dcupPlayNext, startGolfLadder, startDartsLadder, watchingRobots, setSpeed, cycleSpeed,
  G, PH, desk, friendDesk, sfx, advance, settings, stats, W, startMatch, startPractice, startVersus, startHosting, openMenu, closeMenu, toss, pose,
  ctrls, renderer, camera, scene, menu, onMenuClick, enterXR, robotSay, burst, rivalById, startGuest,
};
