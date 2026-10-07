// Darts: the board in its cabinet on a little stage, darts flying and sticking,
// visits and legs, the scoreboard, the caller and a robot at the oche. In VR
// you hold a dart (trigger or grip) and throw it for real; on a screen you
// point at the board and let go when your aim is steady.
import * as THREE from 'three';
import { R as BR, NUMBERS, BOARD, FACE_Z, OCHE_Z, CABINET, WALL, aimPoint, segmentAngle, parseLabel } from './board.js';
import { X01, AroundClock, CountUp, ATC_ORDER, robotTarget } from './rules.js';
import { flightOutcome, solveLaunch, releaseVelocity, posAt, velAt } from './flight.js';
import { robotDart, dartLine, DART_TALK_CHANCE, callFor } from './robots.js';
import { CanvasBoard, roundRect, FONT, C } from '../panel.js';

// Where you stand: just behind the line, facing the board.
export const DARTS_VIEW = { x: 0, z: OCHE_Z + 0.3, th: 0, lift: 0 };
// Aim help in VR: how far a throw is pulled towards where the dart was pointing
// as you aimed (k), for throws that land within `reach` of it. Wild throws stay wild.
const ASSIST = { off: { k: 0, reach: 0 }, light: { k: 0.4, reach: 0.15 }, full: { k: 0.75, reach: 0.3 } };
// On a screen the aim wobbles; aim help calms it.
const SWAY = { off: 1.35, light: 1, full: 0.65 };
const YOU_FLIGHT = 0x2fb8ff, P2_FLIGHT = 0xff7a1a;
// The robot waits behind you on your left, and steps up to throw beside you.
const WAIT_SPOT = { x: -1.3, z: OCHE_Z + 0.9 }, THROW_SPOT = { x: -0.85, z: OCHE_Z + 0.15 };
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
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `900 84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SPORTS HALL DARTS', w / 2, 66);
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
      const mid = Math.PI / 2 - segmentAngle(n);
      const [r0, r1] = label === String(n) && S.mode === 'atc' ? [BR.outer, BR.doubleOut]
        : mult === 3 ? [BR.trebleIn, BR.trebleOut] : mult === 2 ? [BR.doubleIn, BR.doubleOut] : [BR.trebleOut, BR.doubleIn];
      glow.geometry = new THREE.RingGeometry(r0, r1, 8, 1, mid - Math.PI / 20, Math.PI / 10);
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
    mode: null,          // x01 | atc | count | free
    game: null, players: [], opts: {},
    phase: 'idle',       // idle | aim | flying | robot | between | done
    t: 0, timers: [],
    visit: [],           // this visit's darts (hits)
    darts: [],           // darts in the air, in the board or on the floor
    hold: null,          // VR: your throw while the trigger's held
    press: null,         // screen: when you pressed
    aim: { x: 0, y: 0.103 }, aimSet: false,
    rob: null,           // the robot's visit in progress
    robPos: { x: WAIT_SPOT.x, z: WAIT_SPOT.z }, hand: new THREE.Vector3(),
    cam: null, log: [], last: [],
  };
  const later = (sec, fn) => S.timers.push({ t: S.t + sec, fn });
  const turnIndex = () => (S.mode === 'x01' ? S.game.turn : 0);
  const player = () => S.players[turnIndex()];
  const robotP = () => S.players.find(p => p.kind === 'robot') ?? null;
  const humanTurn = () => player()?.kind === 'you';

  // opts: { mode, start, doubleOut, legs, rival (a robot, or null), local (two people take turns) }
  function start(opts) {
    stopAll();
    S.opts = opts;
    S.mode = opts.mode;
    S.t = 0; S.log = S.log ?? [];
    if (S.mode === 'x01') {
      S.players = opts.rival
        ? [{ name: 'You', kind: 'you', flight: YOU_FLIGHT }, { name: opts.rival.name, kind: 'robot', rival: opts.rival, flight: opts.rival.look.accent }]
        : [{ name: 'Player 1', kind: 'you', flight: YOU_FLIGHT }, { name: 'Player 2', kind: 'you', flight: P2_FLIGHT }];
      const first = Math.random() < 0.5 ? 0 : 1;
      S.game = new X01({ start: opts.start, doubleOut: opts.doubleOut, legs: opts.legs, players: 2, firstThrower: first });
    } else {
      S.players = [{ name: 'You', kind: 'you', flight: YOU_FLIGHT }];
      S.game = S.mode === 'atc' ? new AroundClock() : S.mode === 'count' ? new CountUp(8) : null;
    }
    root.visible = true;
    const rp = robotP();
    ctx.robot.root.visible = !!rp;
    if (rp) {
      ctx.robot.showPaddle(false);
      ctx.robot.setLook(rp.rival.look);
      recolour(robotHandDart, rp.flight);
      S.robPos = { x: WAIT_SPOT.x, z: WAIT_SPOT.z };
    }
    S.phase = 'between';
    S.cam = null;
    drawCard();
    if (S.mode === 'x01') {
      const g = S.game, first = S.players[g.turn];
      const how = `${g.start} · ${g.bestOf === 1 ? 'one leg' : `best of ${g.bestOf} legs`} · ${g.doubleOut ? 'double out' : 'any finish'}`;
      showBanner(rp ? `You v ${rp.name}` : 'Player 1 v Player 2', `${how} · ${first.name === 'You' ? 'you throw' : `${first.name} throws`} first`, rp ? hexStr(rp.flight) : C.accent, 3.2);
      if (rp) later(1.0, () => talk('start', true));
    } else {
      const t = { atc: ['Around the Clock', 'Hit 1, then 2, then 3... up to 20, then the bull'], count: ['Count-up', 'Eight visits of three darts: score all you can'], free: ['Free throw', 'Throw as many as you like'] }[S.mode];
      showBanner(t[0], t[1], C.accent2, 3);
    }
    later(2.6, beginVisit);
  }

  function beginVisit() {
    S.visit = [];
    clearDarts();
    const p = player();
    if (p.kind === 'robot') { S.phase = 'robot'; S.rob = { dart: 0, step: 'walk', t: 0, next: S.t + 1.1 }; }
    else {
      S.phase = 'aim';
      recolour(handRig, p.flight); recolour(screenDart, p.flight);
      // Two people sharing: say whose go it is.
      if (S.mode === 'x01' && !robotP()) showBanner(`${p.name} to throw`, `${S.game.remaining} to go`, hexStr(p.flight), 1.6);
    }
    drawCard();
  }

  // ------------------------------------------------------- throwing a dart --
  function launch(p0, v0) {
    const who = turnIndex();
    const out = flightOutcome(p0, v0);
    const mesh = makeDart(S.players[who].flight);
    pointDart(mesh, p0, v0);
    root.add(mesh);
    S.darts.push({ mesh, p0: { ...p0 }, v0: { ...v0 }, t: 0, out, who, state: 'fly' });
    sfx.play('swish', p0, Math.hypot(v0.x, v0.y, v0.z) / 7);
    if (S.phase === 'aim') S.phase = 'flying';
    return out;
  }

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
    if (S.mode === 'x01') { result = S.game.throwDart(hit); visitOver = result.done; }
    else if (S.mode === 'atc') {
      const r = S.game.throwDart(hit);
      if (r.ok) { sfx.play('target', null, 1); if (r.done) { drawCard(); return finishPractice(); } }
      visitOver = S.visit.length === 3;
    } else if (S.mode === 'count') { result = S.game.throwDart(hit); visitOver = result.visitDone; }
    else visitOver = S.visit.length === 3;
    drawCard();
    if (visitOver) return endVisit(result);
    if (p.kind === 'robot') S.rob.next = S.t + 0.75;
    else S.phase = 'aim';
  }

  function endVisit(r) {
    S.phase = 'between';
    const who = turnIndex(), p = S.players[who];
    const darts = S.visit.map(h => h.label).join(' · ');
    if (S.mode === 'x01') {
      const g = S.game, total = r.total, rp = robotP();
      const robot = p.kind === 'robot';
      if (!robot && rp) {
        stats.darts.high = Math.max(stats.darts.high ?? 0, total);
        if (total === 180) stats.darts.n180 = (stats.darts.n180 ?? 0) + 1;
        if (r.checkout) stats.darts.bestOut = Math.max(stats.darts.bestOut ?? 0, total);
        save('sh_stats', stats);
      }
      ctx.call(r.checkout ? (r.matchOver ? 'Game shot, and the match!' : 'Game shot, and the leg!') : callFor(total, r.bust));
      const col = hexStr(p.flight);
      if (r.checkout) {
        const legs = g.legsWon.join('–');
        if (!r.matchOver) showBanner('Game shot!', `${p.name === 'You' ? 'You take' : `${p.name} takes`} the leg with ${total} · legs ${legs}`, col, 3);
        sfx.play('cheer', null, 0.8); ctx.cheer(1.2);
        if (rp) { talk(robot ? 'legWin' : 'pLegWin', true); ctx.robot.celebrate(robot ? 'spin' : 'droop'); }
        later(3.4, () => { if (S.game.over) return finishMatch(); S.game.next(); showBanner(`Leg ${S.game.legNo + 1}`, `${S.players[S.game.turn].name === 'You' ? 'You throw' : `${S.players[S.game.turn].name} throws`} first`, C.accent2, 2); later(2.2, beginVisit); });
        return;
      }
      if (r.bust) showBanner('Bust!', `${darts} · ${p.name === 'You' ? 'back to' : `${p.name} stays on`} ${g.scores[who]}`, C.bad, 2);
      else if (total === 180) {
        showBanner('ONE HUNDRED AND EIGHTY!', p.name === 'You' ? 'Three in the treble twenty!' : `${p.name}: maximum!`, '#d4af37', 3.2);
        sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 });
      } else {
        const what = total ? String(total) : 'No score';
        showBanner(p.name === 'You' ? what : `${p.name}: ${what}`, `${darts} · ${g.scores[who]} left`, total >= 100 ? '#d4af37' : col, 1.9);
        if (total >= 100) { sfx.play('cheer', null, 0.5); ctx.cheer(0.8); }
      }
      if (rp) {
        const mood = robot ? (r.bust ? 'bust' : total === 180 ? 'max' : total >= 100 ? 'big' : total < 20 ? 'low' : null)
          : (r.bust ? 'pBust' : total === 180 ? 'pMax' : total >= 100 ? 'pBig' : total < 20 ? 'pLow' : null);
        if (mood) later(1.3, () => talk(mood, mood === 'max' || mood === 'pMax'));
        if (robot) ctx.robot.celebrate(r.bust || total < 20 ? 'droop' : total === 180 ? 'dance' : total >= 100 ? 'pump' : null);
        else if (total >= 100) ctx.robot.celebrate('droop');
      }
      later(r.bust ? 2.4 : total === 180 ? 3.6 : 2.2, () => { S.game.next(); beginVisit(); });
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

  function finishMatch() {
    const g = S.game, rp = robotP(), win = S.players[g.winner];
    S.phase = 'done';
    const legs = `${g.legsWon[0]}–${g.legsWon[1]}`;
    const avg = `average ${g.average(0).toFixed(1)}`;
    if (rp) {
      const you = win.kind === 'you';
      stats.darts[you ? 'wins' : 'losses'] = (stats.darts[you ? 'wins' : 'losses'] ?? 0) + 1;
      if (you && !stats.darts.beaten.includes(rp.rival.id)) stats.darts.beaten.push(rp.rival.id);
      save('sh_stats', stats);
      showBanner(you ? 'You win!' : `${rp.name} wins`, `Legs ${legs} · your ${avg}`, you ? C.good : C.bad, 5);
      later(1.0, () => talk(you ? 'pWin' : 'win', true));
      ctx.robot.celebrate(you ? 'slump' : 'dance');
      if (you) { sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer(2); ctx.confetti({ x: 0, y: 1.9, z: BOARD.z + 0.6 }); } else sfx.play('groan');
      ctx.lastResult?.(`${you ? 'You beat' : 'You lost to'} ${rp.name} at darts: legs ${legs}`, you);
    } else {
      showBanner(`${win.name} wins!`, `Legs ${legs}`, hexStr(win.flight), 5);
      sfx.play('fanfare'); ctx.cheer(2);
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

  // The robot's comment on a moment.
  let lastTalk = -9;
  function talk(moment, force = false) {
    const rp = robotP();
    if (!rp) return;
    if (!force && (Math.random() > (DART_TALK_CHANCE[moment] ?? 0.5) || S.t - lastTalk < 3)) return;
    const line = dartLine(rp.rival, moment);
    if (!line) return;
    lastTalk = S.t;
    ctx.say(rp.rival, line);
  }

  // ------------------------------------------------------------ the robot --
  // A stand-in for the table tennis Bot, so the robot model can be posed:
  // pad = where its hand goes (plus 0.13 up), relative to the robot's root.
  const rbot = { side: 1, pad: { x: 0.8, y: 1.2, z: 0 }, swing: 0, mood: 0 };
  const _h = new THREE.Vector3(), _t = new THREE.Vector3();
  function robotUpdate(dt) {
    const rp = robotP();
    if (!rp || !ctx.robot.root.visible) return;
    const up = S.phase === 'robot' || (S.phase === 'between' && player().kind === 'robot') || (S.phase === 'done' && player().kind === 'robot');
    const spot = up ? THROW_SPOT : WAIT_SPOT;
    const k = Math.min(1, dt * 2.6);
    S.robPos.x += (spot.x - S.robPos.x) * k; S.robPos.z += (spot.z - S.robPos.z) * k;
    const bx = S.robPos.x, bz = S.robPos.z;
    // Hand poses (world), relative to where the robot stands.
    const rest = { y: 1.02, z: bz - 0.14 }, aim = { y: 1.64, z: bz - 0.06 }, cock = { y: 1.68, z: bz + 0.07 }, rel = { y: 1.7, z: bz - 0.26 }, follow = { y: 1.52, z: bz - 0.44 };
    let want = rest, snap = false;
    const R = S.rob;
    let target = null;
    if (R && S.phase === 'robot') {
      R.t += dt;
      if (R.step === 'walk' && S.t >= R.next) { R.step = 'aim'; R.t = 0; R.label = robotTarget(S.game.remaining, S.game.dartsLeft, S.game.doubleOut); R.finishing = S.game.hint()?.length === 1; }
      if (R.step === 'aim') { want = aim; if (R.t > 0.55) { R.step = 'cock'; R.t = 0; } }
      else if (R.step === 'cock') { want = cock; if (R.t > 0.2) { R.step = 'throw'; R.t = 0; } }
      else if (R.step === 'throw') {
        const f = Math.min(1, R.t / 0.09);
        want = { y: cock.y + (rel.y - cock.y) * f, z: cock.z + (rel.z - cock.z) * f }; snap = true;
        if (f >= 1) robotRelease(R);
      } else if (R.step === 'follow') { want = follow; if (S.t >= R.next) { R.step = 'aim'; R.t = 0; R.label = robotTarget(S.game.remaining, S.game.dartsLeft, S.game.doubleOut); R.finishing = S.game.hint()?.length === 1; } }
      if (R.label) { const a = aimPoint(R.label); target = _t.set(BOARD.x + a.x, BOARD.y + a.y, FACE_Z); }
    }
    const hx = bx + 0.2;
    if (snap) S.hand.set(hx, want.y, want.z);
    else S.hand.lerp(_h.set(hx, want.y, want.z), Math.min(1, dt * 12));
    ctx.robot.root.position.set(bx - 0.6, 0, bz - 2.22);
    rbot.pad.x = 0.8;
    rbot.pad.y = S.hand.y + 0.13;
    rbot.pad.z = S.hand.z - (bz - 2.22);
    rbot.mood *= Math.pow(0.5, dt);
    const flying = S.darts.find(d => d.state === 'fly');
    const look = flying ? flying.mesh.position : target ?? _t.set(BOARD.x, BOARD.y, FACE_Z);
    ctx.robot.update(rbot, look, dt);
    // The dart in its hand, pointing at the board.
    const holding = R && S.phase === 'robot' && ['aim', 'cock', 'throw'].includes(R.step);
    robotHandDart.visible = holding;
    if (holding) {
      ctx.robot.handPos(_h);
      _h.z -= 0.06; _h.y += 0.02;
      pointDart(robotHandDart, _h, { x: (target?.x ?? 0) - _h.x, y: (target?.y ?? BOARD.y) - _h.y + 0.25, z: FACE_Z - _h.z });
    }
  }
  function robotRelease(R) {
    const p0 = robotHandDart.position.clone();
    const hitAt = robotDart(robotP().rival.id, R.label, Math.random, R.finishing);
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
    launch(p0, solveLaunch(p0, tgt, Math.hypot(tgt.x - p0.x, tgt.z - p0.z) / 6.2));
  }

  // ------------------------------------------------------------- the views --
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  const camWant = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  function screenCamera(dt, paused) {
    const aspect = window.innerWidth / window.innerHeight;
    // Like the telly: the robot's face as it aims, then the board as the dart lands.
    const robotAiming = !paused && robotP() && S.phase === 'robot' && S.rob && S.rob.step !== 'follow';
    if (paused) {
      camWant.pos.set(DARTS_VIEW.x, 1.42, DARTS_VIEW.z + 0.05);
      camWant.look.set(DARTS_VIEW.x, 1.32, DARTS_VIEW.z - 1.12);
      camWant.fov = aspect < 1 ? Math.min(100, 62 * Math.pow(1 / aspect, 0.65)) : 62;
    } else if (robotAiming) {
      camWant.pos.set(0.45, 1.72, BOARD.z + 1.0);
      camWant.look.set(S.robPos.x + 0.1, 1.45, S.robPos.z);
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
      bm.scale.setScalar(1);
      bm.position.set(0, 2.45, BOARD.z + 0.12);
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
    if (!root.visible) return;
    wall.visible = !mr;
    if (!xr) screenCamera(dt, paused);
    placeBoards(xr);
    card.mesh.visible = xr || !paused;      // on a screen, out of the menu's way
    if (paused) { handRig.visible = false; screenDart.visible = false; crosshair.visible = false; aimDot.visible = false; S.hold = null; S.press = null; return; }
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
    // The glow: the next number round the clock, or your checkout's first dart.
    if (S.mode === 'atc' && !S.game.done) setGlow(S.game.targetLabel);
    else if (S.mode === 'x01' && humanTurn() && S.phase === 'aim' && settings.dartsHints !== false) setGlow(S.game.hint()?.[0] ?? null, false);
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
    popLeft = 0;
  }

  return {
    handRig,
    get active() { return root.visible; },
    get phase() { return S.phase; },
    get state() { return S; },
    get log() { return S.log; },
    start,
    stop() { stopAll(); root.visible = false; S.phase = 'idle'; S.mode = null; },
    update, pointerDown, pointerMove, pointerUp,
    snapCamera() { S.cam = null; screenCamera(-1, false); },
    inProgress: () => root.visible && S.phase !== 'done' && S.phase !== 'idle',
    redraw: drawCard,
    // For tests: throw your next dart at a board point (board coordinates).
    testThrow(x, y) { if (S.phase !== 'aim' || !humanTurn()) return false; throwAt({ x, y }); return true; },
    // For tests: a VR-style throw from p0 with velocity v (world), with an optional sight point.
    testThrowVR(p0, v, sight = null) { if (S.phase !== 'aim' || !humanTurn()) return false; throwVR(p0, { ...v, speed: Math.hypot(v.x, v.y, v.z) }, sight); return true; },
  };
}
