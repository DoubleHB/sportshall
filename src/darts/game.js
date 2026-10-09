// Darts: the board in its cabinet on a little stage, darts flying and sticking,
// visits and legs, the scoreboard, the caller and a robot at the oche. In VR
// you hold a dart (trigger or grip) and throw it for real; on a screen you
// point at the board and let go when your aim is steady.
import * as THREE from 'three';
import { R as BR, NUMBERS, BOARD, FACE_Z, OCHE_Z, CABINET, WALL, aimPoint, segmentAngle, parseLabel } from './board.js';
import { X01, Cricket, Killer, AroundClock, CountUp, ATC_ORDER, CRICKET_NUMS, robotTarget, cricketTarget, killerTarget } from './rules.js';
import { flightOutcome, solveLaunch, releaseVelocity, posAt, velAt } from './flight.js';
import { robotDart, dartLine, DART_TALK_CHANCE, callFor, words, goesForTrebles } from './robots.js';
import { CanvasBoard, roundRect, FONT, C } from '../panel.js';

// Where you stand: just behind the line, facing the board.
export const DARTS_VIEW = { x: 0, z: OCHE_Z + 0.3, th: 0, lift: 0 };
// Aim help in VR: how far a throw is pulled towards where the dart was pointing
// as you aimed (k), for throws that land within `reach` of it. Wild throws stay wild.
const ASSIST = { off: { k: 0, reach: 0 }, light: { k: 0.4, reach: 0.15 }, full: { k: 0.75, reach: 0.3 } };
// On a screen the aim wobbles; aim help calms it.
const SWAY = { off: 1.35, light: 1, full: 0.65 };
// Flights for people taking turns (player 1 first).
const FLIGHTS = [0x2fb8ff, 0xff7a1a, 0x58d68d, 0xc77dff];
const YOU_FLIGHT = FLIGHTS[0];
// Robots wait behind you on your left, and step up to throw beside you. The
// waiting spots sit round the throwing spot, so nobody walks through anybody.
const THROW_SPOT = { x: -0.85, z: OCHE_Z + 0.15 };
const WAIT_SPOTS = [[120, 0.75], [160, 1.15], [205, 1.15]].map(([deg, r]) => ({ x: THROW_SPOT.x + r * Math.cos(deg * Math.PI / 180), z: THROW_SPOT.z + r * Math.sin(deg * Math.PI / 180) }));
const cap = s => s[0].toUpperCase() + s.slice(1);
const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
const MIN_THROW = 1.5;      // m/s: slower than this and you're just letting go of the trigger
const FWD = new THREE.Vector3(0, 0, -1);

export function createDarts(ctx) {
  const { scene, camera, sfx, showBanner, settings, stats, save } = ctx;
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  // ------------------------------------------------------------- the stage --
  const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  // The board face, drawn to scale: 2048 px across the whole board.
  const boardTex = canvasTex(2048, 2048, (g, S) => {
    const c = S / 2, k = c / BR.board;
    g.fillStyle = '#121212'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    const ring = (r0, r1, colA, colB) => NUMBERS.forEach((n, i) => {
      const a0 = (i * 18 - 9 - 90) * Math.PI / 180, a1 = a0 + Math.PI / 10;
      g.beginPath(); g.arc(c, c, r1 * k, a0, a1); g.arc(c, c, r0 * k, a1, a0, true); g.closePath();
      g.fillStyle = i % 2 ? colB : colA; g.fill();
    });
    ring(BR.outer, BR.doubleOut, '#1c1c1c', '#efe0bf');            // singles: 20 is black
    ring(BR.trebleIn, BR.trebleOut, '#d6312b', '#1f8a4c');         // trebles and doubles: red on black, green on cream
    ring(BR.doubleIn, BR.doubleOut, '#d6312b', '#1f8a4c');
    g.fillStyle = '#1f8a4c'; g.beginPath(); g.arc(c, c, BR.outer * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d6312b'; g.beginPath(); g.arc(c, c, BR.bull * k, 0, Math.PI * 2); g.fill();
    // Wires.
    g.strokeStyle = '#c8ced8'; g.lineWidth = 3;
    for (const r of [BR.bull, BR.outer, BR.trebleIn, BR.trebleOut, BR.doubleIn, BR.doubleOut]) { g.beginPath(); g.arc(c, c, r * k, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 20; i++) {
      const a = (i * 18 - 9) * Math.PI / 180;
      g.beginPath(); g.moveTo(c + Math.sin(a) * BR.outer * k, c - Math.cos(a) * BR.outer * k);
      g.lineTo(c + Math.sin(a) * BR.doubleOut * k, c - Math.cos(a) * BR.doubleOut * k); g.stroke();
    }
    // Numbers round the outside.
    g.fillStyle = '#f4f4f4'; g.font = `700 112px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    NUMBERS.forEach((n, i) => { const a = i * 18 * Math.PI / 180, r = (BR.doubleOut + BR.board) / 2 * k; g.fillText(String(n), c + Math.sin(a) * r, c - Math.cos(a) * r + 6); });
    g.strokeStyle = '#b9c0cc'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.stroke();
  });

  const cabinet = new THREE.Group();
  cabinet.position.set(BOARD.x, BOARD.y, BOARD.z);
  root.add(cabinet);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(CABINET * 2, CABINET * 2, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.9 }));
  back.position.z = -0.015;
  cabinet.add(back);
  for (const s of [-1, 1]) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(CABINET * 2 + 0.06, 0.03, 0.1), wood);
    tb.position.set(0, s * (CABINET + 0.015), 0.035); cabinet.add(tb);
    const lr = new THREE.Mesh(new THREE.BoxGeometry(0.03, CABINET * 2, 0.1), wood);
    lr.position.set(s * (CABINET + 0.015), 0, 0.035); cabinet.add(lr);
  }
  // Doors, swung right open, with chalk scoreboards inside.
  const slate = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#20352b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(240,240,230,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(w / 2, 60); g.lineTo(w / 2, h - 20); g.moveTo(16, 60); g.lineTo(w - 16, 60); g.stroke();
    g.fillStyle = 'rgba(240,240,230,0.7)'; g.font = `600 34px ${FONT}`; g.textAlign = 'center';
    g.fillText('HOME', w / 4, 44); g.fillText('AWAY', w * 3 / 4, 44);
    g.font = `500 30px ${FONT}`;
    ['501', '441', '381', '300', '241'].forEach((s, i) => g.fillText(s, w / 4, 110 + i * 46));
    ['501', '455', '360', '320'].forEach((s, i) => g.fillText(s, w * 3 / 4, 110 + i * 46));
  });
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * (CABINET + 0.03), 0, 0.085);
    pivot.rotation.y = s * -2.7;
    const door = new THREE.Mesh(new THREE.BoxGeometry(CABINET, CABINET * 2 + 0.06, 0.02), wood);
    door.position.x = -s * CABINET / 2;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(CABINET - 0.07, CABINET * 2 - 0.08), new THREE.MeshStandardMaterial({ map: slate, roughness: 0.95 }));
    board.position.z = -0.011; board.rotation.y = Math.PI;
    door.add(board);
    pivot.add(door);
    cabinet.add(pivot);
  }
  const face = new THREE.Mesh(new THREE.CircleGeometry(BR.board, 128), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85 }));
  face.position.z = BOARD.face;
  cabinet.add(face);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(BR.board, BR.board, BOARD.face, 96, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 }));
  rim.position.z = BOARD.face / 2;
  cabinet.add(rim);
  // A slim light ring round the board's edge.
  const ringLight = new THREE.Mesh(new THREE.TorusGeometry(BR.board + 0.016, 0.007, 8, 96), new THREE.MeshBasicMaterial({ color: 0xfff4e2 }));
  ringLight.position.z = BOARD.face + 0.006;
  cabinet.add(ringLight);

  // The wall behind, the carpet and the oche.
  const wallTex = canvasTex(1024, 864, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h * (1 - BOARD.y / WALL.top), 20, w / 2, h * (1 - BOARD.y / WALL.top), w * 0.62);
    grd.addColorStop(0, '#24325a'); grd.addColorStop(1, '#0b1020');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff7a1a'; g.fillRect(0, h - 26, w, 10); g.fillRect(0, h - 10, w, 4);
    // Right at the top, so the VR banner (just above the cabinet) doesn't cover it.
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `900 70px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SPORTS HALL DARTS', w / 2, 48);
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(WALL.halfW * 2, WALL.top), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
  wall.position.set(0, WALL.top / 2, WALL.z);
  root.add(wall);
  const carpetLen = OCHE_Z + 1.3 - BOARD.z;
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(1.9, carpetLen), new THREE.MeshStandardMaterial({ color: 0x4a1620, roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.004, BOARD.z + carpetLen / 2);
  root.add(carpet);
  const oche = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.035, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9e2ec, metalness: 0.8, roughness: 0.25 }));
  oche.position.set(0, 0.0175, OCHE_Z + 0.025);
  root.add(oche);

  // Scoreboard: beside the board in VR, a corner of the screen otherwise.
  const card = new CanvasBoard(1.0, 0.64, 1000, 640);
  card.mesh.renderOrder = 5;
  root.add(card.mesh);
  // The score of each dart pops up beside it.
  const pop = new CanvasBoard(0.2, 0.08, 320, 128);
  pop.mesh.material.opacity = 0;
  root.add(pop.mesh);
  let popLeft = 0;

  // Glow on the bed to go for (Around the Clock, and a checkout hint).
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe35a, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
  glow.position.z = BOARD.face + 0.0015;
  glow.visible = false;
  cabinet.add(glow);
  let glowLabel = null;
  function setGlow(label, strong = true) {
    if (label === glowLabel) { glow.visible = !!label; glowMat.userData.strong = strong; return; }
    glowLabel = label; glowMat.userData.strong = strong;
    glow.visible = !!label;
    if (!label) return;
    const { n, mult } = parseLabel(label);
    glow.geometry.dispose();
    // (Round the clock, either bull counts.)
    if (n === 25) glow.geometry = S.mode === 'atc' ? new THREE.CircleGeometry(BR.outer, 32) : mult === 2 ? new THREE.CircleGeometry(BR.bull, 24) : new THREE.RingGeometry(BR.bull, BR.outer, 32);
    else {
      // (Round the clock and at Killer, any bed of the number counts.)
      const [r0, r1] = label === String(n) && (S.mode === 'atc' || S.mode === 'killer') ? [BR.outer, BR.doubleOut]
        : mult === 3 ? [BR.trebleIn, BR.trebleOut] : mult === 2 ? [BR.doubleIn, BR.doubleOut] : [BR.trebleOut, BR.doubleIn];
      glow.geometry = wedge(n, r0, r1);
    }
  }
  function wedge(n, r0, r1) {
    const mid = Math.PI / 2 - segmentAngle(n);
    return new THREE.RingGeometry(r0, r1, 8, 1, mid - Math.PI / 20, Math.PI / 10);
  }

  // Marks on the board itself. Killer: each player's number tinted in their
  // colour (with a bright edge once they're a killer). Cricket: numbers
  // everyone has closed are greyed out.
  const tags = new THREE.Group();
  tags.position.z = BOARD.face + 0.001;
  cabinet.add(tags);
  const tagMats = new Map();
  const tagMat = (hex, opacity) => {
    const key = `${hex}:${opacity}`;
    if (!tagMats.has(key)) tagMats.set(key, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false }));
    return tagMats.get(key);
  };
  function refreshTags() {
    for (const m of tags.children) m.geometry.dispose();
    tags.clear();
    const g = S.game;
    if (S.mode === 'killer') {
      g.numbers.forEach((n, p) => {
        if (!g.alive(p)) return;
        const col = S.players[p].flight;
        tags.add(new THREE.Mesh(wedge(n, BR.doubleOut + 0.004, BR.board - 0.004), tagMat(col, 0.42)));
        if (g.killer[p]) tags.add(new THREE.Mesh(wedge(n, BR.board - 0.013, BR.board - 0.003), tagMat(col, 1)));
      });
    } else if (S.mode === 'cricket') {
      for (const n of CRICKET_NUMS) {
        if (g.dead(n)) tags.add(new THREE.Mesh(n === 25 ? new THREE.CircleGeometry(BR.outer, 32) : wedge(n, BR.outer, BR.doubleOut), tagMat(0x05070c, 0.62)));
      }
    }
  }

  // Screen crosshair, and the aim dot (VR, full aim help).
  const sightMat = new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.95, depthWrite: false });
  const crosshair = new THREE.Group();
  crosshair.add(new THREE.Mesh(new THREE.RingGeometry(0.009, 0.0125, 32), sightMat), new THREE.Mesh(new THREE.CircleGeometry(0.0022, 12), sightMat));
  crosshair.visible = false;
  root.add(crosshair);
  const aimDot = crosshair.clone();
  aimDot.scale.setScalar(1.4);
  aimDot.visible = false;
  root.add(aimDot);

  // ----------------------------------------------------------------- darts --
  // Built tip first along -Z (the way it flies), the flights at the back.
  const GEO = (() => {
    const flight = new THREE.Shape();
    [[0, 0], [0.017, 0.02], [0.017, 0.04], [0, 0.035], [-0.017, 0.04], [-0.017, 0.02]].forEach(([x, y], i) => (i ? flight.lineTo(x, y) : flight.moveTo(x, y)));
    const f1 = new THREE.ShapeGeometry(flight).rotateX(Math.PI / 2).translate(0, 0, 0.098);
    return {
      point: new THREE.ConeGeometry(0.0013, 0.032, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.016),
      barrel: new THREE.CylinderGeometry(0.0036, 0.0032, 0.048, 14).rotateX(Math.PI / 2).translate(0, 0, 0.056),
      grip: new THREE.CylinderGeometry(0.0039, 0.0039, 0.012, 14).rotateX(Math.PI / 2),
      shaft: new THREE.CylinderGeometry(0.0019, 0.0016, 0.04, 8).rotateX(Math.PI / 2).translate(0, 0, 0.1),
      f1, f2: f1.clone().rotateZ(Math.PI / 2),
    };
  })();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.9, roughness: 0.25 });
  const tungsten = new THREE.MeshStandardMaterial({ color: 0x6c7380, metalness: 0.85, roughness: 0.35 });
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5 });
  const flightMats = new Map();
  const flightMat = hex => {
    if (!flightMats.has(hex)) flightMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, side: THREE.DoubleSide }));
    return flightMats.get(hex);
  };
  function makeDart(colour = YOU_FLIGHT) {
    const g = new THREE.Group();
    const grips = [0.044, 0.056, 0.068].map(z => { const m = new THREE.Mesh(GEO.grip, tungsten); m.position.z = z; return m; });
    g.add(new THREE.Mesh(GEO.point, steel), new THREE.Mesh(GEO.barrel, tungsten), ...grips, new THREE.Mesh(GEO.shaft, shaftMat));
    const fm = flightMat(colour);
    const f1 = new THREE.Mesh(GEO.f1, fm), f2 = new THREE.Mesh(GEO.f2, fm);
    g.add(f1, f2);
    g.userData.flights = [f1, f2];
    g.userData.colour = colour;
    return g;
  }
  const recolour = (d, hex) => { if (d.userData.colour !== hex) { d.userData.flights.forEach(f => { f.material = flightMat(hex); }); d.userData.colour = hex; } };
  // Point a dart (its tip at p) along direction v.
  const _dir = new THREE.Vector3();
  function pointDart(mesh, p, v) {
    mesh.position.set(p.x, p.y, p.z);
    _dir.set(v.x, v.y, v.z);
    if (_dir.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(FWD, _dir.normalize());
  }

  // The dart in your hand in VR (hangs from the controller's pointer).
  const handRig = makeDart(YOU_FLIGHT);
  handRig.position.set(0, -0.012, -0.125);
  handRig.visible = false;
  // On a screen, the dart you're about to throw sits at the bottom of the view.
  const screenDart = makeDart(YOU_FLIGHT);
  screenDart.visible = false;
  root.add(screenDart);
  // The robot's dart.
  const robotHandDart = makeDart(0xff7a1a);
  robotHandDart.visible = false;
  root.add(robotHandDart);

  // ---------------------------------------------------------------- state --
  const S = {
    mode: null,          // x01 | cricket | killer | atc | count | free
    game: null, players: [], opts: {},
    phase: 'idle',       // idle | aim | flying | robot | between | done
    t: 0, timers: [],
    visit: [],           // this visit's darts (hits)
    darts: [],           // darts in the air, in the board or on the floor
    hold: null,          // VR: your throw while the trigger's held
    press: null,         // screen: when you pressed
    aim: { x: 0, y: 0.103 }, aimSet: false,
    rob: null,           // the throwing robot's visit in progress
    cam: null, log: [], last: [],
  };
  const later = (sec, fn) => S.timers.push({ t: S.t + sec, fn });
  const turnIndex = () => S.game?.turn ?? 0;
  const player = () => S.players[turnIndex()];
  const robots = () => S.players.filter(p => p.kind === 'robot');
  const robotP = () => robots()[0] ?? null;      // the robot, in a game of two
  const humanTurn = () => player()?.kind === 'you';
  const isYou = p => p.name === 'You';
  const stillIn = p => S.mode !== 'killer' || S.game.alive(S.players.indexOf(p));
  const someRobot = (all = false) => { const r = robots().filter(p => all || stillIn(p)); return r[Math.floor(Math.random() * r.length)] ?? null; };

  // opts: { mode, start, doubleOut, legs, rival (a robot, or null for two people
  // taking turns); Killer: rivals (robots), players (people, without robots), lives;
  // robotsOnly: [two robots] to watch; label: what it's for (a cup round);
  // remote: a game with a friend on another screen: { names, me (our index),
  // host (we run it), first, numbers (Killer) } }
  function start(opts) {
    stopAll();
    S.preview = false;
    S.opts = opts;
    S.mode = opts.mode;
    S.t = 0; S.log = S.log ?? []; S.dartNo = 0; S.pending = null;
    const R = opts.remote;
    const person = (name, i) => ({ name, kind: 'you', flight: FLIGHTS[i] });
    const robot = r => ({ name: r.name, kind: 'robot', rival: r, flight: r.look.accent });
    if (R) {
      S.players = R.names.map((name, i) => (i === R.me ? person('You', i) : { name, kind: 'remote', flight: FLIGHTS[i] }));
      // Killer with a friend can have robots in it too (the host throws their
      // darts), and so can a cup match with a friend (theirs, yours, or two robots').
      if (opts.rivals?.length) S.players.push(...opts.rivals.map(robot));
    }
    else if (opts.robotsOnly) S.players = opts.robotsOnly.map(robot);
    else if (S.mode === 'killer') {
      S.players = opts.rivals?.length ? [person('You', 0), ...opts.rivals.map(robot)]
        : Array.from({ length: opts.players ?? 2 }, (_, i) => person(`Player ${i + 1}`, i));
    } else if (S.mode === 'x01' || S.mode === 'cricket') S.players = opts.rival ? [person('You', 0), robot(opts.rival)] : [person('Player 1', 0), person('Player 2', 1)];
    const n = S.players.length, first = R?.first ?? Math.floor(Math.random() * n);
    if (S.mode === 'x01') S.game = new X01({ start: opts.start, doubleOut: opts.doubleOut, legs: opts.legs, players: n, firstThrower: first });
    else if (S.mode === 'cricket') S.game = new Cricket({ legs: opts.legs, players: n, firstThrower: first });
    else if (S.mode === 'killer') S.game = new Killer({ players: n, lives: opts.lives ?? 3, firstThrower: first, numbers: R?.numbers ?? null });
    else {
      S.players = [person('You', 0)];
      S.game = S.mode === 'atc' ? new AroundClock() : S.mode === 'count' ? new CountUp(8) : null;
    }
    // Chopper's darts are blue like yours: then yours are pink (and a friend's
    // too, on both screens).
    for (const p of S.players) if (p.kind !== 'robot' && robots().some(r => r.flight === p.flight)) p.flight = 0xff4fa3;
    root.visible = true;
    // A robot model for each robot, waiting its turn.
    ctx.robots.forEach(m => { m.root.visible = false; });
    // (A friend waits in the first spot, so the robots start one further round.)
    const spot0 = S.players.some(p => p.kind === 'remote') ? 1 : 0;
    robots().forEach((rp, i) => {
      const wait = WAIT_SPOTS[Math.min(WAIT_SPOTS.length - 1, i + spot0)];
      Object.assign(rp, {
        model: ctx.robots[i], wait, pos: { ...wait },
        hand: new THREE.Vector3(wait.x + 0.2, 1.02, wait.z - 0.14),
        // A stand-in for the table tennis Bot, so the model can be posed: pad =
        // where its hand goes (plus 0.13 up), relative to the robot's root.
        bot: { side: 1, pad: { x: 0.8, y: 1.2, z: 0 }, swing: 0, mood: 0 },
      });
      rp.model.root.visible = true;
      rp.model.showPaddle(false);
      rp.model.setLook(rp.rival.look);
    });
    S.phase = 'between';
    S.cam = null;
    drawCard();
    const g = S.game, rp = robotP(), opener = S.players[turnIndex()];
    const firstUp = `${isYou(opener) ? 'you throw' : `${opener.name} throws`} first`;
    const legs = n => (n === 1 ? 'one leg' : `best of ${n} legs`);
    if (S.mode === 'x01' || S.mode === 'cricket') {
      const how = S.mode === 'x01' ? `${g.start} · ${legs(g.bestOf)} · ${g.doubleOut ? 'double out' : 'any finish'}` : `Cricket · ${legs(g.bestOf)}`;
      const [a, b] = S.players, title = isYou(b) ? `You v ${a.name}` : `${a.name} v ${b.name}`;
      showBanner(title, `${opts.label ? `${opts.label} · ` : ''}${how} · ${firstUp}`, rp ? hexStr(rp.flight) : C.accent, 3.2);
    } else if (S.mode === 'killer') {
      const names = S.players.map(p => (isYou(p) ? 'you' : p.name));
      showBanner('Killer', `${cap(names.slice(0, -1).join(', '))} and ${names[names.length - 1]} · ${g.startLives} lives · ${firstUp}`, C.accent, 3.2);
    } else {
      const t = { atc: ['Around the Clock', 'Hit 1, then 2, then 3... up to 20, then the bull'], count: ['Count-up', 'Eight visits of three darts: score all you can'], free: ['Free throw', 'Throw as many as you like'] }[S.mode];
      showBanner(t[0], t[1], C.accent2, 3);
    }
    if (rp) later(1.0, () => talk('start', true, someRobot()));
    later(2.6, beginVisit);
  }

  function beginVisit() {
    S.visit = [];
    clearDarts();
    const p = player(), g = S.game;
    if (p.kind === 'robot') {
      S.phase = 'robot'; S.rob = { dart: 0, step: 'walk', t: 0, next: S.t + 1.1 };
      recolour(robotHandDart, p.flight);
    } else {
      // Ours to throw, or (a friend on another screen) theirs: we wait for their dart.
      S.phase = p.kind === 'remote' ? 'remote' : 'aim';
      if (p.kind === 'you') { recolour(handRig, p.flight); recolour(screenDart, p.flight); }
      // Whose go it is, when people are sharing; at Killer, what you need.
      const whose = isYou(p) ? (S.players.filter(q => q.kind === 'you').length > 1 ? `${p.name} to throw` : 'Your turn') : `${p.name} to throw`;
      if (S.mode === 'killer') {
        // (People sharing this screen are all "you"; a friend elsewhere is "they".)
        const i = g.turn, more = 3 - g.hits[i], mine = p.kind === 'you', your = mine ? 'Your' : 'Their';
        showBanner(whose, g.killer[i] ? `${mine ? 'You\'re' : 'They\'re'} a killer: hitting the others' numbers` : `${your} number is ${g.numbers[i]}: ${more} more hit${more === 1 ? '' : 's'} to be a killer`, hexStr(p.flight), 1.8);
      } else if ((S.mode === 'x01' || S.mode === 'cricket') && !robotP()) {
        showBanner(whose, S.mode === 'x01' ? `${g.remaining} to go` : `${g.points[g.turn]} points`, hexStr(p.flight), 1.6);
      }
    }
    drawCard();
  }

  // ------------------------------------------------------- throwing a dart --
  // A dart leaves a hand. With a friend, the host decides where every dart goes
  // (`out`) and sends it on; the friend's screen plays the same darts.
  function launch(p0, v0, given = null) {
    const who = turnIndex();
    const out = given ?? flightOutcome(p0, v0);
    const mesh = makeDart(S.players[who].flight);
    pointDart(mesh, p0, v0);
    root.add(mesh);
    S.darts.push({ mesh, p0: { ...p0 }, v0: { ...v0 }, t: 0, out, who, state: 'fly' });
    sfx.play('swish', p0, Math.hypot(v0.x, v0.y, v0.z) / 7);
    if (['aim', 'remote', 'waiting'].includes(S.phase)) S.phase = 'flying';
    if (S.opts.remote?.host) ctx.sendDart?.({ n: S.dartNo, p0: { x: p0.x, y: p0.y, z: p0.z }, v0: { x: v0.x, y: v0.y, z: v0.z }, out });
    S.dartNo++;
    if (S.players[who].kind === 'remote') S.players[who].threwAt = S.t;
    return out;
  }

  // Playing a friend: the two screens keep their own clocks, so before a dart
  // from the other side, finish anything still in the air and skip the pauses
  // between visits until we're waiting for that dart too.
  function catchUp() {
    for (const d of S.darts) if (d.state === 'fly') land(d);
    // (A robot's visit counts as waiting too: on a friend's screen its darts come from the host.)
    for (let guard = 0; !['aim', 'remote', 'waiting', 'robot'].includes(S.phase) && S.timers.length && guard < 50; guard++) {
      S.timers.sort((a, b) => a.t - b.t);
      const tm = S.timers.shift();
      S.t = Math.max(S.t, tm.t);
      tm.fn();
    }
  }
  // Host: the friend's dart, as the board point they let go at. They throw from
  // beside you (where the robots throw).
  function remoteThrow(m) {
    catchUp();
    if (player()?.kind !== 'remote' || S.phase !== 'remote' || m.n !== S.dartNo) return false;
    if (![m.bx, m.by].every(v => Number.isFinite(v) && Math.abs(v) < 1.5)) return false;
    const p0 = new THREE.Vector3(THROW_SPOT.x + 0.2, 1.7, THROW_SPOT.z - 0.26);
    const tgt = { x: BOARD.x + m.bx, y: BOARD.y + m.by, z: FACE_Z };
    launch(p0, solveLaunch(p0, tgt, Math.hypot(tgt.x - p0.x, tgt.z - p0.z) / 6.2));
    return true;
  }
  // Friend's screen: a dart from the host. Our own darts fly from our own hand.
  function remoteDart(m) {
    catchUp();
    if (m.n !== S.dartNo || !m.out || !m.p0 || !m.v0) return false;
    let { p0, v0, out } = m;
    const from = S.pending?.p0;
    if (humanTurn() && from && ['board', 'cabinet', 'wall'].includes(out.kind)) {
      const T = Math.hypot(out.at.x - from.x, out.at.z - from.z) / 6.2;
      p0 = from; v0 = solveLaunch(from, out.at, T); out = { ...out, t: T };
    }
    S.pending = null;
    launch(p0, v0, out);
    // A robot's dart: its arm here goes straight to the follow-through, however far
    // through the throw it had got.
    if (player()?.kind === 'robot' && S.rob) {
      const R = S.rob;
      if (R.step === 'walk' || !R.label) robotAim(R);
      R.dart++; R.step = 'follow'; R.t = 0; R.next = Infinity;
    }
    return true;
  }
  // On a friend's screen the robots' darts are the host's to decide.
  const hostThrows = () => !!S.opts.remote && !S.opts.remote.host;

  function land(d) {
    const o = d.out, at = o.at, v = velAt(d.v0, o.t), speed = Math.hypot(v.x, v.y, v.z);
    if (o.kind === 'board' && o.bounce) {
      sfx.play('clink', at, 1);
      d.state = 'fall'; d.fp = { x: at.x, y: at.y, z: at.z + 0.01 }; d.fv = { x: (Math.random() - 0.5) * 0.5, y: 0.5, z: 1.1 }; d.ft = 0;
      popup(at, 'Bounce out!', '#ff9a5a');
    } else if (o.kind === 'board' || o.kind === 'cabinet' || o.kind === 'wall') {
      d.state = 'stuck';
      const n = { x: v.x / speed, y: v.y / speed, z: v.z / speed };
      pointDart(d.mesh, { x: at.x + n.x * 0.012, y: at.y + n.y * 0.012, z: at.z + n.z * 0.012 }, v);
      sfx.play(o.kind === 'board' ? 'dart' : 'clack', at, speed / 7);
      if (o.kind === 'board') popup(at, o.hit.score ? o.hit.label : 'Outside', o.hit.mult === 3 ? '#ff6b5a' : o.hit.mult === 2 ? '#58d68d' : o.hit.n === 25 ? '#ffd23f' : '#ffffff');
      else popup(at, 'Missed the board', '#ff9a5a');
    } else if (o.kind === 'floor') {
      lieOnFloor(d, at);
      sfx.play('floor', at, 0.6);
    } else d.mesh.visible = false;
    if (S.players[d.who].kind === 'you') {
      const l = S.log[S.log.length - 1];
      if (l && !l.result) l.result = o.kind === 'board' ? (o.bounce ? 'bounce out' : o.hit.score ? o.hit.label : 'outside the doubles') : o.kind === 'floor' ? 'fell short' : 'missed the board';
    }
    scored(o.hit);
  }
  function lieOnFloor(d, at) {
    d.state = 'floor';
    d.mesh.position.set(at.x, 0.006, at.z);
    d.mesh.quaternion.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), 'YXZ'));
    d.mesh.rotateX(Math.PI / 2);
  }

  // A dart has landed: tell the game.
  function scored(hit) {
    S.visit.push(hit);
    const p = player();
    let visitOver = false, result = null;
    if (S.mode === 'x01' || S.mode === 'cricket') { result = S.game.throwDart(hit); visitOver = result.done; }
    else if (S.mode === 'killer') { result = S.game.throwDart(hit); visitOver = result.done; killerNews(result.events, hit); }
    else if (S.mode === 'atc') {
      const r = S.game.throwDart(hit);
      if (r.ok) { sfx.play('target', null, 1); if (r.done) { drawCard(); return finishPractice(); } }
      visitOver = S.visit.length === 3;
    } else if (S.mode === 'count') { result = S.game.throwDart(hit); visitOver = result.visitDone; }
    else visitOver = S.visit.length === 3;
    drawCard();
    if (visitOver) return endVisit(result);
    if (p.kind === 'robot') S.rob.next = S.t + 0.75;
    else S.phase = p.kind === 'remote' ? 'remote' : 'aim';
  }

  function endVisit(r) {
    S.phase = 'between';
    const who = turnIndex(), p = S.players[who];
    const darts = S.visit.map(h => h.label).join(' · ');
    const gameShot = r => ctx.call(r.matchOver ? 'Game shot, and the match!' : 'Game shot, and the leg!');
    if (S.mode === 'x01') {
      const g = S.game, total = r.total, rp = robotP();
      const robot = p.kind === 'robot';
      if (p.kind === 'you' && rp) {
        stats.darts.high = Math.max(stats.darts.high ?? 0, total);
        if (total === 180) stats.darts.n180 = (stats.darts.n180 ?? 0) + 1;
        if (r.checkout) stats.darts.bestOut = Math.max(stats.darts.bestOut ?? 0, total);
        save('sh_stats', stats);
      }
      if (r.checkout) gameShot(r); else ctx.call(callFor(total, r.bust));
      const col = hexStr(p.flight);
      if (r.checkout) return legOver(p, `${isYou(p) ? 'You take' : `${p.name} takes`} the leg with ${total}`, 'legWin', 'pLegWin');
      if (r.bust) showBanner('Bust!', `${darts} · ${p.name === 'You' ? 'back to' : `${p.name} stays on`} ${g.scores[who]}`, C.bad, 2);
      else if (total === 180) {
        showBanner('ONE HUNDRED AND EIGHTY!', p.name === 'You' ? 'Three in the treble twenty!' : `${p.name}: maximum!`, '#d4af37', 3.2);
        sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
      } else {
        const what = total ? String(total) : 'No score';
        showBanner(p.name === 'You' ? what : `${p.name}: ${what}`, `${darts} · ${g.scores[who]} left`, total >= 100 ? '#d4af37' : col, 1.9);
        if (total >= 100) { sfx.play('cheer', null, 0.5); ctx.cheer(0.8); }
      }
      react(p, r.bust ? 'bust' : total === 180 ? 'max' : total >= 100 ? 'big' : total < 20 ? 'low' : null, total === 180,
        r.bust || total < 20 ? 'droop' : total === 180 ? 'dance' : total >= 100 ? 'pump' : null, total >= 100 ? 'droop' : null);
      later(r.bust ? 2.4 : total === 180 ? 3.6 : 2.2, () => { S.game.next(); beginVisit(); });
    } else if (S.mode === 'cricket') {
      const g = S.game, v = g.visit, marks = v.marks, rp = robotP();
      const horse = g.whiteHorse;
      if (p.kind === 'you' && rp) { stats.darts.bestMarks = Math.max(stats.darts.bestMarks ?? 0, marks); save('sh_stats', stats); }
      if (r.legWon) { gameShot(r); return legOver(p, `${isYou(p) ? 'You close' : `${p.name} closes`} the board`, 'cLegWin', 'pcLegWin'); }
      const what = marks ? `${marks} mark${marks > 1 ? 's' : ''}` : 'No marks';
      ctx.call(horse ? 'White horse!' : marks ? `${cap(words(marks))} mark${marks > 1 ? 's' : ''}${marks >= 6 ? '!' : ''}` : 'No score');
      showBanner(horse ? 'White horse!' : isYou(p) ? what : `${p.name}: ${what}`, `${darts}${v.points ? ` · ${v.points} points` : ''}`, marks >= 6 ? '#d4af37' : hexStr(p.flight), 1.9);
      if (marks === 9) { sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 }); }
      else if (marks >= 6) { sfx.play('cheer', null, 0.5); ctx.cheer(0.8); }
      react(p, marks >= 5 ? 'cBig' : marks === 0 ? 'low' : null, false,
        marks >= 7 ? 'dance' : marks >= 5 ? 'pump' : marks === 0 ? 'droop' : null, marks >= 6 ? 'droop' : null);
      later(marks === 9 ? 3.4 : 2.1, () => { S.game.next(); beginVisit(); });
    } else if (S.mode === 'killer') {
      // Each dart's news has had its banner already.
      if (S.game.over) { later(2.4, finishMatch); return; }
      later(2.0, () => { S.game.next(); beginVisit(); });
    } else if (S.mode === 'count') {
      const g = S.game, total = g.visits[g.visits.length - 1];
      ctx.call(callFor(total, false));
      if (g.done) { drawCard(); return finishPractice(); }
      showBanner(total ? String(total) : 'No score', `${darts} · round ${g.round} of ${g.rounds} · total ${g.total}`, total >= 100 ? '#d4af37' : C.accent2, 1.9);
      later(2.2, beginVisit);
    } else if (S.mode === 'free') {
      const total = S.visit.reduce((a, h) => a + h.score, 0);
      S.last.unshift(total); S.last.length = Math.min(S.last.length, 6);
      ctx.call(callFor(total, false));
      showBanner(total ? String(total) : 'No score', darts, total >= 100 ? '#d4af37' : C.accent2, 1.8);
      if (total === 180) { sfx.play('fanfare'); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 }); }
      later(2.0, beginVisit);
    } else later(1.4, beginVisit);
    drawCard();
  }

  // The robots react to a visit: a robot about its own throw (mood, and
  // `cheer` as it celebrates), otherwise its opponent about yours (the "p"
  // version of the mood). The opponent sulks (`sulk`) at a big one.
  const P_MOOD = { bust: 'pBust', max: 'pMax', big: 'pBig', low: 'pLow', cBig: 'pcBig' };
  function react(p, mood, force, cheer, sulk) {
    const other = S.players.find(q => q !== p && q.kind === 'robot');
    if (p.kind === 'robot') {
      if (mood) later(1.3, () => talk(mood, force, p));
      if (cheer) p.model.celebrate(cheer);
    } else if (other && P_MOOD[mood]) later(1.3, () => talk(P_MOOD[mood], force, other));
    if (other && sulk) other.model.celebrate(sulk);
  }

  // A leg won (x01 or cricket): on to the next, or the end of the match.
  function legOver(p, line, moment, pMoment) {
    const g = S.game, other = S.players.find(q => q !== p && q.kind === 'robot');
    if (!g.over) showBanner('Game shot!', `${line} · legs ${g.legsWon.join('–')}`, hexStr(p.flight), 3);
    sfx.play('cheer', null, 0.8); ctx.cheer(1.2);
    if (p.kind === 'robot') { talk(moment, true, p); p.model.celebrate('spin'); }
    else if (other) talk(pMoment, true, other);
    other?.model.celebrate('droop');
    later(3.4, () => {
      if (S.game.over) return finishMatch();
      S.game.next();
      const f = S.players[S.game.turn];
      showBanner(`Leg ${S.game.legNo + 1}`, `${isYou(f) ? 'You throw' : `${f.name} throws`} first`, C.accent2, 2);
      later(2.2, beginVisit);
    });
  }

  function finishMatch() {
    if (S.mode === 'killer') return finishKiller();
    const g = S.game, rp = robotP(), win = S.players[g.winner], cricket = S.mode === 'cricket';
    S.phase = 'done';
    const legs = `${g.legsWon[0]}–${g.legsWon[1]}`;
    const avg = cricket ? `marks per round ${g.mpr(0).toFixed(1)}` : `average ${g.average(0).toFixed(1)}`;
    const lose = S.players.find(q => q !== win);
    // (A cup match: what the result means, shown after the usual banner.)
    const note = ctx.onResult?.({ winner: g.winner, legsWon: [...g.legsWon] });
    if (note) later(2.8, () => showBanner(note.title, note.sub, note.colour, 3.4));
    if (!S.players.some(p => p.kind === 'you')) {
      // A match you watched: two robots, or (a cup with a friend) your friend's.
      showBanner(`${win.name} wins!`, `Legs ${g.legsWon[g.winner]}–${g.legsWon[1 - g.winner]}`, hexStr(win.flight), 5);
      win.model?.celebrate('dance'); lose.model?.celebrate('slump');
      if (win.kind === 'robot') later(1.0, () => talk('win', true, win));
      if (lose.kind === 'robot') later(3.6, () => talk('pWin', true, lose));
      sfx.play('fanfare'); ctx.cheer(2);
    } else if (rp) {
      const you = win.kind === 'you', D = stats.darts;
      const key = cricket ? (you ? 'cWins' : 'cLosses') : (you ? 'wins' : 'losses');
      D[key] = (D[key] ?? 0) + 1;
      if (you && !D.beaten.includes(rp.rival.id)) D.beaten.push(rp.rival.id);
      save('sh_stats', stats);
      showBanner(you ? 'You win!' : `${rp.name} wins`, `Legs ${legs} · your ${avg}`, you ? C.good : C.bad, 5);
      later(1.0, () => talk(you ? 'pWin' : 'win', true, rp));
      rp.model.celebrate(you ? 'slump' : 'dance');
      if (you) { sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 }); } else sfx.play('groan');
      ctx.lastResult?.(`${you ? 'You beat' : 'You lost to'} ${rp.name} at ${cricket ? 'cricket' : 'darts'}: legs ${legs}`, you);
    } else {
      showBanner(isYou(win) ? 'You win!' : `${win.name} wins!`, `Legs ${g.legsWon[g.winner]}–${g.legsWon[1 - g.winner]}`, hexStr(win.flight), 5);
      sfx.play(win.kind === 'remote' ? 'groan' : 'fanfare'); ctx.cheer(2);
      if (win.kind !== 'remote') ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
    }
    drawCard();
    later(6, () => ctx.onOver?.('darts'));
  }

  // Killer: each dart's news, as it lands.
  function killerNews(events, hit) {
    const g = S.game, by = player();
    if (events.some(e => e.kind === 'charge')) sfx.play('target', null, 0.7);
    const top = ['out', 'hit', 'self', 'killer'].map(k => events.find(e => e.kind === k)).find(Boolean);
    if (!top) return;
    const v = S.players[top.p], lives = g.lives[top.p];
    const left = `${isYou(v) ? 'You have' : `${v.name} has`} ${lives} ${lives === 1 ? 'life' : 'lives'} left`;
    if (top.kind === 'killer') {
      showBanner(isYou(v) ? 'You\'re a killer!' : `${v.name} is a killer!`, isYou(v) ? 'Now hit the others\' numbers' : `Watch your number${v.kind === 'robot' ? '' : 's'}!`, hexStr(v.flight), 2.2);
      sfx.play('fanfare');
      if (v.kind === 'robot') { talk('kKiller', false, v); v.model.celebrate('pump'); }
    } else if (top.kind === 'self') {
      showBanner(isYou(v) ? 'Your own number!' : `${v.name} hits ${v.kind === 'robot' ? 'its' : 'their'} own number!`, left, C.bad, 2);
      sfx.play('groan', null, 0.5);
      if (v.kind === 'robot') { talk('kSelf', true, v); v.model.celebrate('droop'); }
    } else if (top.kind === 'hit') {
      showBanner(`${isYou(by) ? 'You hit' : `${by.name} hits`} ${isYou(v) ? 'you' : v.name}!`, `${hit.label} · ${left}`, hexStr(by.flight), 2);
      sfx.play('cheer', null, isYou(by) ? 0.6 : 0.3); ctx.cheer(0.6);
      if (v.kind === 'robot') v.model.celebrate('droop');
      if (by.kind === 'robot') by.model.celebrate('pump');
      if (v.kind !== 'robot' && by.kind === 'robot') talk('kHit', false, by);
      else if (by.kind !== 'robot' && v.kind === 'robot') talk('kHurt', false, v);
    } else {
      const own = top.by === top.p;
      showBanner(isYou(v) ? 'You\'re out!' : `${v.name} is out!`,
        own ? `${isYou(v) ? 'Your' : v.kind === 'robot' ? 'Its' : 'Their'} own number finished ${isYou(v) ? 'you' : v.kind === 'robot' ? 'it' : 'them'} off` : `${isYou(by) ? 'You' : by.name} knocked ${isYou(v) ? 'you' : v.name} out with ${hit.label}`,
        isYou(v) ? C.bad : hexStr(by.flight), 2.4);
      sfx.play(isYou(v) ? 'groan' : 'cheer', null, 0.8); ctx.cheer(1);
      if (v.kind === 'robot') { v.model.celebrate('slump'); talk('kOut', true, v); }
      else if (isYou(v)) {
        talk('kYouOut', true, by.kind === 'robot' && by !== v ? by : someRobot());
        // (With a friend still in, it plays on at the usual pace.)
        const friendIn = S.players.some((q, i) => q.kind === 'remote' && g.alive(i));
        if (!g.over && !friendIn) later(2.6, () => showBanner('Who\'ll win?', S.opts.remote ? 'The robots play it out' : 'The robots play it out (quicker now) · or open the menu to play again', C.accent2, 3));
      }
      if (by.kind === 'robot' && by !== v) by.model.celebrate('dance');
    }
  }

  function finishKiller() {
    const g = S.game, win = S.players[g.winner], bots = robots();
    S.phase = 'done';
    if (bots.length) {
      // (You're not always player 1: on a friend's screen you're player 2.)
      const me = S.players.findIndex(isYou), you = isYou(win), D = stats.darts;
      D.kGames = (D.kGames ?? 0) + 1;
      if (you) D.kWins = (D.kWins ?? 0) + 1;
      save('sh_stats', stats);
      const place = you ? 1 : g.n - g.outOrder.indexOf(me);
      const names = S.players.filter(p => !isYou(p)).map(p => p.name), list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      if (you) {
        showBanner('You win!', `Last one standing, with ${g.lives[me]} ${g.lives[me] === 1 ? 'life' : 'lives'} left`, C.good, 5);
        sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
        bots.forEach(b => b.model.celebrate('slump'));
        later(1.0, () => talk('pWin', true, someRobot(true)));
      } else {
        showBanner(`${win.name} wins`, `Last one standing · you came ${ordinal(place)} of ${g.n}`, hexStr(win.flight), 5);
        sfx.play(win.kind === 'remote' ? 'cheer' : 'groan');
        if (win.kind === 'robot') { win.model.celebrate('dance'); later(1.0, () => talk('win', true, win)); }
        else { bots.forEach(b => b.model.celebrate('slump')); later(1.0, () => talk('pWin', true, someRobot(true))); }
      }
      ctx.lastResult?.(you ? `You beat ${list} at Killer` : `${win.name} won Killer: you came ${ordinal(place)} of ${g.n}`, you);
    } else {
      showBanner(isYou(win) ? 'You win!' : `${win.name} wins!`, 'Last one standing', hexStr(win.flight), 5);
      sfx.play('fanfare'); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
    }
    drawCard();
    later(6, () => ctx.onOver?.('darts'));
  }

  function finishPractice() {
    S.phase = 'done';
    const D = stats.darts;
    if (S.mode === 'atc') {
      const n = S.game.darts, best = D.atcBest, isBest = !best || n < best;
      if (isBest) D.atcBest = n;
      showBanner(`Round the clock in ${n} darts`, isBest ? (best ? `New best! (was ${best})` : 'Your first time round: that\'s the score to beat') : `Your best is ${best}`, isBest ? '#d4af37' : C.accent2, 5);
    } else {
      const n = S.game.total, best = D.countBest ?? 0, isBest = n > best;
      if (isBest) D.countBest = n;
      showBanner(`Count-up: ${n}`, isBest ? (best ? `New best! (was ${best})` : 'The score to beat') : `Your best is ${best}`, isBest ? '#d4af37' : C.accent2, 5);
    }
    save('sh_stats', stats);
    sfx.play('fanfare'); ctx.cheer(1.2);
    ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
    drawCard();
    later(5.5, () => ctx.onOver?.('dpractice'));
  }

  // A robot's comment on a moment (by default the one throwing, or any robot still in).
  let lastTalk = -9;
  function talk(moment, force = false, who = null) {
    const rp = who ?? (player()?.kind === 'robot' ? player() : someRobot());
    if (!rp) return;
    if (!force && (Math.random() > (DART_TALK_CHANCE[moment] ?? 0.5) || S.t - lastTalk < 3)) return;
    const line = dartLine(rp.rival, moment);
    if (!line) return;
    lastTalk = S.t;
    ctx.say(rp.rival, line, rp.model);
  }

  // ------------------------------------------------------------ the robots --
  const _h = new THREE.Vector3(), _t = new THREE.Vector3();
  function robotUpdate(dt) {
    let holding = false;
    for (const rp of robots()) holding = robotPose(rp, dt) || holding;
    robotHandDart.visible = holding;
    // A friend on another screen steps up beside you too (main.js draws them).
    for (const p of S.players) {
      if (p.kind !== 'remote') continue;
      const up = player() === p && ['remote', 'flying', 'between'].includes(S.phase);
      const spot = up ? THROW_SPOT : WAIT_SPOTS[0], k = Math.min(1, dt * 2.6);
      p.pos ??= { ...WAIT_SPOTS[0] };
      p.pos.x += (spot.x - p.pos.x) * k; p.pos.z += (spot.z - p.pos.z) * k;
      p.up = up;
    }
  }
  // Where a robot aims its next dart. Every dart at cricket and Killer is aimed
  // at one bed, so it gets the concentration of a finishing double.
  function robotAim(R) {
    const g = S.game;
    R.step = 'aim'; R.t = 0;
    if (S.mode === 'x01') { R.label = robotTarget(g.remaining, g.dartsLeft, g.doubleOut); R.finishing = g.hint()?.length === 1; }
    else { R.label = S.mode === 'cricket' ? cricketTarget(g, g.turn) : killerTarget(g, g.turn, goesForTrebles(player().rival.id)); R.finishing = true; }
  }
  // Pose one robot; returns whether it's holding a dart up to throw.
  function robotPose(rp, dt) {
    const up = player() === rp && ['robot', 'between', 'done'].includes(S.phase);
    const spot = up ? THROW_SPOT : rp.wait;
    const k = Math.min(1, dt * 2.6);
    rp.pos.x += (spot.x - rp.pos.x) * k; rp.pos.z += (spot.z - rp.pos.z) * k;
    const bx = rp.pos.x, bz = rp.pos.z;
    // Hand poses (world), relative to where the robot stands.
    const rest = { y: 1.02, z: bz - 0.14 }, aim = { y: 1.64, z: bz - 0.06 }, cock = { y: 1.68, z: bz + 0.07 }, rel = { y: 1.7, z: bz - 0.26 }, follow = { y: 1.52, z: bz - 0.44 };
    let want = rest, snap = false;
    const R = up && S.phase === 'robot' ? S.rob : null;
    let target = null;
    if (R) {
      R.t += dt;
      if (R.step === 'walk' && S.t >= R.next) robotAim(R);
      if (R.step === 'aim') { want = aim; if (R.t > 0.55) { R.step = 'cock'; R.t = 0; } }
      else if (R.step === 'cock') { want = cock; if (R.t > 0.2) { R.step = 'throw'; R.t = 0; } }
      else if (R.step === 'throw') {
        const f = Math.min(1, R.t / 0.09);
        want = { y: cock.y + (rel.y - cock.y) * f, z: cock.z + (rel.z - cock.z) * f }; snap = true;
        if (f >= 1) robotRelease(R);
      } else if (R.step === 'follow') { want = follow; if (S.t >= R.next) robotAim(R); }
      else if (R.step === 'held') want = cock;      // waiting for the host's dart (see robotRelease)
      if (R.label) { const a = aimPoint(R.label); target = _t.set(BOARD.x + a.x, BOARD.y + a.y, FACE_Z); }
    }
    const hx = bx + 0.2;
    if (snap) rp.hand.set(hx, want.y, want.z);
    else rp.hand.lerp(_h.set(hx, want.y, want.z), Math.min(1, dt * 12));
    rp.model.root.position.set(bx - 0.6, 0, bz - 2.22);
    const b = rp.bot;
    b.pad.x = 0.8;
    b.pad.y = rp.hand.y + 0.13;
    b.pad.z = rp.hand.z - (bz - 2.22);
    b.mood *= Math.pow(0.5, dt);
    const flying = S.darts.find(d => d.state === 'fly');
    const look = flying ? flying.mesh.position : target ?? _t.set(BOARD.x, BOARD.y, FACE_Z);
    rp.model.update(b, look, dt);
    // The dart in its hand, pointing at the board.
    const holding = !!R && ['aim', 'cock', 'throw', 'held'].includes(R.step);
    if (holding) {
      rp.model.handPos(_h);
      _h.z -= 0.06; _h.y += 0.02;
      pointDart(robotHandDart, _h, { x: (target?.x ?? 0) - _h.x, y: (target?.y ?? BOARD.y) - _h.y + 0.25, z: FACE_Z - _h.z });
    }
    return holding;
  }
  function robotRelease(R) {
    // A friend's screen: hold the dart up until the host's arrives (remoteDart throws it).
    if (hostThrows()) { R.step = 'held'; R.t = 0; return; }
    const p0 = robotHandDart.position.clone();
    const hitAt = robotDart(player().rival.id, R.label, Math.random, R.finishing);
    const tgt = { x: BOARD.x + hitAt.x, y: BOARD.y + hitAt.y, z: FACE_Z };
    const T = Math.hypot(tgt.x - p0.x, tgt.z - p0.z) / 6.4;
    launch(p0, solveLaunch(p0, tgt, T));
    R.dart++;
    R.step = 'follow'; R.t = 0; R.next = Infinity;     // the next dart once this one lands
  }

  // ------------------------------------------------------------- your throw --
  // VR: called every frame with whether you're holding the trigger or grip.
  const _d = new THREE.Vector3();
  function vrAim(holding) {
    const mine = S.phase === 'aim' && humanTurn();
    handRig.visible = mine;
    aimDot.visible = false;
    if (!mine || !handRig.parent) { S.hold = null; return; }
    const tip = handRig.getWorldPosition(_h);
    if (holding) {
      const H = S.hold ??= { samples: [], sight: null };
      H.samples.push({ t: S.t, x: tip.x, y: tip.y, z: tip.z });
      while (H.samples.length && S.t - H.samples[0].t > 0.3) H.samples.shift();
      // Where the dart points while your hand is still: that's what you're aiming at.
      // (A line from your eye past the tip was too touchy: the eye is so close to
      // the dart that a centimetre there is ten on the board.)
      const n = H.samples.length;
      const slow = n < 2 || Math.hypot(tip.x - H.samples[n - 2].x, tip.y - H.samples[n - 2].y, tip.z - H.samples[n - 2].z) / Math.max(1e-3, S.t - H.samples[n - 2].t) < 0.6;
      if (slow) H.sight = pointedAt(tip, handRig.getWorldDirection(_d).negate()) ?? H.sight;
      if (settings.dartsAssist === 'full' && H.sight && slow) { aimDot.visible = true; aimDot.position.set(H.sight.x, H.sight.y, FACE_Z + 0.004); }
    } else if (S.hold) {
      const v = releaseVelocity(S.hold.samples);
      const sight = S.hold.sight;
      S.hold = null;
      if (v && v.speed > MIN_THROW && v.z < -0.8) throwVR({ x: tip.x, y: tip.y, z: tip.z }, v, sight);
    }
  }
  // Where a line from the dart's tip along the dart meets the board, or null.
  function pointedAt(tip, dir) {
    if (dir.z > -0.2) return null;
    const s = (FACE_Z - tip.z) / dir.z;
    return { x: tip.x + dir.x * s, y: tip.y + dir.y * s };
  }
  function throwVR(p0, v, sight) {
    const power = settings.dartsPower ?? 1;
    let v0 = { x: v.x * power, y: v.y * power, z: v.z * power };
    let moved = 0;
    const A = ASSIST[settings.dartsAssist] ?? ASSIST.light;
    if (A.k && sight && v0.z < 0 && p0.z > FACE_Z) {
      const T = (FACE_Z - p0.z) / v0.z;
      const raw = posAt(p0, v0, T);
      const d = Math.hypot(sight.x - raw.x, sight.y - raw.y);
      if (d < A.reach) {
        v0 = solveLaunch(p0, { x: raw.x + (sight.x - raw.x) * A.k, y: raw.y + (sight.y - raw.y) * A.k, z: FACE_Z }, T);
        moved = d * A.k;
      }
    }
    logThrow(Math.hypot(v.x, v.y, v.z) * power, moved);
    ctx.haptic?.(0.25, 18);
    handRig.visible = false;
    launch(p0, v0);
  }
  function logThrow(speed, moved) {
    S.log.push({ speed, moved, result: null });
    if (S.log.length > 8) S.log.shift();
  }

  // Screen: the aim point drifts a little; hold still (about a second) for the
  // steadiest aim, but not so long that your arm tires.
  function sway() {
    const help = SWAY[settings.dartsAssist] ?? 1;
    const hold = S.press ? S.t - S.press.t : 0;
    const amp = help * (0.004 + 0.007 * Math.max(0, 1 - hold / 0.9) + 0.012 * Math.min(1, Math.max(0, hold - 1.6) / 2));
    const t = S.t;
    return { x: amp * (Math.sin(t * 1.3 + 0.4) + 0.6 * Math.sin(t * 2.9 + 1.7)) / 1.6, y: amp * (Math.sin(t * 1.7 + 2.1) + 0.6 * Math.sin(t * 3.3 + 0.2)) / 1.6 };
  }
  const facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -FACE_Z);
  function boardAt(ndc) {
    ctx.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    return ctx.raycaster.ray.intersectPlane(facePlane, p) ? p : null;
  }
  const screenTurn = () => root.visible && S.phase === 'aim' && humanTurn() && !ctx.isXR();
  function pointerMove(ndc) {
    const p = boardAt(ndc);
    if (p) { S.aim = { x: p.x - BOARD.x, y: p.y - BOARD.y }; S.aimSet = true; }
  }
  function pointerDown(ndc) {
    if (!screenTurn()) return false;
    pointerMove(ndc);
    S.press = { t: S.t };
    return true;
  }
  function pointerUp() {
    if (!S.press) return;
    S.press = null;
    if (!screenTurn()) return;
    const sw = sway(), err = 0.004 * (SWAY[settings.dartsAssist] ?? 1);
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.41;
    throwAt({ x: S.aim.x + sw.x + g() * err, y: S.aim.y + sw.y + g() * err });
  }
  // Throw the screen dart at a board point (also the test hook).
  function throwAt(b) {
    const p0 = screenDart.visible ? screenDart.position.clone() : new THREE.Vector3(0.12, 1.55, OCHE_Z + 0.1);
    const tgt = { x: BOARD.x + b.x, y: BOARD.y + b.y, z: FACE_Z };
    screenDart.visible = false;
    // On a friend's game: send it to them, and throw it when it comes back.
    if (S.opts.remote && !S.opts.remote.host) {
      S.pending = { p0 };
      S.phase = 'waiting';
      ctx.sendThrow?.({ n: S.dartNo, bx: +b.x.toFixed(4), by: +b.y.toFixed(4) });
      return;
    }
    launch(p0, solveLaunch(p0, tgt, Math.hypot(tgt.x - p0.x, tgt.z - p0.z) / 6.2));
  }

  // ------------------------------------------------------------- the views --
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  const camWant = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  function screenCamera(dt, paused) {
    const aspect = window.innerWidth / window.innerHeight;
    // Like the telly: the robot's face as it aims, then the board as the dart lands.
    const robotAiming = !paused && S.phase === 'robot' && S.rob && S.rob.step !== 'follow' && player().pos;
    if (paused) {
      camWant.pos.set(DARTS_VIEW.x, 1.42, DARTS_VIEW.z + 0.05);
      camWant.look.set(DARTS_VIEW.x, 1.32, DARTS_VIEW.z - 1.12);
      camWant.fov = aspect < 1 ? Math.min(100, 62 * Math.pow(1 / aspect, 0.65)) : 62;
    } else if (robotAiming) {
      camWant.pos.set(0.45, 1.72, BOARD.z + 1.0);
      camWant.look.set(player().pos.x + 0.1, 1.45, player().pos.z);
      camWant.fov = aspect < 1 ? 56 : 34;
    } else {
      const d = OCHE_Z + 0.25 - FACE_Z;
      camWant.pos.set(0, 1.7, OCHE_Z + 0.25);
      camWant.look.set(0, 1.7, BOARD.z);
      // The whole board and a little round it, on a wide or an upright screen.
      const half = Math.max(Math.atan(0.42 / d), Math.atan(Math.tan(Math.atan(0.34 / d)) / aspect));
      camWant.fov = THREE.MathUtils.radToDeg(half * 2);
    }
    if (!S.cam) S.cam = { pos: camWant.pos.clone(), look: camWant.look.clone(), fov: camWant.fov };
    const k = dt < 0 ? 1 : Math.min(1, dt * 4);
    S.cam.pos.lerp(camWant.pos, k); S.cam.look.lerp(camWant.look, k);
    S.cam.fov += (camWant.fov - S.cam.fov) * k;
    camera.position.copy(S.cam.pos);
    camera.lookAt(S.cam.look);
    camera.fov = S.cam.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  // Something stuck to the screen: wFrac of its width, centred at (cx, cy) in -1..1.
  function hud(mesh, baseW, baseH, wFrac, cx, cy) {
    const d = 0.5, halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
    const s = wFrac * 2 * halfW / baseW;
    mesh.scale.setScalar(s);
    mesh.position.copy(camera.position).add(_v.set(cx * halfW, cy * halfH, -d).applyQuaternion(camera.quaternion));
    mesh.quaternion.copy(camera.quaternion);
  }
  function placeBoards(xr) {
    const bm = ctx.banner;
    if (xr) {
      card.mesh.scale.setScalar(1);
      card.mesh.position.set(1.48, 1.62, BOARD.z + 0.55);     // clear of the open cabinet door
      card.mesh.rotation.set(0, -0.45, 0);
      // Between the cabinet and the wall sign; its bottom edge stays above
      // your sight line to the top of the board.
      bm.scale.setScalar(0.9);
      bm.position.set(0, 2.2, BOARD.z + 0.12);
      bm.rotation.set(0, 0, 0);
      return;
    }
    // Upright screens: scores along the top, messages along the bottom.
    // Wide screens: scores in the bottom-left corner, messages along the top.
    const hudH = (baseW, baseH, wFrac) => wFrac * 2 * camera.aspect * baseH / baseW;
    if (camera.aspect < 1) {
      hud(card.mesh, 1.0, 0.64, 0.94, 0, 1 - hudH(1.0, 0.64, 0.94) / 2 - 0.03);
      hud(bm, 1.5, 0.375, 0.94, 0, -1 + hudH(1.5, 0.375, 0.94) / 2 + 0.05);
    } else {
      hud(card.mesh, 1.0, 0.64, 0.3, -1 + 0.3 + 0.03, -1 + hudH(1.0, 0.64, 0.3) / 2 + 0.04);
      hud(bm, 1.5, 0.375, 0.4, 0, 1 - hudH(1.5, 0.375, 0.4) / 2 - 0.03);
    }
  }
  function placeScreenDart() {
    const show = screenTurn();
    screenDart.visible = show;
    crosshair.visible = show && S.aimSet;
    if (!show) return;
    const sw = sway();
    const ax = BOARD.x + S.aim.x + sw.x, ay = BOARD.y + S.aim.y + sw.y;
    crosshair.position.set(ax, ay, FACE_Z + 0.003);
    const d = 0.55, halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
    _v.set(0.62 * halfW, -0.78 * halfH, -d).applyQuaternion(camera.quaternion).add(camera.position);
    pointDart(screenDart, _v, { x: ax - _v.x, y: ay - _v.y + 0.12, z: FACE_Z - _v.z });
  }

  // ------------------------------------------------------------ the popup --
  function popup(at, text, colour) {
    const g = pop.g, w = pop.w, h = pop.h;
    g.clearRect(0, 0, w, h);
    roundRect(g, 6, 6, w - 12, h - 12, 28);
    g.fillStyle = 'rgba(8,12,22,0.88)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = colour; g.stroke();
    g.fillStyle = colour; g.font = `800 ${text.length > 8 ? 40 : 66}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
    pop.flush();
    const side = at.x - BOARD.x > 0.1 ? -1 : 1;
    pop.mesh.position.set(Math.max(-0.75, Math.min(0.75, at.x + side * 0.14)), Math.min(2.35, Math.max(1.1, at.y + 0.05)), FACE_Z + 0.05);
    popLeft = 1.3;
  }

  // ------------------------------------------------------------ scoreboard --
  const hexStr = n => '#' + n.toString(16).padStart(6, '0');
  function drawCard() {
    refreshTags();
    const g = card.g, w = card.w, h = card.h;
    g.clearRect(0, 0, w, h);
    roundRect(g, 6, 6, w - 12, h - 12, 36);
    g.fillStyle = 'rgba(8,12,22,0.92)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#2c3954'; g.stroke();
    g.textBaseline = 'middle';
    const title = (left, right) => {
      g.textAlign = 'left'; g.fillStyle = C.accent; g.font = `800 40px ${FONT}`; g.fillText(left, 44, 58);
      g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `600 30px ${FONT}`; g.fillText(right, w - 44, 58);
    };
    const visitLine = y => {
      const shown = [0, 1, 2].map(i => S.visit[i]?.label ?? '–');
      g.textAlign = 'left'; g.fillStyle = C.dim; g.font = `600 30px ${FONT}`; g.fillText('This visit', 44, y);
      shown.forEach((s, i) => { g.fillStyle = S.visit[i] ? '#fff' : '#55627e'; g.font = `800 40px ${FONT}`; g.fillText(s, 230 + i * 150, y); });
    };
    if (S.mode === 'x01') {
      const G = S.game;
      title(`${G.start} · ${G.doubleOut ? 'DOUBLE OUT' : 'ANY FINISH'}`, `Leg ${G.legNo + 1}${G.bestOf > 1 ? ` · best of ${G.bestOf}` : ''}`);
      S.players.forEach((p, i) => {
        const y = 150 + i * 150, up = G.turn === i && !G.over;
        roundRect(g, 30, y - 64, w - 60, 128, 24);
        g.fillStyle = up ? '#17284a' : '#141b2c'; g.fill();
        if (up) { g.lineWidth = 4; g.strokeStyle = hexStr(p.flight); g.stroke(); }
        g.beginPath(); g.arc(70, y - 20, 13, 0, Math.PI * 2); g.fillStyle = hexStr(p.flight); g.fill();
        g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 44px ${FONT}`; g.fillText(p.name, 98, y - 20);
        // Legs won.
        for (let k = 0; k < G.legsToWin; k++) { g.beginPath(); g.arc(104 + k * 32, y + 30, 10, 0, Math.PI * 2); g.fillStyle = k < G.legsWon[i] ? '#ffd23f' : '#33405e'; g.fill(); }
        g.fillStyle = C.dim; g.font = `500 28px ${FONT}`;
        g.fillText(`avg ${G.average(i).toFixed(1)}`, 104 + G.legsToWin * 32, y + 31);
        g.textAlign = 'right'; g.fillStyle = up ? '#ffd23f' : '#c9d6f2'; g.font = `900 96px ${FONT}`;
        g.fillText(String(G.scores[i]), w - 60, y + 6);
      });
      visitLine(470);
      const hint = humanTurn() && !G.over && S.phase !== 'between' ? G.hint() : null;
      g.textAlign = 'left'; g.font = `700 32px ${FONT}`;
      if (hint) { g.fillStyle = '#58d68d'; g.fillText(`Checkout: ${hint.join('  ')}`, 44, 560); }
      else if (G.doubleOut && humanTurn() && G.remaining <= 170 && !G.over) { g.fillStyle = C.dim; g.fillText('No checkout with these darts: set one up', 44, 560); }
      else if (!G.doubleOut && humanTurn() && G.remaining <= 60 && !G.over) { g.fillStyle = C.dim; g.fillText(`Hit exactly ${G.remaining} to win the leg`, 44, 560); }
    } else if (S.mode === 'cricket') {
      const K = S.game, cx = w / 2;
      title('CRICKET', `Leg ${K.legNo + 1}${K.bestOf > 1 ? ` · best of ${K.bestOf}` : ''}`);
      S.players.forEach((p, i) => {
        const x0 = i ? cx + 10 : 30, bw = cx - 40, up = K.turn === i && !K.over;
        roundRect(g, x0, 92, bw, 122, 22);
        g.fillStyle = up ? '#17284a' : '#141b2c'; g.fill();
        if (up) { g.lineWidth = 4; g.strokeStyle = hexStr(p.flight); g.stroke(); }
        g.beginPath(); g.arc(x0 + 34, 128, 12, 0, Math.PI * 2); g.fillStyle = hexStr(p.flight); g.fill();
        g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `800 38px ${FONT}`; g.fillText(p.name, x0 + 58, 128);
        for (let k = 0; k < K.legsToWin; k++) { g.beginPath(); g.arc(x0 + 40 + k * 30, 180, 9, 0, Math.PI * 2); g.fillStyle = k < K.legsWon[i] ? '#ffd23f' : '#33405e'; g.fill(); }
        g.fillStyle = C.dim; g.font = `500 26px ${FONT}`;
        g.fillText(`${K.mpr(i).toFixed(1)} a round`, x0 + 32 + K.legsToWin * 30, 181);
        g.textAlign = 'right'; g.fillStyle = up ? '#ffd23f' : '#c9d6f2'; g.font = `900 72px ${FONT}`;
        g.fillText(String(K.points[i]), x0 + bw - 24, 158);
      });
      // The numbers down the middle, each player's marks either side: / X and ⊗ (closed).
      const tip = humanTurn() && !K.over && S.phase !== 'between' ? parseLabel(cricketTarget(K, K.turn)).n : null;
      const marks = (x, y, m, col) => {
        if (!m) return;
        const r = 13;
        g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - r, y + r); g.lineTo(x + r, y - r);
        if (m >= 2) { g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); }
        g.stroke();
        if (m >= 3) { g.lineWidth = 4; g.beginPath(); g.arc(x, y, r + 6, 0, Math.PI * 2); g.stroke(); }
        g.lineCap = 'butt';
      };
      CRICKET_NUMS.forEach((n, j) => {
        const y = 250 + j * 40, dead = K.dead(n);
        if (tip === n) { roundRect(g, cx - 70, y - 18, 140, 36, 12); g.fillStyle = 'rgba(255,227,90,0.2)'; g.fill(); }
        if (dead) { g.fillStyle = '#2a3346'; g.fillRect(cx - 230, y - 2, 460, 4); }
        g.textAlign = 'center'; g.fillStyle = dead ? '#55627e' : tip === n ? '#ffd23f' : '#fff'; g.font = `800 32px ${FONT}`;
        g.fillText(n === 25 ? 'Bull' : String(n), cx, y + 1);
        S.players.forEach((p, i) => marks(i ? cx + 150 : cx - 150, y, K.marks[i][n], dead ? '#55627e' : hexStr(p.flight)));
      });
      visitLine(552);
    } else if (S.mode === 'killer') {
      const Kl = S.game, n = S.players.length, rowH = n > 3 ? 92 : 108;
      title('KILLER', `${Kl.startLives} lives · last one standing`);
      S.players.forEach((p, i) => {
        const y = 96 + i * (rowH + 10), cy = y + rowH / 2, up = Kl.turn === i && !Kl.over, alive = Kl.alive(i);
        roundRect(g, 30, y, w - 60, rowH, 22);
        g.fillStyle = up ? '#17284a' : alive ? '#141b2c' : '#0d111b'; g.fill();
        if (up) { g.lineWidth = 4; g.strokeStyle = hexStr(p.flight); g.stroke(); }
        g.beginPath(); g.arc(70, cy, 13, 0, Math.PI * 2); g.fillStyle = alive ? hexStr(p.flight) : '#33405e'; g.fill();
        g.textAlign = 'left'; g.fillStyle = alive ? '#fff' : '#55627e'; g.font = `800 42px ${FONT}`; g.fillText(p.name, 98, cy);
        // Their number, in their colour.
        roundRect(g, 380, cy - 34, 112, 68, 16);
        g.globalAlpha = alive ? 0.32 : 0.12; g.fillStyle = hexStr(p.flight); g.fill(); g.globalAlpha = 1;
        g.textAlign = 'center'; g.fillStyle = alive ? '#fff' : '#55627e'; g.font = `900 50px ${FONT}`; g.fillText(String(Kl.numbers[i]), 436, cy + 2);
        if (!alive) { g.textAlign = 'right'; g.fillStyle = '#ff6b6b'; g.font = `800 40px ${FONT}`; g.fillText(`OUT (${ordinal(n - Kl.outOrder.indexOf(i))})`, w - 60, cy); return; }
        if (Kl.killer[i]) {
          roundRect(g, 520, cy - 24, 164, 48, 24); g.fillStyle = '#d6312b'; g.fill();
          g.fillStyle = '#fff'; g.font = `900 28px ${FONT}`; g.fillText('KILLER', 602, cy + 1);
        } else {
          for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(540 + k * 36, cy, 12, 0, Math.PI * 2); g.fillStyle = k < Kl.hits[i] ? hexStr(p.flight) : '#33405e'; g.fill(); }
        }
        // Lives.
        g.textAlign = 'right'; g.font = `900 40px ${FONT}`;
        for (let k = 0; k < Kl.startLives; k++) { g.fillStyle = k < Kl.lives[i] ? '#ff5a6e' : '#2a3346'; g.fillText('♥', w - 60 - k * 42, cy + 2); }
      });
      visitLine(Math.min(560, 96 + n * (rowH + 10) + 44));
    } else if (S.mode === 'atc') {
      const A = S.game;
      title('AROUND THE CLOCK', stats.darts.atcBest ? `Best: ${stats.darts.atcBest} darts` : 'Fewest darts wins');
      g.textAlign = 'left'; g.fillStyle = C.dim; g.font = `600 34px ${FONT}`; g.fillText(A.done ? 'All done!' : 'Next', 44, 150);
      g.fillStyle = '#ffd23f'; g.font = `900 150px ${FONT}`; g.fillText(A.done ? '✓' : A.targetLabel, 44, 260);
      g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `600 34px ${FONT}`; g.fillText('Darts', w - 50, 150);
      g.fillStyle = '#fff'; g.font = `900 110px ${FONT}`; g.fillText(String(A.darts), w - 50, 250);
      ATC_ORDER.forEach((n, i) => {
        const x = 44 + (i % 11) * 84, y = 370 + Math.floor(i / 11) * 70;
        roundRect(g, x, y - 28, 74, 56, 12);
        g.fillStyle = i < A.i ? '#1f8a4c' : i === A.i ? '#ffd23f' : '#1b2438'; g.fill();
        g.fillStyle = i === A.i ? '#0e1320' : '#fff'; g.font = `800 28px ${FONT}`; g.textAlign = 'center';
        g.fillText(n === 25 ? 'B' : String(n), x + 37, y + 2);
      });
      visitLine(560);
    } else if (S.mode === 'count') {
      const U = S.game;
      title('COUNT-UP', stats.darts.countBest ? `Best: ${stats.darts.countBest}` : 'Score all you can');
      g.textAlign = 'left'; g.fillStyle = C.dim; g.font = `600 34px ${FONT}`; g.fillText(`Round ${Math.min(U.round + 1, U.rounds)} of ${U.rounds}`, 44, 150);
      g.fillStyle = '#ffd23f'; g.font = `900 150px ${FONT}`; g.fillText(String(U.total), 44, 270);
      g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `600 30px ${FONT}`;
      U.visits.slice(-4).forEach((v, i, a) => g.fillText(`Round ${U.visits.length - a.length + i + 1}: ${v}`, w - 50, 150 + i * 46));
      visitLine(470);
    } else {
      title('FREE THROW', 'Practice anything');
      visitLine(160);
      const total = S.visit.reduce((a, h2) => a + h2.score, 0);
      g.textAlign = 'left'; g.fillStyle = '#ffd23f'; g.font = `900 130px ${FONT}`; g.fillText(String(total), 44, 300);
      g.fillStyle = C.dim; g.font = `600 30px ${FONT}`;
      if (S.last.length) g.fillText(`Last visits: ${S.last.join(' · ')}`, 44, 420);
    }
    g.textAlign = 'left'; g.fillStyle = '#55627e'; g.font = `500 24px ${FONT}`;
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    g.fillText(ctx.isXR() ? 'Hold the trigger, throw, let go · X/Y: menu' : touch ? 'Touch the board to aim, hold still, lift your finger to throw' : 'Point at the board, press, let go when it\'s steady · Esc: menu', 44, h - 34);
    card.flush();
  }

  // ----------------------------------------------------------------- frame --
  function update(dt, { xr, paused, holding, mr }) {
    if (!root.visible || S.preview) return;
    wall.visible = !mr;
    if (!xr) screenCamera(dt, paused);
    placeBoards(xr);
    card.mesh.visible = xr || !paused;      // on a screen, out of the menu's way
    // (Paused in VR, the dart stays in your hand: it can't be thrown from the menu.)
    if (paused) { handRig.visible = !!xr; screenDart.visible = false; crosshair.visible = false; aimDot.visible = false; S.hold = null; S.press = null; return; }
    // Out of a Killer game against robots: they play it out a bit quicker.
    // (Not on a friend's game: both screens keep to the same pace.)
    if (S.mode === 'killer' && S.phase !== 'done' && !S.opts.remote && !S.players.some((p, i) => p.kind === 'you' && S.game.alive(i))) dt *= 1.7;
    S.t += dt;
    const due = S.timers.filter(t => t.t <= S.t);
    if (due.length) { S.timers = S.timers.filter(t => t.t > S.t); due.forEach(t => t.fn()); }
    for (const d of S.darts) {
      if (d.state === 'fly') {
        d.t += dt;
        if (d.t >= d.out.t) land(d);
        else pointDart(d.mesh, posAt(d.p0, d.v0, d.t), velAt(d.v0, d.t));
      } else if (d.state === 'fall') {
        d.ft += dt;
        const p = posAt(d.fp, d.fv, d.ft);
        if (p.y <= 0.01) lieOnFloor(d, p);
        else { d.mesh.position.set(p.x, p.y, p.z); d.mesh.rotateX(dt * 9); }
      }
    }
    robotUpdate(dt);
    if (xr) vrAim(holding);
    else { handRig.visible = false; placeScreenDart(); }
    // The glow: the next number round the clock, your checkout's first dart, the
    // number to go for at cricket, or your own number at Killer until you're a killer.
    const tip = humanTurn() && S.phase === 'aim' && settings.dartsHints !== false;
    const g = S.game;
    if (S.mode === 'atc' && !g.done) setGlow(g.targetLabel);
    else if (tip && S.mode === 'x01') setGlow(g.hint()?.[0] ?? null, false);
    else if (tip && S.mode === 'cricket') setGlow(cricketTarget(g, g.turn), false);
    else if (tip && S.mode === 'killer' && !g.killer[g.turn]) setGlow(String(g.numbers[g.turn]), false);
    else setGlow(null);
    glowMat.opacity = (glowMat.userData.strong ? 0.4 : 0.22) + Math.sin(S.t * 5) * 0.1;
    if (popLeft > 0) popLeft -= dt;
    pop.mesh.material.opacity += ((popLeft > 0 ? 1 : 0) - pop.mesh.material.opacity) * Math.min(1, dt * 10);
    pop.mesh.visible = pop.mesh.material.opacity > 0.02;
  }

  function clearDarts() {
    for (const d of S.darts) d.mesh.removeFromParent();
    S.darts = [];
  }
  function stopAll() {
    S.timers = []; S.rob = null; S.hold = null; S.press = null;
    clearDarts();
    handRig.visible = screenDart.visible = crosshair.visible = aimDot.visible = robotHandDart.visible = false;
    setGlow(null);
    for (const m of tags.children) m.geometry.dispose();
    tags.clear();
    popLeft = 0;
  }

  return {
    handRig,
    get active() { return root.visible && !S.preview; },
    get phase() { return S.phase; },
    get state() { return S; },
    get log() { return S.log; },
    start,
    stop() { stopAll(); S.preview = false; root.visible = false; S.phase = 'idle'; S.mode = null; },
    // The menu's view (darts picked, no game on): the stage, empty. mr: no wall.
    preview(on, mr = false) {
      if (!on) { if (S.preview) { S.preview = false; root.visible = false; handRig.visible = false; } return; }
      if (root.visible && !S.preview) return;    // a game is on
      stopAll();
      S.preview = true; S.phase = 'idle'; S.mode = null;
      card.mesh.visible = false; pop.mesh.visible = false; wall.visible = !mr;
      // A dart in your hand (in VR) while you pick the game.
      recolour(handRig, YOU_FLIGHT); handRig.visible = true;
      root.visible = true;
    },
    update, pointerDown, pointerMove, pointerUp,
    snapCamera() { S.cam = null; screenCamera(-1, false); },
    inProgress: () => root.visible && !S.preview && S.phase !== 'done' && S.phase !== 'idle',
    redraw: drawCard,
    // Playing a friend: their dart arriving (host), a dart from the host (friend's screen).
    remoteThrow, remoteDart,
    // How the game was set up, for the friend's screen to start the same game.
    get setup() { const g = S.game; return { first: g.legStarter ?? g.turn, numbers: g.numbers ?? null }; },
    // The friend, for drawing them: where they stand, whether they're up, how long since they threw.
    get friend() { const p = S.players.find(q => q.kind === 'remote'); return p?.pos ? { pos: p.pos, up: p.up, since: S.t - (p.threwAt ?? -9) } : null; },
    // For tests: throw your next dart at a board point (board coordinates).
    testThrow(x, y) { if (S.phase !== 'aim' || !humanTurn()) return false; throwAt({ x, y }); return true; },
    // For tests: a VR-style throw from p0 with velocity v (world), with an optional sight point.
    testThrowVR(p0, v, sight = null) { if (S.phase !== 'aim' || !humanTurn()) return false; throwVR(p0, { ...v, speed: Math.hypot(v.x, v.y, v.z) }, sight); return true; },
  };
}
