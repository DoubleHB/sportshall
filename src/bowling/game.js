// Bowling: the lane, the pins and the ball, turns for people and a robot, the
// scoreboard over the lane. In VR the ball sits in your paddle hand: hold the
// trigger (or grip), swing and let go; twist your wrist as you let go to hook
// it. On a screen, move along the foul line, press, drag up the screen and let
// go (curve the drag to hook it).
// Also: cup games (a tie goes to a roll-off), spare practice (a leave set up on
// its own, one ball at it), and games with a friend on another screen (the
// host runs the game and streams it; the friend's screen draws it and sends
// back their ball). What happens goes through announce(), so each screen words
// it for its own player.
import * as THREE from 'three';
import { LANE, BALL_R, PIN_R, PIN_H, PIN_SPOTS, ARROWS } from './lane.js';
import { Bowling, marks } from './rules.js';
import * as BP from './physics.js';
import { robotShot, bowlLine, BOWL_TALK_CHANCE } from './robots.js';
import { SPARES, spareById, spareRound, ROUND_SPARES } from './practice.js';
import { releaseVelocity } from '../darts/flight.js';
import { CanvasBoard, roundRect, FONT, C } from '../panel.js';

// Where you stand: on the approach, a step behind the foul line.
export const BOWL_VIEW = { x: LANE.x, z: LANE.foulZ + 1.0, th: 0, lift: 0 };
const WAIT = { x: LANE.x - 1.35, z: LANE.foulZ + 1.1 };     // where a robot waits its turn
const FRIEND_WAIT = { x: LANE.x + 1.0, z: LANE.foulZ + 0.5 };   // and a friend (in front of the ball return)
const BALL_STATES = ['lane', 'gutter', 'pit', 'gone'];
// In VR, where you watch the robot's ball from (it bowls from where you stand).
const WATCH_VIEW = { x: LANE.x - 1.75, z: LANE.foulZ + 1.35, th: -0.16, lift: 0 };
const BALL_COLOURS = [0x2f6df0, 0xff7a1a, 0x58d68d, 0xc77dff];
const hexStr = n => `#${n.toString(16).padStart(6, '0')}`;
const ADJ = 0.32;            // pins this close are neighbours (for spotting splits)
const ASSIST = { off: { k: 0, reach: 0 }, light: { k: 0.5, reach: 0.15 }, full: { k: 0.85, reach: 0.3 } };

export function createBowling(ctx) {
  const { scene, camera, sfx, showBanner, settings, stats, save } = ctx;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  // ------------------------------------------------------------- the lane --
  const canvasTex = (w, h, draw, repeat = null) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    return t;
  };
  // Maple boards, the arrows and the foul line, drawn on one long texture.
  const laneLen = LANE.foulZ - LANE.deckEnd;
  const laneTex = canvasTex(512, 4096, (g, w, h) => {
    const k = h / laneLen, z2y = z => (LANE.foulZ - z) * k, x2px = x => (x - LANE.x + LANE.halfW) / (2 * LANE.halfW) * w;
    for (let b = 0; b < 39; b++) {
      const l = 70 + Math.random() * 12;
      g.fillStyle = `hsl(32, 45%, ${l}%)`; g.fillRect(b * w / 39, 0, w / 39 + 1, h);
      g.fillStyle = 'rgba(90,55,20,0.25)'; g.fillRect(b * w / 39, 0, 1, h);
    }
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(120,70,20,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 8 + Math.random() * 40); }
    // The pin deck is lighter.
    g.fillStyle = 'rgba(255,240,215,0.35)'; g.fillRect(0, z2y(LANE.headZ + 0.35), w, h);
    // Arrows and the guide dots.
    g.fillStyle = '#3a2412';
    for (const a of ARROWS) { const x = x2px(a.x), y = z2y(a.z); g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x - 7, y + 12); g.lineTo(x + 7, y + 12); g.closePath(); g.fill(); }
    for (const b of [-15, -10, -5, 5, 10, 15]) { g.beginPath(); g.arc(x2px(LANE.x + b * LANE.halfW * 2 / 39), z2y(LANE.foulZ - 2.0), 4, 0, Math.PI * 2); g.fill(); }
    // Pin spots.
    g.fillStyle = 'rgba(60,40,20,0.5)';
    for (const s of PIN_SPOTS) { g.beginPath(); g.arc(x2px(s.x), z2y(s.z), 6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, 10);            // the foul line
  });
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE.halfW * 2, laneLen), new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.25, metalness: 0.05 }));
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(LANE.x, 0.012, (LANE.foulZ + LANE.deckEnd) / 2);
  root.add(lane);
  // The approach: wider, paler wood.
  const approach = new THREE.Mesh(new THREE.PlaneGeometry(LANE.outer * 2 + 0.6, LANE.approachEnd - LANE.foulZ),
    new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w, h) => {
      for (let b = 0; b < 16; b++) { g.fillStyle = `hsl(35, 40%, ${76 + Math.random() * 8}%)`; g.fillRect(b * w / 16, 0, w / 16 + 1, h); }
    }), roughness: 0.4 }));
  approach.rotation.x = -Math.PI / 2;
  approach.position.set(LANE.x, 0.012, (LANE.foulZ + LANE.approachEnd) / 2);
  root.add(approach);
  // Gutters: shallow dark troughs either side, and the capping between lanes.
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    // (The lower half of a tube along the lane, squashed shallow.)
    const gutter = new THREE.Mesh(new THREE.CylinderGeometry(LANE.gutterW / 2, LANE.gutterW / 2, laneLen, 16, 1, true, -Math.PI / 2, Math.PI), gutterMat);
    gutter.rotation.x = Math.PI / 2;
    gutter.scale.set(1, 1, 0.45);
    gutter.position.set(LANE.x + s * (LANE.halfW + LANE.gutterW / 2), 0.014, (LANE.foulZ + LANE.deckEnd) / 2);
    root.add(gutter);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, laneLen + (LANE.approachEnd - LANE.foulZ)), new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.5 }));
    cap.position.set(LANE.x + s * (LANE.outer + 0.06), 0.04, (LANE.approachEnd + LANE.deckEnd) / 2);
    root.add(cap);
    // Kickbacks: the side walls by the pins.
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, LANE.headZ + 0.45 - LANE.pitEnd), new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.6 }));
    kick.position.set(LANE.x + s * (LANE.outer + 0.02), 0.25, (LANE.headZ + 0.45 + LANE.pitEnd) / 2);
    root.add(kick);
  }
  // The pit, and the masking unit over the pins.
  const pit = new THREE.Mesh(new THREE.BoxGeometry(LANE.outer * 2, 0.3, LANE.deckEnd - LANE.pitEnd), new THREE.MeshStandardMaterial({ color: 0x07080b }));
  pit.position.set(LANE.x, 0.0, (LANE.deckEnd + LANE.pitEnd) / 2);
  root.add(pit);
  const maskTex = canvasTex(1024, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#16233f'); grd.addColorStop(0.5, '#25407a'); grd.addColorStop(1, '#16233f');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff7a1a'; g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#fff'; g.font = `900 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STRIKE ZONE', w / 2, h / 2 - 6);
  });
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(LANE.outer * 2 + 0.3, 0.55), new THREE.MeshStandardMaterial({ map: maskTex, roughness: 0.6 }));
  mask.position.set(LANE.x, 1.05, LANE.headZ - 0.85);
  root.add(mask);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(LANE.outer * 2 + 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x0a0d14 }));
  back.position.set(LANE.x, 0.4, LANE.pitEnd);
  root.add(back);
  // A ball return beside the approach, with a few balls on it.
  const ret = new THREE.Group();
  ret.position.set(LANE.x + LANE.outer + 0.45, 0, LANE.foulZ + 1.1);
  const retBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.9), new THREE.MeshStandardMaterial({ color: 0x223355, roughness: 0.5 }));
  retBody.position.y = 0.275; ret.add(retBody);
  BALL_COLOURS.slice(1).forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.2 }));
    b.position.set(0, 0.55 + BALL_R, -0.28 + i * 0.25); ret.add(b);
  });
  root.add(ret);

  // ------------------------------------------------------- pins and balls --
  const pinGeo = (() => {
    const prof = [[0, 0], [0.026, 0], [0.035, 0.02], [0.05, 0.07], [0.0605, 0.115], [0.057, 0.16], [0.042, 0.215], [0.024, 0.255], [0.021, 0.27], [0.026, 0.31], [0.031, 0.345], [0.027, 0.37], [0.015, 0.38], [0, 0.381]];
    return new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24);
  })();
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.25 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd6312b, roughness: 0.3 });
  const pinMeshes = PIN_SPOTS.map(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pinGeo, pinMat));
    for (const y of [0.262, 0.282]) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.0225, 0.004, 6, 20), stripeMat); s.rotation.x = Math.PI / 2; s.position.y = y; g.add(s); }
    root.add(g);
    return g;
  });
  const ballTex = colour => canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = hexStr(colour); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`; g.lineWidth = 2 + Math.random() * 6; g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); g.bezierCurveTo(Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h); g.stroke(); }
    g.fillStyle = '#111'; for (const [x, y] of [[0.47, 0.42], [0.53, 0.42], [0.5, 0.6]]) { g.beginPath(); g.arc(x * w, y * h, 5, 0, Math.PI * 2); g.fill(); }
  });
  function makeBall(colour) {
    return new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ map: ballTex(colour), roughness: 0.12, metalness: 0.15 }));
  }
  const ballMesh = makeBall(BALL_COLOURS[0]);
  ballMesh.visible = false;
  root.add(ballMesh);
  // The ball in your hand in VR (hangs under the paddle hand's grip).
  const handRig = makeBall(BALL_COLOURS[0]);
  handRig.position.set(0, -0.085, 0.02);
  handRig.visible = false;
  // A robot's ball, in its hand.
  const robotBall = makeBall(BALL_COLOURS[1]);
  robotBall.visible = false;
  root.add(robotBall);
  // On a friend's screen: the ball in the host's hand (when the host's in VR).
  const otherBall = makeBall(BALL_COLOURS[0]);
  otherBall.visible = false;
  root.add(otherBall);
  // On a screen: where the ball will start (it slides along the foul line with the mouse).
  const screenBall = makeBall(BALL_COLOURS[0]);
  screenBall.visible = false;
  root.add(screenBall);
  const AIM_DOTS = 26;
  const aimDots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(new Array(AIM_DOTS).fill(0).map(() => new THREE.Vector3())), new THREE.PointsMaterial({ color: 0xff9a00, size: 7, sizeAttenuation: false, transparent: true, opacity: 0.95 }));
  aimDots.visible = false; aimDots.frustumCulled = false;
  root.add(aimDots);
  const recolour = (m, c) => { if (m.userData.c !== c) { m.material.map?.dispose(); m.material.map = ballTex(c); m.material.needsUpdate = true; m.userData.c = c; } };

  // The scoreboard: over the lane facing you in VR, a corner of the screen
  // otherwise. Its height fits the number of bowlers (made at the start of a game).
  const ROW_PX = 112, cardPx = n => 74 + n * ROW_PX;
  let card = null, cardH = 0;
  function makeCard(n) {
    if (card) { root.remove(card.mesh); card.mesh.geometry.dispose(); card.tex.dispose(); }
    cardH = cardPx(n) / 1000;
    card = new CanvasBoard(1.9, cardH, 1900, cardPx(n));
    card.mesh.renderOrder = 5;
    root.add(card.mesh);
  }
  makeCard(2);

  // ---------------------------------------------------------------- state --
  const S = {
    phase: 'idle',           // idle | aim | rolling | robot | between | done
    game: null, players: [], opts: {}, t: 0, timers: [],
    ball: null, pins: [], stand: null,   // the ball in play, the pins on the deck, which are standing (indices)
    hold: null, press: null, aimX: LANE.x, log: [], cam: null, evs: [],
    preview: false,
    practice: null,          // spare practice: { round, list (spare ids), i, made, tried }
    rolloff: null,           // a cup game's tie-break: { balls: [[], []], turn }
    remote: false,           // the friend's screen: the host's game, drawn from what it sends
    rackN: 0,                // racks set so far (a friend's screen resets its pins when this changes)
    friendPos: { ...FRIEND_WAIT },
  };
  const later = (sec, fn) => S.timers.push({ t: S.t + sec, fn });
  // Whose ball it is (an index into S.players).
  const turnIdx = () => (S.rolloff ? S.rolloff.turn : S.practice ? 0 : S.game?.turn ?? 0);
  const player = () => S.players[turnIdx()];
  const isYou = p => p?.kind === 'you';
  const robotP = () => S.players.find(p => p.kind === 'robot') ?? null;
  // (On a friend's screen, not again while the ball we've sent is on its way to the host.)
  const yourGo = () => S.phase === 'aim' && isYou(player()) && !(S.remote && S.sentAt && S.t - S.sentAt < 3);
  const mine = () => S.players.filter(isYou).length === 1;
  const nameOf = p => (isYou(p) && mine() ? 'You' : p.name);
  // Sounds (heard on a friend's screen too: ctx.sfx sends them).
  const sound = (k, p = null, v) => sfx.play(k, p, v);

  // opts: { players (people sharing this screen), rival (a robot or null), frames, bumpers,
  //   cup: { label } (a cup game: a tie goes to a roll-off),
  //   remote: { names, me, host } (a game with a friend on another screen: names in
  //   turn order, which of them is us, and whether we're the host) }
  function start(opts) {
    stopAll();
    S.preview = false; S.practice = null; S.rolloff = null;
    S.opts = opts;
    const R = opts.remote;
    S.remote = !!R && !R.host;
    if (R) S.players = R.names.map((n, i) => ({ name: i === R.me ? 'You' : String(n), kind: i === R.me ? 'you' : 'remote', colour: BALL_COLOURS[i] }));
    else {
      const people = Math.max(1, opts.players ?? 1);
      S.players = Array.from({ length: people }, (_, i) => ({ name: people === 1 ? 'You' : `Player ${i + 1}`, kind: 'you', colour: BALL_COLOURS[i] }));
    }
    if (opts.rival) S.players.push({ name: opts.rival.name, kind: 'robot', rival: opts.rival, colour: opts.rival.look.accent, model: ctx.robot, pos: { ...WAIT }, hand: new THREE.Vector3(), bot: { side: 1, pad: { x: 0.8, y: 1.0, z: 0 }, swing: 0, mood: 0 } });
    S.game = new Bowling({ players: S.players.length, frames: opts.frames ?? 10 });
    makeCard(S.players.length);
    S.t = 0; S.timers = []; S.streak = S.players.map(() => 0); S.cardKey = null; S.sentAt = 0;
    S.friendPos = { ...FRIEND_WAIT };
    const rp = robotP();
    if (rp) {
      rp.model.root.visible = true; rp.model.root.rotation.set(0, 0, 0); rp.model.showPaddle(false); rp.model.setLook(rp.rival.look);
      recolour(robotBall, rp.colour);
    }
    root.visible = true;
    newRack();
    S.phase = 'between';
    drawCard();
    if (S.remote) return;          // the host runs it: we're sent what happens
    announce({ k: 'start' });
    if (rp) later(1.0, () => talk('start', true));
    later(2.8, beginBall);
  }

  // Spare practice: which is a spare's id (that one, again and again) or 'round'
  // (ten spares, one ball each).
  function startPractice(which) {
    stopAll();
    S.preview = false; S.rolloff = null; S.remote = false;
    S.opts = { bumpers: false };
    S.players = [{ name: 'You', kind: 'you', colour: BALL_COLOURS[0] }];
    S.game = null;
    const round = which === 'round';
    S.practice = { round, list: round ? spareRound() : [spareById(which)?.id ?? SPARES[0].id], i: 0, made: 0, tried: 0 };
    makeCard(1);
    S.t = 0; S.timers = []; S.streak = [0];
    root.visible = true;
    newRack(spareById(S.practice.list[0]).pins);
    S.phase = 'between';
    const sp = spareById(S.practice.list[0]);
    showBanner(round ? 'Spare round' : 'Spare practice', round ? `${ROUND_SPARES} spares, one ball at each` : `${sp.name}, as many times as you like`, C.accent, 2.4);
    drawCard();
    later(2.4, beginBall);
  }
  const practiceSpare = () => spareById(S.practice.list[S.practice.i]);

  function newRack(stand = null) {
    S.stand = stand ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    S.pins = BP.rack(S.stand);
    S.rackN++;
    pinMeshes.forEach((m, i) => { m.visible = S.stand.includes(i); m.position.set(PIN_SPOTS[i].x, 0.012, PIN_SPOTS[i].z); m.quaternion.identity(); });
  }

  function beginBall() {
    const p = player(), g = S.game;
    S.ball = null; ballMesh.visible = false;
    if (S.practice) {
      const sp = practiceSpare();
      showBanner(sp.name, sp.tip, C.accent2, 2.6);
    }
    // Whose frame it is, when there's more than one of you.
    else if (S.players.length > 1 && (g.ball === 0 || S.rolloff)) announce({ k: 'turn', who: turnIdx(), frame: g.frame, last: g.last, ro: !!S.rolloff });
    if (p.kind === 'robot') {
      S.phase = 'robot';
      S.rob = { step: 'walk', t: 0, shot: null };
    } else {
      S.phase = 'aim';
      if (isYou(p)) { recolour(handRig, p.colour); recolour(screenBall, p.colour); }
    }
    // In VR you step aside for a robot or a friend, and back for your own ball.
    if (ctx.isXR() && S.players.some(q => !isYou(q))) ctx.setView?.(isYou(p) ? BOWL_VIEW : WATCH_VIEW);
    drawCard();
  }

  // ---------------------------------------------------------- a ball goes --
  function bowl(shot, who) {
    S.ball = BP.launch(shot.x, shot.vx, shot.vz, shot.spin, shot.z ?? LANE.foulZ - 0.05);
    S.ball.y = shot.y ?? BALL_R; S.ball.who = who; S.ball.x0 = shot.x;
    S.ball.hit = false; S.ball.gutter = false;
    recolour(ballMesh, S.players[who].colour);
    ballMesh.visible = true;
    ballMesh.position.set(S.ball.x, S.ball.y, S.ball.z);
    S.phase = 'rolling'; S.rollT = 0;
    if ((shot.y ?? 0) > BALL_R + 0.12) sound('thud', { x: shot.x, y: 0, z: S.ball.z }, 0.6);
    sound('roll', { x: shot.x, y: 0, z: S.ball.z - 3 }, Math.min(1, 9 / Math.max(3, -shot.vz) / 2));
    drawCard();
  }

  // The physics while the ball's going (and the pins settle).
  function stepPlay(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.002)), h = dt / n;
    for (let i = 0; i < n; i++) BP.step(S.ball, S.pins, h, S.evs, { bumpers: !!S.opts.bumpers });
    for (const e of S.evs) {
      if (e.type === 'gutter') { S.ball.gutter = true; sound('thud', { x: S.ball.x, y: 0, z: S.ball.z }, 0.7); }
      else if (e.type === 'bumper') sound('clack', { x: S.ball.x, y: 0.1, z: S.ball.z }, 0.6);
      else if (e.type === 'pin' && !S.ball.hit) {
        S.ball.hit = true;
        const strong = S.pins.length >= 6;
        sound('pins', { x: LANE.x, y: 0.3, z: LANE.headZ }, strong ? 1 : 0.6);
      }
    }
    S.evs.length = 0;
    S.rollT += dt;
    if (BP.settled(S.ball, S.pins) || S.rollT > 6) { S.phase = 'between'; later(0.6, scoreBall); }
  }

  // The pinsetter: clear the fallen pins and set up for the next ball.
  function nextBall(stand, wait) {
    later(wait, () => {
      ballMesh.visible = false;
      newRack(stand);
      sound('machine', { x: LANE.x, y: 0.5, z: LANE.headZ }, 0.5);
      later(0.9, beginBall);
    });
  }

  function scoreBall() {
    const before = S.stand;
    const down = before.filter(i => S.pins.find(q => q.i === i)?.down);
    const left = before.filter(i => !down.includes(i));
    if (S.practice) return scorePractice(down, left);
    if (S.rolloff) return scoreRolloff(down);
    const g = S.game, who = g.turn, p = S.players[who];
    const firstBall = g.ball === 0 || (g.last && g.standing === 10);
    const r = g.roll(down.length);
    const split = firstBall && !r.strike && isSplit(left);
    if (r.strike) S.streak[who]++;
    else if (!firstBall || r.frameDone) S.streak[who] = 0;
    announce({ k: 'ball', who, n: down.length, strike: r.strike, spare: r.spare, gutter: !!S.ball?.gutter && down.length === 0, split, left, frameDone: r.frameDone, streak: S.streak[who] });
    if (isYou(p) && robotP()) { stats.bowling.strikes += r.strike ? 1 : 0; save('sh_stats', stats); }
    drawCard();
    // (A new rack if the frame's done or it's the tenth's bonus.)
    if (r.over) later(r.strike || r.spare ? 2.4 : 1.6, () => { ballMesh.visible = false; finishGame(); });
    else nextBall(r.rack ? null : left, r.strike || r.spare ? 2.4 : 1.6);
  }

  // Spare practice: did you pick it up?
  function scorePractice(down, left) {
    const P = S.practice, sp = practiceSpare(), made = left.length === 0;
    P.tried++; if (made) P.made++;
    const B = stats.bowling, rec = (B.spares[sp.id] ??= { made: 0, tried: 0 });
    rec.tried++; if (made) rec.made++;
    save('sh_stats', stats);
    const tally = P.round ? `${P.made} of ${P.tried} so far` : `${sp.name}: ${P.made} of ${P.tried}`;
    if (made) { showBanner(sp.pins.length > 1 && /split/.test(sp.name) ? 'Picked up the split!' : 'Made it!', tally, '#58d68d', 2); sound('cheer', null, /7-10/.test(sp.id) ? 1 : 0.5); ctx.cheer?.(0.7); }
    else if (S.ball?.gutter && !down.length) { showBanner('Gutter ball', tally, C.bad, 2); sound('groan', null, 0.4); }
    else showBanner(down.length ? `${left.map(i => i + 1).join(' and ')} left` : 'Missed it', tally, '#ff9a5a', 2);
    drawCard();
    if (P.round && P.i + 1 >= P.list.length) { later(1.8, () => { ballMesh.visible = false; finishPractice(); }); return; }
    if (P.round) P.i++;
    nextBall(practiceSpare().pins, 1.8);
  }
  function finishPractice() {
    S.phase = 'done';
    const P = S.practice, B = stats.bowling, best = P.made > (B.spareBest ?? 0);
    if (best) B.spareBest = P.made;
    save('sh_stats', stats);
    showBanner(`${P.made} of ${P.list.length} spares`, best ? 'Your best round!' : `Your best: ${B.spareBest} of ${ROUND_SPARES}`, P.made >= 7 ? '#d4af37' : C.accent2, 5);
    if (P.made >= 7) { sound('fanfare'); ctx.confetti?.({ x: LANE.x, y: 1.2, z: LANE.foulZ - 1 }); }
    drawCard();
    later(6, () => ctx.onOver?.('practice'));
  }

  // A cup game's tie: one ball each at a full rack, most pins wins (again if it's level).
  function startRolloff() {
    S.rolloff = { balls: S.players.map(() => []), turn: 0 };
    showBanner('A tie! Roll-off', 'One ball each: most pins wins', C.accent2, 3);
    sound('cheer', null, 0.6); ctx.cheer?.(1);
    drawCard();
    nextBall(null, 3);
  }
  function scoreRolloff(down) {
    const R = S.rolloff, who = R.turn, p = S.players[who];
    R.balls[who].push(down.length);
    const name = nameOf(p), n = down.length;
    showBanner(n === 10 ? 'STRIKE!' : `${name === 'You' ? 'You' : name}: ${n}`, 'Roll-off', n === 10 ? '#d4af37' : hexStr(p.colour), 1.8);
    if (n === 10) { sound('cheer', null, 0.8); ctx.cheer?.(1.2); }
    drawCard();
    if (R.turn + 1 < S.players.length) { R.turn++; nextBall(null, 1.8); return; }
    const last = R.balls.map(b => b[b.length - 1]);
    if (last[0] === last[1]) {
      R.turn = 0;
      later(1.8, () => showBanner('Level again', 'Another ball each', C.accent2, 2));
      nextBall(null, 3.6);
      return;
    }
    later(1.8, () => { ballMesh.visible = false; finishGame(); });
  }

  // Something happened: show it here and, playing a friend, send it to their
  // screen, where it's worded for them (show() runs there with the same event).
  function announce(ev) { show(ev); ctx.onAnnounce?.(ev); }
  const P_MOOD = { strike: 'pStrike', double: 'pStrike', turkey: 'pStrike', spare: 'pSpare', gutter: 'pGutter' };
  function show(ev) {
    const rp = robotP();
    if (ev.k === 'start') {
      const people = S.players.filter(p => p.kind !== 'robot'), o = S.opts, F = o.frames ?? 10;
      const others = S.players.filter(p => !isYou(p)).map(p => p.name);
      const who = S.players.some(p => p.kind === 'remote') ? `You v ${others.join(' and ')}`
        : people.length > 1 ? `${people.length} players, taking turns${rp ? ` and ${rp.name}` : ''}` : rp ? `You v ${rp.name}` : 'Just you';
      showBanner(o.cup ? o.cup.label : F === 5 ? 'Bowling: a quick game' : 'Bowling', `${who} · ${F} frames${o.bumpers ? ' · bumpers up' : ''}`, C.accent, 3);
    } else if (ev.k === 'turn') {
      const p = S.players[ev.who];
      if (!p) return;
      showBanner(nameOf(p) === 'You' ? 'Your turn' : `${p.name}'s turn`, ev.ro ? 'Roll-off: one ball' : `Frame ${ev.frame + 1}${ev.last ? ' (the last)' : ''}`, hexStr(p.colour), 1.6);
    } else if (ev.k === 'ball') {
      const p = S.players[ev.who];
      if (!p) return;
      const name = nameOf(p), you = name === 'You', robot = p === rp;
      let mood = null, cele = null;
      if (ev.strike) {
        const n = ev.streak;
        showBanner(n >= 3 ? (n === 3 ? 'TURKEY!' : `${n} STRIKES IN A ROW!`) : n === 2 ? 'DOUBLE!' : 'STRIKE!', you ? 'All ten' : `${name}: all ten`, '#d4af37', 2.6);
        sfx.play('cheer', null, n >= 3 ? 1 : 0.7); ctx.cheer?.(n >= 3 ? 2 : 1.2);
        if (n >= 3 || !robot) ctx.confetti?.({ x: LANE.x, y: 1.0, z: LANE.headZ + 0.5 });
        mood = n >= 3 ? 'turkey' : n === 2 ? 'double' : 'strike'; cele = 'spin';
      } else if (ev.spare) {
        showBanner('SPARE!', you ? 'You cleared the rest' : `${name} cleared the rest`, '#58d68d', 2.2);
        sfx.play('cheer', null, 0.5); ctx.cheer?.(0.7);
        mood = 'spare'; cele = 'pump';
      } else if (ev.gutter) {
        showBanner('Gutter ball', you ? 'Into the gutter' : `${name}: into the gutter`, C.bad, 2);
        sfx.play('groan', null, 0.4);
        mood = 'gutter'; cele = 'droop';
      } else if (ev.split) {
        showBanner('Split!', `${ev.left.map(i => i + 1).join(' and ')} left standing`, '#ff9a5a', 2.2);
        mood = 'split'; cele = 'droop';
      } else {
        const what = ev.n === 0 ? 'Missed them all' : `${ev.n} pin${ev.n > 1 ? 's' : ''}`;
        showBanner(you ? what : `${name}: ${what}`, ev.frameDone ? 'Open frame' : `${ev.left.length} left for a spare`, hexStr(p.colour), 1.8);
        if (ev.frameDone) mood = 'open';
      }
      // The robot: celebrates or sulks (on both screens); talks (the host's
      // game decides what it says and sends it).
      if (!rp || !mood) return;
      if (robot) { if (cele) rp.model.celebrate(cele); if (!S.remote) later(1.2, () => talk(mood, mood === 'turkey')); }
      else if (P_MOOD[mood]) { if (mood === 'strike' || mood === 'turkey') rp.model.celebrate('droop'); if (!S.remote) later(1.2, () => talk(P_MOOD[mood])); }
    } else if (ev.k === 'say') {
      if (rp) ctx.say?.(rp.rival, ev.line, rp.model);
    } else if (ev.k === 'over') {
      const sc = ev.scores, top = Math.max(...sc), winners = S.players.filter((_, i) => sc[i] === top);
      const sub = S.players.map((p, i) => `${nameOf(p)} ${sc[i]}`).join(' · ') + (ev.best ? ' · your high game!' : '');
      if (winners.length > 1) showBanner('A tie!', sub, C.accent2, 5);
      else if (winners[0].kind === 'robot') { showBanner(`${winners[0].name} wins`, sub, C.bad, 5); sfx.play('groan'); rp.model.celebrate('dance'); }
      else if (!isYou(winners[0])) { showBanner(`${winners[0].name} wins`, sub, C.bad, 5); sfx.play('groan'); rp?.model.celebrate('slump'); }
      else {
        showBanner(S.players.length === 1 ? `Game over: ${sc[0]}` : `${nameOf(winners[0])} win${nameOf(winners[0]) === 'You' ? '' : 's'}!`, sub, '#d4af37', 5);
        sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer?.(2); ctx.confetti?.({ x: LANE.x, y: 1.2, z: LANE.foulZ - 1 });
        rp?.model.celebrate('slump');
      }
    }
  }
  // A split: the head pin's down and what's left is in two or more groups.
  function isSplit(left) {
    if (left.length < 2 || left.includes(0)) return false;
    const seen = new Set([left[0]]), todo = [left[0]];
    while (todo.length) {
      const a = todo.pop();
      for (const b of left) if (!seen.has(b) && Math.hypot(PIN_SPOTS[a].x - PIN_SPOTS[b].x, PIN_SPOTS[a].z - PIN_SPOTS[b].z) < ADJ) { seen.add(b); todo.push(b); }
    }
    return seen.size < left.length;
  }

  function finishGame() {
    const g = S.game, rp = robotP();
    const scores = S.players.map((_, i) => g.score(i));
    // A cup game that's level: a roll-off first.
    if (S.opts.cup && !S.rolloff && scores[0] === scores[1]) return startRolloff();
    S.phase = 'done';
    const B = stats.bowling;
    // Your high game (when you're the only person bowling here).
    const people = S.players.filter(isYou), youI = S.players.indexOf(people[0]);
    let best = false;
    if (people.length === 1 && (S.opts.frames ?? 10) === 10) {
      B.games++; best = scores[youI] > B.high; B.high = Math.max(B.high, scores[youI]);
    }
    // Who won: the most pins (or the last roll-off ball).
    const ro = S.rolloff?.balls.map(b => b[b.length - 1]);
    const winner = ro ? (ro[0] > ro[1] ? 0 : 1) : scores.indexOf(Math.max(...scores));
    if (rp && people.length === 1) {
      const you = scores[youI], it = scores[S.players.indexOf(rp)];
      const won = ro ? winner === youI : you >= it;
      if (won) { B.wins++; if (!B.beaten.includes(rp.rival.id)) B.beaten.push(rp.rival.id); } else B.losses++;
      ctx.lastResult?.(`${won ? 'You beat' : 'You lost to'} ${rp.name} at bowling: ${you} to ${it}${ro ? ' (after a roll-off)' : ''}`);
    }
    save('sh_stats', stats);
    // A cup game: what it means for the cup, as the result's banner.
    const note = S.opts.cup ? ctx.onCupResult?.({ scores, winner, rolloff: S.rolloff ? S.rolloff.balls.map(b => b.reduce((a, c) => a + c, 0)) : null }) : null;
    if (note) {
      const sub = S.players.map((p, i) => `${nameOf(p)} ${scores[i]}`).join(' · ') + (ro ? ` · roll-off ${ro[0]}–${ro[1]}` : '');
      showBanner(note.title, `${note.sub} · ${sub}`, note.colour, 6);
      if (winner === youI) { sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer?.(2); ctx.confetti?.({ x: LANE.x, y: 1.2, z: LANE.foulZ - 1 }); rp?.model.celebrate('slump'); }
      else { sfx.play('groan'); rp?.model.celebrate('dance'); }
    } else announce({ k: 'over', scores, best });
    const tie = !ro && scores.filter(s => s === scores[winner]).length > 1;
    if (rp && !tie) later(1.0, () => talk(winner === S.players.indexOf(rp) ? 'win' : 'pWin', true));
    drawCard();
    later(6, () => ctx.onOver?.(S.opts.cup ? 'cup' : 'play'));
  }

  // ------------------------------------------------------------ the robot --
  let lastTalk = -9;
  function talk(moment, force = false) {
    const rp = robotP();
    if (!rp) return;
    if (!force && (Math.random() > (BOWL_TALK_CHANCE[moment] ?? 0.5) || S.t - lastTalk < 3)) return;
    const line = bowlLine(rp.rival, moment);
    if (!line) return;
    lastTalk = S.t;
    announce({ k: 'say', line });
  }

  const _v = new THREE.Vector3();
  function robotUpdate(dt) {
    const rp = robotP();
    if (!rp) return;
    // A friend's screen: where the host's game has the robot.
    if (S.remote) {
      const r = S.rPose;
      if (r) { rp.pos.x = r[0]; rp.pos.z = r[1]; rp.hand.set(r[2], r[3], r[4]); }
      return poseRobot(rp, !!r?.[5], dt);
    }
    const up = player() === rp && S.phase === 'robot';
    const R = up ? S.rob : null;
    // Where it stands: waiting to one side, or on the approach for its ball.
    let spot = WAIT, hand = { y: 1.02, z: -0.14 }, holding = false;
    if (R) {
      R.t += dt;
      if (!R.shot) R.shot = robotShot(rp.rival.id, S.stand.length === 10 ? null : S.stand);
      const sx = R.shot.x - 0.2, stance = { x: sx, z: LANE.foulZ + 0.95 };
      holding = R.step !== 'follow';
      if (R.step === 'walk') { spot = stance; hand = { y: 1.0, z: -0.2 }; if (Math.hypot(rp.pos.x - stance.x, rp.pos.z - stance.z) < 0.03) { R.step = 'set'; R.t = 0; } }
      else if (R.step === 'set') { spot = stance; hand = { y: 1.05, z: -0.22 }; if (R.t > 0.7) { R.step = 'go'; R.t = 0; } }
      else if (R.step === 'go') {
        // Three steps to the line while the arm swings back and through.
        const k = Math.min(1, R.t / 1.1);
        spot = { x: sx, z: stance.z - 0.75 * k };
        const sw = k < 0.55 ? -Math.sin(k / 0.55 * Math.PI / 2) : -1 + 2 * Math.sin((k - 0.55) / 0.45 * Math.PI / 2);
        hand = { y: 0.55 - 0.3 * Math.cos(sw * Math.PI / 2) + (sw < 0 ? -sw * 0.35 : 0), z: -sw * 0.5 };
        rp.pos.x = spot.x; rp.pos.z = spot.z;
        if (k >= 1) {
          R.step = 'follow'; R.t = 0;
          bowl({ ...R.shot, z: LANE.foulZ - 0.05 }, turnIdx());
        }
      } else if (R.step === 'follow') { spot = { x: sx, z: stance.z - 0.75 }; hand = { y: 1.45, z: -0.6 }; }
    }
    if (!R || R.step !== 'go') {
      const k = Math.min(1, dt * 2.2);
      rp.pos.x += (spot.x - rp.pos.x) * k; rp.pos.z += (spot.z - rp.pos.z) * k;
    }
    rp.hand.lerp(_v.set(rp.pos.x + 0.2, hand.y, rp.pos.z + hand.z), Math.min(1, dt * (R?.step === 'go' ? 30 : 10)));
    S.robotHolding = holding;
    poseRobot(rp, holding, dt);
  }
  // The robot's model where it stands, its arm out to its hand (and the ball in it).
  function poseRobot(rp, holding, dt) {
    const bx = rp.pos.x, bz = rp.pos.z;
    rp.model.root.position.set(bx - 0.6, 0, bz - 2.22);
    rp.bot.pad.x = 0.8; rp.bot.pad.y = rp.hand.y + 0.13; rp.bot.pad.z = rp.hand.z - (bz - 2.22);
    rp.bot.mood *= Math.pow(0.5, dt);
    const look = S.ball && ballMesh.visible ? ballMesh.position : _v.set(LANE.x, 0.3, LANE.headZ);
    rp.model.update(rp.bot, look, dt);
    robotBall.visible = holding;
    if (holding) { rp.model.handPos(robotBall.position); robotBall.position.y -= 0.06; }
  }

  // ------------------------------------------------------------- your ball --
  const _h = new THREE.Vector3(), _q = new THREE.Quaternion(), _q0 = new THREE.Quaternion();
  function vrAim(holding) {
    const go = yourGo();
    handRig.visible = go || S.preview;
    if (!go || !handRig.parent) { S.hold = null; return; }
    handRig.getWorldPosition(_h);
    handRig.getWorldQuaternion(_q);
    if (holding) {
      const H = S.hold ??= { samples: [], q: [] };
      H.samples.push({ t: S.t, x: _h.x, y: _h.y, z: _h.z });
      H.q.push({ t: S.t, q: _q.clone() });
      while (H.samples.length && S.t - H.samples[0].t > 0.3) H.samples.shift();
      while (H.q.length && S.t - H.q[0].t > 0.15) H.q.shift();
    } else if (S.hold) {
      const v = releaseVelocity(S.hold.samples);
      const spin = wristSpin(S.hold.q);
      S.hold = null;
      if (v && v.speed > 1.2 && v.z < -0.8) throwVR({ x: _h.x, y: _h.y, z: _h.z }, v, spin);
    }
  }
  // How fast your wrist turned about the way you're bowling (+: anticlockwise
  // from behind, a right-hander's hook), as spin -1..1.
  function wristSpin(qs) {
    if (qs.length < 2) return 0;
    const a = qs[0], b = qs[qs.length - 1], dt = b.t - a.t;
    if (dt < 0.02) return 0;
    _q0.copy(a.q).invert().premultiply(b.q);            // the turn from a to b (world)
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_q0.w))), s = Math.sqrt(Math.max(1e-9, 1 - _q0.w * _q0.w));
    const az = (_q0.z / s) * Math.sign(_q0.w || 1);     // the axis's z part (towards you)
    return Math.max(-1, Math.min(1, ang * az / dt / 9));
  }
  function throwVR(p, v, spin) {
    const power = settings.bowlPower ?? 1;
    let vx = v.x * power, vz = v.z * power;
    const x = Math.max(LANE.x - LANE.halfW + 0.03, Math.min(LANE.x + LANE.halfW - 0.03, p.x));
    const z = Math.max(LANE.foulZ - 0.05, Math.min(LANE.approachEnd - 0.2, p.z));
    const helped = assist(x, z, vx, vz, spin);
    logThrow(Math.hypot(vx, vz), spin, helped.moved);
    ctx.haptic?.(0.4, 40);
    handRig.visible = false;
    bowl({ x, z, y: Math.max(BALL_R, p.y), vx: helped.vx, vz, spin }, turnIdx());
  }
  // Aim help: nudge a ball that's heading near the pocket (or near what's left
  // standing, for a spare) a bit nearer.
  function assist(x, z, vx, vz, spin) {
    const A = ASSIST[settings.bowlAssist] ?? ASSIST.light;
    if (!A.k) return { vx, moved: 0 };
    const cross = crossX(x, z, vx, vz, spin);
    if (cross == null) return { vx, moved: 0 };
    let want = LANE.x + (spin < -0.2 ? -0.065 : 0.065);
    if (S.stand.length < 10) {
      // A spare: the standing pin nearest the ball's line (or leave it be if
      // it's already going between the outside pins).
      const xs = S.stand.map(i => PIN_SPOTS[i].x);
      want = xs.reduce((a, b) => (Math.abs(b - cross) < Math.abs(a - cross) ? b : a));
      if (S.stand.length > 1 && cross > Math.min(...xs) && cross < Math.max(...xs)) want = cross;
    }
    const miss = want - cross;
    if (Math.abs(miss) > A.reach) return { vx, moved: 0 };
    const T = (z - LANE.headZ) / -vz;
    return { vx: vx + miss * A.k / T, moved: Math.abs(miss * A.k) };
  }
  // Where a ball would cross the head pin's line (no pins), or null (gutter).
  function crossX(x, z, vx, vz, spin) {
    const b = BP.launch(x, vx, vz, spin, z);
    for (let i = 0; i < 4000 && b.z > LANE.headZ && b.state === 'lane'; i++) BP.step(b, [], 1 / 300, null, { bumpers: !!S.opts.bumpers });
    return b.state === 'lane' ? b.x : null;
  }
  function logThrow(speed, spin, moved) {
    S.log.push({ speed, spin, moved });
    if (S.log.length > 8) S.log.shift();
  }

  // Screen: move the mouse along the foul line, press, drag up and let go.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);
  const screenGo = () => root.visible && yourGo() && !ctx.isXR();
  function pointerMove(ndc, px) {
    if (!screenGo()) return;
    if (S.press) { S.press.path.push({ ...px, t: S.t }); return; }
    ctx.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (ctx.raycaster.ray.intersectPlane(plane, p)) S.aimX = Math.max(LANE.x - LANE.halfW + 0.05, Math.min(LANE.x + LANE.halfW - 0.05, p.x));
  }
  function pointerDown(ndc, px) {
    if (!screenGo()) return false;
    S.press = { path: [{ ...px, t: S.t }] };
    return true;
  }
  // The drag as a ball: up the screen is down the lane; how far and how fast is
  // the pace; the way it leans is the line; how it bends is the hook.
  function dragShot() {
    const P = S.press?.path;
    if (!P || P.length < 2) return null;
    const a = P[0], b = P[P.length - 1], dx = b.x - a.x, dy = a.y - b.y, len = Math.hypot(dx, dy);
    if (dy < 20) return null;
    const H = window.innerHeight;
    const speed = Math.max(2.5, Math.min(9.5, 2.5 + (len / H) * 9));
    const ang = Math.atan2(dx, dy) * 0.12;
    // The bend: how far the middle of the drag strays from the straight line (+ right).
    let bend = 0;
    for (const q of P) bend = Math.abs(((q.x - a.x) * dy + (q.y - a.y) * dx) / len) > Math.abs(bend) ? ((q.x - a.x) * dy + (q.y - a.y) * dx) / len : bend;
    const spin = Math.max(-1, Math.min(1, bend / (len * 0.25)));
    return { x: S.aimX, vx: Math.sin(ang) * speed, vz: -Math.cos(ang) * speed, spin };
  }
  function pointerUp() {
    const shot = dragShot();
    S.press = null; aimDots.visible = false;
    if (!shot || !screenGo()) return;
    const helped = assist(shot.x, LANE.foulZ - 0.05, shot.vx, shot.vz, shot.spin);
    logThrow(Math.hypot(shot.vx, shot.vz), shot.spin, helped.moved);
    screenBall.visible = false;
    // On a friend's screen the ball goes to the host, whose game bowls it.
    if (S.remote) { S.sentAt = S.t; ctx.remoteShot?.({ x: +shot.x.toFixed(4), vx: +helped.vx.toFixed(4), vz: +shot.vz.toFixed(4), spin: +shot.spin.toFixed(3) }); return; }
    bowl({ ...shot, vx: helped.vx }, turnIdx());
  }
  function drawScreenAim() {
    const go = screenGo();
    screenBall.visible = go;
    if (!go) { aimDots.visible = false; return; }
    screenBall.position.set(S.aimX, BALL_R + 0.012, LANE.foulZ + 0.25);
    const shot = dragShot();
    aimDots.visible = !!shot;
    if (!shot) return;
    // A dotted preview of the first part of its path.
    const b = BP.launch(shot.x, shot.vx, shot.vz, shot.spin), pts = [];
    for (let i = 0; i < AIM_DOTS; i++) { for (let k = 0; k < 18 && b.state === 'lane'; k++) BP.step(b, [], 1 / 300, null, { bumpers: !!S.opts.bumpers }); pts.push(new THREE.Vector3(b.x, 0.03, b.z)); }
    aimDots.geometry.setFromPoints(pts);
  }

  // ------------------------------------------------------------- the views --
  const camWant = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  function screenCamera(dt, paused) {
    const tall = window.innerWidth < window.innerHeight;
    const b = S.ball;
    if (!paused && b && S.phase === 'rolling' && b.z < LANE.foulZ - 1) {
      // Follow the ball, then look at the pins.
      const z = Math.max(LANE.headZ + 2.6, b.z + 2.6);
      camWant.pos.set(LANE.x, tall ? 1.3 : 1.0, z);
      camWant.look.set(LANE.x, 0.2, Math.min(b.z, LANE.headZ + 0.5) - 1.0);
    } else if (!paused && (S.phase === 'between' || S.phase === 'rolling') && S.ball) {
      camWant.pos.set(LANE.x, tall ? 1.3 : 1.0, LANE.headZ + 2.6);
      camWant.look.set(LANE.x, 0.2, LANE.headZ - 0.4);
    } else if (!paused && S.phase === 'robot') {
      // The robot's go: from off to one side, so it isn't in the way.
      camWant.pos.set(LANE.x + 1.7, tall ? 1.9 : 1.55, LANE.foulZ + 1.9);
      camWant.look.set(LANE.x - 0.25, 0.55, LANE.foulZ - 2.2);
    } else {
      // Behind the bowler, looking down the lane (your ball in view at the bottom).
      camWant.pos.set(LANE.x, tall ? 1.8 : 1.5, LANE.foulZ + (tall ? 2.8 : 2.4));
      camWant.look.set(LANE.x, 0.05, LANE.foulZ - (tall ? 3 : 4));
    }
    if (!S.cam) S.cam = { pos: camWant.pos.clone(), look: camWant.look.clone() };
    const k = dt < 0 ? 1 : Math.min(1, dt * 3);
    S.cam.pos.lerp(camWant.pos, k); S.cam.look.lerp(camWant.look, k);
    camera.position.copy(S.cam.pos);
    camera.lookAt(S.cam.look);
    camera.updateMatrixWorld();
  }
  function hud(mesh, baseW, baseH, wFrac, cx, cy) {
    const d = 0.5, halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
    mesh.scale.setScalar(wFrac * 2 * halfW / baseW);
    mesh.position.copy(camera.position).add(_v.set(cx * halfW, cy * halfH, -d).applyQuaternion(camera.quaternion));
    mesh.quaternion.copy(camera.quaternion);
  }
  function placeBoards(xr) {
    const bm = ctx.banner;
    if (xr) {
      card.mesh.scale.setScalar(1);
      // Both well above your line of sight to the pins.
      card.mesh.position.set(LANE.x, 2.35, LANE.foulZ - 1.4);
      card.mesh.rotation.set(0.25, 0, 0);
      bm.scale.setScalar(1);
      bm.position.set(LANE.x, 2.15, LANE.foulZ - 3.8);
      bm.rotation.set(0, 0, 0);
      return;
    }
    const hudH = (baseW, baseH, wFrac) => wFrac * 2 * camera.aspect * baseH / baseW;
    if (camera.aspect < 1) {
      hud(card.mesh, 1.9, cardH, 0.96, 0, 1 - hudH(1.9, cardH, 0.96) / 2 - 0.03);
      hud(bm, 1.5, 0.375, 0.94, 0, -1 + hudH(1.5, 0.375, 0.94) / 2 + 0.05);
    } else {
      hud(card.mesh, 1.9, cardH, 0.55, -1 + 0.55 + 0.03, -1 + hudH(1.9, cardH, 0.55) / 2 + 0.04);
      hud(bm, 1.5, 0.375, 0.4, 0, 1 - hudH(1.5, 0.375, 0.4) / 2 - 0.03);
    }
  }

  // ---------------------------------------------------------- scoreboard --
  function drawCard() {
    const g = card.g, w = card.w, h = card.h;
    g.clearRect(0, 0, w, h);
    roundRect(g, 6, 6, w - 12, h - 12, 30);
    g.fillStyle = 'rgba(8,12,22,0.93)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#2c3954'; g.stroke();
    if (S.practice) { drawPracticeCard(g, w, h); card.flush(); return; }
    const G = S.game;
    if (!G) { card.flush(); return; }
    const F = G.count, x0 = 250, fw = (w - x0 - 170) / F, rowH = ROW_PX;
    g.textBaseline = 'middle';
    g.font = `700 26px ${FONT}`; g.fillStyle = C.dim; g.textAlign = 'center';
    for (let f = 0; f < F; f++) g.fillText(String(f + 1), x0 + fw * (f + 0.5), 38);
    g.fillText('Total', w - 90, 38);
    S.players.forEach((p, k) => {
      const y = 62 + k * rowH, frames = G.frames[k], totals = G.totals(k);
      const now = k === G.turn && S.phase !== 'done';
      roundRect(g, 18, y, w - 36, rowH - 10, 14);
      g.fillStyle = now ? '#17284a' : '#121a2c'; g.fill();
      g.fillStyle = hexStr(p.colour); g.beginPath(); g.arc(44, y + rowH / 2 - 5, 11, 0, Math.PI * 2); g.fill();
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 34px ${FONT}`;
      g.fillText(nameOf(p), 66, y + rowH / 2 - 5);
      for (let f = 0; f < F; f++) {
        const fx = x0 + fw * f, last = f === F - 1;
        g.strokeStyle = f === G.frame && now ? '#ffd23f' : '#2c3954'; g.lineWidth = 2;
        g.strokeRect(fx + 3, y + 4, fw - 6, rowH - 18);
        // The ball boxes along the top (a strike goes in the right-hand box).
        const m = frames[f] ? marks(frames[f], last) : [];
        const at = last ? [0.22, 0.5, 0.78] : [0.38, 0.74];
        g.font = `800 28px ${FONT}`; g.textAlign = 'center';
        m.forEach((s, i) => {
          const slot = !last && m.length === 1 && s === 'X' ? 1 : i;
          g.fillStyle = s === 'X' ? '#d4af37' : s === '/' ? '#58d68d' : '#dfe7f7';
          g.fillText(s, fx + fw * at[slot], y + 26);
        });
        if (totals[f] != null) { g.fillStyle = '#fff'; g.font = `800 34px ${FONT}`; g.fillText(String(totals[f]), fx + fw / 2, y + rowH - 40); }
      }
      g.fillStyle = '#ffd23f'; g.font = `900 44px ${FONT}`; g.textAlign = 'center';
      g.fillText(String(G.score(k)), w - 90, y + rowH / 2 - 5);
      // A cup game's roll-off balls, under the name.
      if (S.rolloff?.balls[k]?.length) {
        g.textAlign = 'left'; g.fillStyle = '#ffd23f'; g.font = `700 22px ${FONT}`;
        g.fillText(`roll-off ${S.rolloff.balls[k].join(', ')}`, 66, y + rowH - 26);
      }
    });
    card.flush();
  }
  // Spare practice: the leave as a little pin chart, and how you're doing.
  function drawPracticeCard(g, w, h) {
    const P = S.practice, sp = practiceSpare();
    const cx = 130, by = h - 36, SP = 0.3048, ROW = SP * Math.sqrt(3) / 2;
    PIN_SPOTS.forEach((s, i) => {
      const x = cx + (s.x - LANE.x) / SP * 46, y = by + (s.z - LANE.headZ) / ROW * 36;
      g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2);
      if (sp.pins.includes(i)) { g.fillStyle = '#fff'; g.fill(); } else { g.lineWidth = 3; g.strokeStyle = '#3a4866'; g.stroke(); }
    });
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#fff'; g.font = `800 44px ${FONT}`; g.fillText(sp.name, 290, 62);
    g.fillStyle = C.dim; g.font = `600 28px ${FONT}`; g.fillText(sp.tip, 290, 116);
    const rec = stats.bowling.spares[sp.id];
    if (rec?.tried) g.fillText(`All time: ${rec.made} of ${rec.tried}`, 290, 154);
    g.textAlign = 'right';
    g.fillStyle = '#ffd23f'; g.font = `900 52px ${FONT}`;
    g.fillText(`${P.made}/${P.round ? P.list.length : P.tried}`, w - 50, 70);
    g.fillStyle = C.dim; g.font = `700 26px ${FONT}`;
    g.fillText(P.round ? `Spare ${Math.min(P.i + 1, P.list.length)} of ${P.list.length}` : P.tried ? `${Math.round(P.made / P.tried * 100)}% made` : 'made', w - 50, 130);
  }

  // --------------------------------------------------------------- frame --
  function update(dt, { xr, paused, holding }) {
    if (!root.visible || S.preview) return;
    if (!xr) screenCamera(dt, paused);
    placeBoards(xr);
    card.mesh.visible = xr || !paused;
    if (paused) { handRig.visible = false; screenBall.visible = false; aimDots.visible = false; S.hold = null; S.press = null; return; }
    S.t += dt;
    if (S.remote) {
      // A friend's screen: the host's game, with the ball carried on between its updates.
      const b = S.ball;
      if (b && b.state === 'lane') { b.x += b.vx * dt; b.z += b.vz * dt; }
      robotUpdate(dt);
      handRig.visible = false; drawScreenAim();
      drawBallAndPins(dt);
      return;
    }
    const due = S.timers.filter(t => t.t <= S.t);
    if (due.length) { S.timers = S.timers.filter(t => t.t > S.t); due.forEach(t => t.fn()); }
    if (S.phase === 'rolling') stepPlay(dt);
    else if (S.phase === 'between' && S.pins.some(p => p.down && !p.gone)) BP.step(null, S.pins, dt);
    robotUpdate(dt);
    friendUpdate(dt);
    if (xr) vrAim(holding); else { handRig.visible = false; drawScreenAim(); }
    drawBallAndPins(dt);
  }
  // Playing a friend (on the host): where they stand, for their figure in the
  // hall. Beside the ball return, then up to the line for their ball.
  function friendUpdate(dt) {
    const i = S.players.findIndex(p => p.kind === 'remote');
    if (i < 0) return;
    const mineNow = turnIdx() === i, thrown = S.ball?.who === i && S.phase === 'rolling' && S.rollT < 1.2;
    S.friendUp = mineNow && (S.phase === 'aim' || thrown);
    const spot = !S.friendUp ? FRIEND_WAIT : thrown ? { x: S.ball.x0 ?? LANE.x, z: LANE.foulZ + 0.3 } : { x: LANE.x + 0.1, z: LANE.foulZ + 0.8 };
    const k = Math.min(1, dt * 2.5);
    S.friendPos.x += (spot.x - S.friendPos.x) * k; S.friendPos.z += (spot.z - S.friendPos.z) * k;
    S.friendThrown = thrown;
  }
  function drawBallAndPins(dt) {
    const b = S.ball;
    if (b && ballMesh.visible) {
      // Dropped from your hand, it falls to the lane first.
      b.y = Math.max(BALL_R + 0.012, (b.y ?? BALL_R) - dt * 4);
      const gy = b.state === 'gutter' ? 0.05 : b.y;
      ballMesh.position.set(b.x, gy, b.z);
      const s = Math.hypot(b.vx, b.vz);
      if (s > 0.01) { _v.set(-b.vz / s, 0, b.vx / s); ballMesh.rotateOnWorldAxis(_v, -s * dt / BALL_R); }
      if (b.state === 'pit') ballMesh.visible = false;
    }
    for (const p of S.pins) {
      const m = pinMeshes[p.i];
      if (p.gone && (p.z < LANE.deckEnd - 0.1 || Math.abs(p.x - LANE.x) > LANE.outer + 0.1)) { m.visible = false; continue; }
      m.position.set(p.x, 0.012, p.z);
      if (p.down) m.quaternion.setFromAxisAngle(_v.set(p.fz, 0, -p.fx).normalize(), p.fall * Math.PI / 2 * 0.96);
    }
  }

  function stopAll() {
    S.timers = []; S.ball = null; S.hold = null; S.press = null; S.rob = null; S.rPose = null; S.sentAt = 0;
    ballMesh.visible = robotBall.visible = screenBall.visible = aimDots.visible = handRig.visible = otherBall.visible = false;
  }

  // ------------------------------------------------- playing a friend --
  const rnd = v => Math.round(v * 1000) / 1000;
  // The host's game as it is now, for the friend's screen.
  function snapshot() {
    const b = S.ball, g = S.game, rp = robotP();
    return {
      ph: S.phase, t: g?.turn ?? 0, fr: g?.frames ?? [], f: g?.frame ?? 0, ov: !!g?.over,
      b: b && ballMesh.visible ? [rnd(b.x), rnd(b.y ?? BALL_R), rnd(b.z), rnd(b.vx), rnd(b.vz), BALL_STATES.indexOf(b.state), b.who] : null,
      rn: S.rackN, st: S.stand,
      // (Standing pins don't move: only the fallen ones.)
      p: S.pins.filter(p => p.down).map(p => [p.i, rnd(p.x), rnd(p.z), rnd(p.fall), rnd(p.fx), rnd(p.fz), p.gone ? 1 : 0]),
      r: rp ? [rnd(rp.pos.x), rnd(rp.pos.z), rnd(rp.hand.x), rnd(rp.hand.y), rnd(rp.hand.z), S.robotHolding ? 1 : 0] : null,
    };
  }
  // The friend's screen: draw what the host sent.
  function applyRemote(s) {
    if (!S.remote || !s || typeof s !== 'object') return;
    S.phase = String(s.ph);
    if (S.phase !== 'aim') S.sentAt = 0;
    const g = S.game;
    if (g && Array.isArray(s.fr) && s.fr.length === S.players.length && s.fr.every(Array.isArray)) {
      g.frames = s.fr; g.turn = s.t | 0; g.frame = s.f | 0; g.over = !!s.ov;
      const key = JSON.stringify([s.fr, s.t, S.phase === 'done']);
      if (key !== S.cardKey) { S.cardKey = key; drawCard(); }
    }
    if (Array.isArray(s.st) && s.rn !== S.hostRack) { S.hostRack = s.rn; newRack(s.st.filter(i => i >= 0 && i < 10)); }
    if (Array.isArray(s.p)) for (const [i, x, z, fall, fx, fz, gone] of s.p) {
      const p = S.pins.find(q => q.i === i);
      if (p) Object.assign(p, { x, z, down: true, fall, fx, fz, gone: !!gone, vx: 0, vz: 0 });
    }
    if (Array.isArray(s.b)) {
      const [x, y, z, vx, vz, st, who] = s.b, fresh = !S.ball || !ballMesh.visible;
      S.ball = Object.assign(S.ball ?? {}, { x, y, z, vx, vz, state: BALL_STATES[st] ?? 'lane', who });
      if (fresh) { recolour(ballMesh, S.players[who]?.colour ?? BALL_COLOURS[0]); ballMesh.visible = true; }
    } else if (S.ball) { S.ball = null; ballMesh.visible = false; }
    S.rPose = Array.isArray(s.r) ? s.r : null;
  }

  return {
    handRig,
    get active() { return root.visible && !S.preview; },
    get phase() { return S.phase; },
    get state() { return S; },
    get log() { return S.log; },
    start, startPractice,
    stop() { stopAll(); S.preview = false; S.practice = null; S.rolloff = null; S.remote = false; root.visible = false; S.phase = 'idle'; },
    // The menu's view (bowling picked, no game on): the lane and a fresh rack.
    preview(on) {
      if (!on) { if (S.preview) { S.preview = false; root.visible = false; handRig.visible = false; } return; }
      if (root.visible && !S.preview) return;
      stopAll(); S.preview = true; S.phase = 'idle'; S.game = null; S.practice = null; S.rolloff = null; S.remote = false;
      newRack(); card.mesh.visible = false;
      recolour(handRig, BALL_COLOURS[0]); handRig.visible = true;
      root.visible = true;
    },
    update, pointerDown, pointerMove, pointerUp,
    snapCamera() { S.cam = null; screenCamera(-1, false); },
    inProgress: () => root.visible && !S.preview && S.phase !== 'done' && S.phase !== 'idle',
    // Playing a friend. The host: the game to send, and the friend's ball when it comes.
    snapshot,
    remoteShot(m) {
      const i = turnIdx(), p = S.players[i];
      if (S.remote || S.phase !== 'aim' || p?.kind !== 'remote' || !m) return false;
      if (![m.x, m.vx, m.vz, m.spin].every(Number.isFinite)) return false;
      const speed = Math.hypot(m.vx, m.vz);
      if (speed < 1 || speed > 12 || m.vz >= 0) return false;
      bowl({ x: clamp(m.x, LANE.x - LANE.halfW + 0.03, LANE.x + LANE.halfW - 0.03), vx: m.vx, vz: m.vz, spin: clamp(m.spin, -1, 1) }, i);
      return true;
    },
    // Where the friend stands (for their figure in the hall), or null.
    get friend() { return !S.remote && S.players.some(p => p.kind === 'remote') && root.visible ? { pos: S.friendPos, up: !!S.friendUp, thrown: !!S.friendThrown } : null; },
    // The friend's screen: what the host sent, and what happened (worded for us).
    applyRemote,
    remoteAnnounce(ev) {
      if (!S.remote || !ev || typeof ev.k !== 'string') return;
      if (ev.k === 'ball' && !Array.isArray(ev.left)) return;
      if (ev.k === 'over' && !Array.isArray(ev.scores)) return;
      show(ev);
    },
    // The ball in the host's hand, when the host is in VR and it's their go (or null).
    otherHand(p) {
      otherBall.visible = !!p && S.remote && S.phase === 'aim' && S.players[turnIdx()]?.kind === 'remote';
      if (otherBall.visible) otherBall.position.set(p.x, p.y - 0.09, p.z);
    },
    // For tests: bowl your ball as if from the screen.
    testBowl(shot) {
      if (!yourGo()) return false;
      const s = { x: LANE.x, vx: 0, vz: -7, spin: 0, ...shot };
      if (S.remote) { S.sentAt = S.t; ctx.remoteShot?.(s); return true; }
      bowl(s, turnIdx()); return true;
    },
  };
}
