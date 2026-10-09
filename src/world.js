// Everything you can see: the hall, the table, paddles, ball, the robot, the
// ball machine and the crowd. All built from primitives and canvas textures, so
// there are no model files to load and it stays light enough for a Quest.
import * as THREE from 'three';
import { TABLE, BALL_R } from './physics.js';

const T = TABLE;

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function radialTexture(inner, outer) {
  return canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, inner); grd.addColorStop(1, outer);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- the table --
function buildTable() {
  const g = new THREE.Group();
  g.name = 'table';
  const topMat = new THREE.MeshStandardMaterial({ color: 0x1d4fa8, roughness: 0.55, metalness: 0.0 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(T.halfW * 2, T.thick, T.halfL * 2), topMat);
  top.position.y = T.top - T.thick / 2;
  g.add(top);

  // White lines: 2 cm edges and the 3 mm centre line, painted on a canvas.
  const lines = canvasTexture(610, 1096, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#f4f6fb';
    const e = Math.round(0.02 / (T.halfW * 2) * w);
    c.fillRect(0, 0, w, e); c.fillRect(0, h - e, w, e);
    c.fillRect(0, 0, e, h); c.fillRect(w - e, 0, e, h);
    c.fillRect(w / 2 - 1.5, 0, 3, h);
  });
  const linePlane = new THREE.Mesh(new THREE.PlaneGeometry(T.halfW * 2, T.halfL * 2),
    new THREE.MeshStandardMaterial({ map: lines, transparent: true, roughness: 0.42, depthWrite: false }));
  linePlane.rotation.x = -Math.PI / 2;
  linePlane.position.y = T.top + 0.0006;
  g.add(linePlane);

  const dark = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.6, metalness: 0.3 });
  const legGeo = new THREE.BoxGeometry(0.05, T.top - T.thick, 0.05);
  for (const x of [-0.62, 0.62]) for (const z of [-1.15, 1.15]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(x, (T.top - T.thick) / 2, z);
    g.add(leg);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.05), dark);
  for (const z of [-1.15, 1.15]) { const r = rail.clone(); r.position.set(0, 0.62, z); g.add(r); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.3), dark);
  beam.position.y = 0.6; g.add(beam);

  // Net and posts.
  const netW = (T.halfW + T.netOver) * 2;
  const netTex = canvasTexture(512, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(20,24,32,0.85)'; c.lineWidth = 1.2;
    for (let x = 0; x <= w; x += 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y <= h; y += 5) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.fillStyle = '#f4f6fb'; c.fillRect(0, 0, w, 7);
  });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(netW, T.netH),
    new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, T.top + T.netH / 2, 0);
  g.add(net);
  const postGeo = new THREE.BoxGeometry(0.02, T.netH + 0.03, 0.04);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, dark);
    post.position.set(s * netW / 2, T.top + T.netH / 2 - 0.01, 0);
    g.add(post);
  }
  return g;
}

// ---------------------------------------------------------------- a paddle --
// Built in WebXR grip space: the handle sits in your fist along Z, the blade
// carries on along -Z, and its faces point along +-X (red forehand on +X).
export function makePaddle({ fore = 0xd8262f, back = 0x15171c } = {}) {
  const group = new THREE.Group();
  const bladeZ = -0.13;
  const wood = new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.7 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 40).rotateZ(Math.PI / 2), wood);
  blade.scale.set(1, 1, 1.05);
  blade.position.z = bladeZ;
  group.add(blade);
  const rubberGeo = new THREE.CylinderGeometry(0.0735, 0.0735, 0.002, 40).rotateZ(Math.PI / 2);
  const red = new THREE.Mesh(rubberGeo, new THREE.MeshStandardMaterial({ color: fore, roughness: 0.55 }));
  red.position.set(0.004, 0, bladeZ); red.scale.set(1, 1, 1.05);
  const black = new THREE.Mesh(rubberGeo, new THREE.MeshStandardMaterial({ color: back, roughness: 0.6 }));
  black.position.set(-0.004, 0, bladeZ); black.scale.set(1, 1, 1.05);
  group.add(red, black);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.032, 0.1), wood);
  handle.position.z = bladeZ + 0.079 + 0.045;
  group.add(handle);
  const flare = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.036, 0.02), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.5 }));
  flare.position.z = handle.position.z + 0.045;
  group.add(flare);
  const centre = new THREE.Object3D();
  centre.position.z = bladeZ;
  group.add(centre);
  return { group, centre, bladeZ };
}

// ---------------------------------------------------------------- the robot --
function buildRobot(envMap) {
  const root = new THREE.Group();
  root.name = 'robot';
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.25, metalness: 0.1, envMapIntensity: 1.2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35, metalness: 0.1 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.08, metalness: 0.6 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x46e6ff });
  const glow = new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.8 });

  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.38, 6, 20), white);
  torso.position.y = 1.02; body.add(torso);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.022, 10, 32), accent);
  stripe.rotation.x = Math.PI / 2; stripe.position.y = 1.0; body.add(stripe);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 32), glow);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; body.add(ring);
  const ring2 = ring.clone(); ring2.scale.setScalar(0.7); ring2.position.y = 0.42; body.add(ring2);

  const head = new THREE.Group();
  head.position.y = 1.52; body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 28, 20), white));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 16, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.42), visorMat);
  visor.scale.set(1.08, 1, 1.08);
  head.add(visor);
  const eyeGeo = new THREE.CapsuleGeometry(0.018, 0.03, 4, 8);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(s * 0.05, 0.01, 0.142);
    head.add(e); eyes.push(e);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1), white);
  antenna.position.y = 0.2; head.add(antenna);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), accent);
  bulb.position.y = 0.26; head.add(bulb);

  // Arm: a stretchy tube from the shoulder to the paddle hand.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 1, 12).translate(0, 0.5, 0), white);
  root.add(arm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), accent);
  root.add(hand);

  // Paddle: faces the player (+z), blade up.
  const pad = makePaddle({ fore: 0x1f7ae0, back: 0x15171c });
  const padOuter = new THREE.Group(), padInner = new THREE.Group();
  padOuter.rotation.y = -Math.PI / 2;
  padInner.rotation.x = Math.PI / 2;
  pad.group.position.z = -pad.bladeZ;
  padInner.add(pad.group); padOuter.add(padInner); root.add(padOuter);

  const shoulder = new THREE.Vector3();
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  let bodyX = 0, blink = 0, t = 0;
  let eyeBase = 0x46e6ff;
  let anim = null;           // { kind, t, dur } celebration in progress

  return {
    root,
    // Colours for a character: { body, accent, eyes }.
    setLook({ body: b = 0xeef1f6, accent: a = 0xff7a1a, eyes: e = 0x46e6ff } = {}) {
      white.color.setHex(b); accent.color.setHex(a); glow.color.setHex(e); eyeBase = e;
    },
    // pump | spin | dance | droop | slump
    celebrate(kind) {
      const dur = { pump: 0.9, spin: 1.1, dance: 3.2, droop: 1.4, slump: 3.5 }[kind] ?? 1;
      anim = { kind, t: 0, dur };
    },
    get busy() { return !!anim; },
    headPos(target) { return head.getWorldPosition(target); },
    handPos(target) { return hand.getWorldPosition(target); },
    // Darts: the robot puts its paddle down.
    showPaddle(on) { padOuter.visible = on; },
    // bot: Bot (pad position, swing, mood), ball: {x,y,z} or null
    update(bot, ballP, dt) {
      t += dt;
      const s = bot.side;
      // Celebration offsets.
      let hop = 0, spin = 0, lean = 0, droop = 0, raise = 0, sway = 0;
      if (anim) {
        anim.t += dt;
        const k = Math.min(1, anim.t / anim.dur), bump = Math.sin(Math.PI * k);
        switch (anim.kind) {
          case 'pump': hop = Math.abs(Math.sin(k * Math.PI * 2)) * 0.12; raise = bump * 0.35; break;
          case 'spin': hop = bump * 0.25; spin = k * Math.PI * 2; raise = bump * 0.3; break;
          case 'dance': hop = Math.abs(Math.sin(anim.t * 9)) * 0.1; sway = Math.sin(anim.t * 6) * 0.25; lean = Math.sin(anim.t * 6) * 0.2; raise = 0.25 + Math.sin(anim.t * 12) * 0.12; if (k > 0.7) spin = (k - 0.7) / 0.3 * Math.PI * 2; break;
          case 'droop': droop = bump * 0.6; lean = Math.sin(anim.t * 14) * bump * 0.08; break;
          case 'slump': droop = Math.min(1, k * 4) * 0.7; hop = -Math.min(1, k * 4) * 0.15; lean = 0.12 * Math.min(1, k * 4); break;
        }
        if (k >= 1) anim = null;
      }
      bodyX += (bot.pad.x * 0.75 - bodyX) * Math.min(1, dt * 6);
      body.position.set(bodyX + sway, Math.sin(t * 2.2) * 0.015 + hop, s * (T.halfL + 0.85));
      body.rotation.set(0, (s < 0 ? 0 : Math.PI) + spin, lean);
      if (ballP && !anim) {
        tmp.set(ballP.x, ballP.y, ballP.z).sub(head.getWorldPosition(new THREE.Vector3()));
        const yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(tmp.x, tmp.z * -s) * 0.6)), pitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)) * 0.5;
        head.rotation.y += (yaw * (s < 0 ? 1 : -1) - head.rotation.y) * Math.min(1, dt * 8);
        head.rotation.x += (-pitch - head.rotation.x) * Math.min(1, dt * 8);
      } else if (anim) {
        head.rotation.y += (0 - head.rotation.y) * Math.min(1, dt * 8);
        head.rotation.x += (droop - head.rotation.x) * Math.min(1, dt * 10);
      }
      // Eyes: blink now and then, squash when happy, droop when sad.
      blink -= dt;
      if (blink < -0.12) blink = 2 + Math.random() * 3;
      const open = blink < 0 ? 0.15 : 1;
      const happy = Math.max(0, bot.mood), sad = Math.max(0, -bot.mood);
      for (const e of eyes) { e.scale.set(1 + happy * 0.3, open * (1 - happy * 0.5) * (1 - sad * 0.3), 1); e.rotation.z = (e.position.x > 0 ? 1 : -1) * sad * 0.5; }
      eyeMat.color.setHex(sad > 0.3 ? 0xff5a5a : happy > 0.3 ? 0x7dff9a : eyeBase);
      ring.rotation.z += dt * (2 + hop * 30); ring2.rotation.z -= dt * (3 + hop * 30);

      // Paddle and arm (the paddle goes up in the air when celebrating).
      const px = anim ? body.position.x + (bot.pad.x > bodyX ? 0.35 : -0.35) : bot.pad.x;
      const py = bot.pad.y + raise + hop;
      padOuter.position.set(px, py, bot.pad.z);
      padOuter.rotation.set(bot.swing * 0.5 * -s, s < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      hand.position.set(px, py - 0.13, bot.pad.z);
      shoulder.set(body.position.x + (bot.pad.x > bodyX ? 0.2 : -0.2), 1.25 + hop, body.position.z);
      tmp.copy(hand.position).sub(shoulder);
      arm.position.copy(shoulder);
      arm.scale.set(1, tmp.length(), 1);
      arm.quaternion.copy(q.setFromUnitVectors(up, tmp.normalize()));
    },
  };
}

// ------------------------------------------------------------ ball machine --
function buildMachine() {
  const g = new THREE.Group();
  g.name = 'machine';
  const shell = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.4, metalness: 0.4 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), shell);
  box.position.set(0, T.top + 0.32, -(T.halfL + 0.42));
  g.add(box);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  hopper.position.set(0, T.top + 0.58, -(T.halfL + 0.42));
  g.add(hopper);
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff9a2e }), 18);
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4, r = 0.03 + (i % 3) * 0.04;
    balls.setMatrixAt(i, new THREE.Matrix4().makeTranslation(Math.cos(a) * r, T.top + 0.5 + Math.floor(i / 6) * 0.035, -(T.halfL + 0.42) + Math.sin(a) * r));
  }
  g.add(balls);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 16).rotateX(Math.PI / 2), orange);
  tube.position.set(0, T.top + 0.32, -(T.halfL + 0.2));
  g.add(tube);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, T.top + 0.17), shell);
  stand.position.set(0, (T.top + 0.17) / 2, -(T.halfL + 0.42));
  g.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 24), shell);
  foot.position.set(0, 0.015, -(T.halfL + 0.42));
  g.add(foot);
  return { root: g, tube, kick: 0 };
}

// ------------------------------------------------------------------ crowd --
function buildCrowd() {
  const spots = [];
  // Two stands along the sides and one behind the robot.
  for (const s of [-1, 1]) for (let row = 0; row < 4; row++) for (let i = 0; i < 18; i++) {
    if (Math.random() < 0.18) continue;
    spots.push({ x: s * (5.6 + row * 0.75), y: 0.45 + row * 0.42, z: -6.2 + i * 0.72 + (row % 2) * 0.3, face: -s * Math.PI / 2 });
  }
  for (let row = 0; row < 4; row++) for (let i = 0; i < 12; i++) {
    if (Math.random() < 0.2) continue;
    spots.push({ x: -4.2 + i * 0.75 + (row % 2) * 0.3, y: 0.45 + row * 0.42, z: -(7.4 + row * 0.75), face: 0 });
  }
  const n = spots.length;
  const shirts = [0xe53946, 0x2a9df4, 0xffc93c, 0x6ad26a, 0xf4f4f4, 0xb057ff, 0xff8c42, 0x1e2a44];
  const skins = [0xf1c6a7, 0xd9a07a, 0xa86f4c, 0x6e4630, 0xffdcc2];
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), new THREE.MeshLambertMaterial(), n);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshLambertMaterial(), n);
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    s.phase = Math.random() * Math.PI * 2;
    s.rate = 0.6 + Math.random() * 0.8;
    bodies.setColorAt(i, col.setHex(shirts[i % shirts.length]));
    heads.setColorAt(i, col.setHex(skins[(i * 7) % skins.length]));
  });
  const g = new THREE.Group();
  g.add(bodies, heads);

  // Stands: stepped dark blocks under the crowd.
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.9 });
  for (const s of [-1, 1]) for (let row = 0; row < 4; row++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42 * (row + 1), 13.5), standMat);
    step.position.set(s * (5.6 + row * 0.75), 0.21 * (row + 1) - 0.15, 0);
    g.add(step);
  }
  for (let row = 0; row < 4; row++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(10, 0.42 * (row + 1), 0.75), standMat);
    step.position.set(0, 0.21 * (row + 1) - 0.15, -(7.4 + row * 0.75));
    g.add(step);
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let excite = 0, t = 0;
  return {
    root: g,
    cheer(amount = 1) { excite = Math.min(2, excite + amount); },
    update(dt) {
      t += dt;
      excite *= Math.pow(0.4, dt);
      spots.forEach((s, i) => {
        const jump = excite > 0.05 ? Math.max(0, Math.sin(t * 9 * s.rate + s.phase)) * 0.18 * Math.min(1, excite) : 0;
        const sway = Math.sin(t * s.rate + s.phase) * 0.02;
        q.setFromAxisAngle(pos.set(0, 1, 0), s.face + sway * 3);
        m.compose(pos.set(s.x, s.y + 0.33 + jump, s.z), q, one);
        bodies.setMatrixAt(i, m);
        m.compose(pos.set(s.x + sway, s.y + 0.72 + jump, s.z), q, one);
        heads.setMatrixAt(i, m);
      });
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------- hall --
function buildHall() {
  const g = new THREE.Group();
  g.name = 'hall';
  const floorTex = canvasTexture(1024, 1024, (c, w, h) => {
    c.fillStyle = '#7a2f2a'; c.fillRect(0, 0, w, h);          // court rubber
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 5;
    c.strokeRect(w * 0.2, h * 0.12, w * 0.6, h * 0.76);       // play area line
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 16), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.95 }));
  // Well below the court, so the two can never fight in the depth buffer.
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.08;
  g.add(outer);

  // Pool of light on the court.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 11), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,244,220,0.32)', 'rgba(255,244,220,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.003;
  g.add(pool);

  // Barriers round the court with the hall's name.
  const boardTex = canvasTexture(1024, 96, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1d5fd1'); grd.addColorStop(1, '#123c8a');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.font = '800 54px system-ui, sans-serif'; c.textBaseline = 'middle';
    for (let x = 30; x < w; x += 520) c.fillText('SPORTS HALL', x, h / 2 + 3);
  });
  boardTex.wrapS = THREE.RepeatWrapping;
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6 });
  const addBoard = (len, x, z, ry) => {
    const t = boardTex.clone(); t.needsUpdate = true; t.repeat.set(len / 4, 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 0.05), boardMat.clone());
    b.material.map = t;
    b.position.set(x, 0.35, z); b.rotation.y = ry;
    g.add(b);
  };
  addBoard(8, 0, -6, 0); addBoard(8, 0, 6, Math.PI);
  addBoard(10, -4.6, 0, Math.PI / 2); addBoard(10, 4.6, 0, -Math.PI / 2);

  // Walls and ceiling lights.
  // The box's bottom face sits 20 cm under the floor: level with it, the two
  // fought and striped the court.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 9.2, 24), new THREE.MeshStandardMaterial({ color: 0x141a28, roughness: 1, side: THREE.BackSide }));
  walls.position.y = 4.4;
  g.add(walls);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (const x of [-3, 0, 3]) for (const z of [-4, 0, 4]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.4), lamp);
    l.position.set(x, 8.9, z); g.add(l);
  }
  // Big hanging banners on the far wall, naming the sport being played.
  const drawSign = (c, w, h, text) => {
    c.fillStyle = '#0d1424'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff7a1a'; c.fillRect(0, h - 18, w, 18);
    c.fillStyle = '#fff'; c.font = '900 120px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 - 8);
  };
  const banner = canvasTexture(1024, 256, (c, w, h) => drawSign(c, w, h, 'TABLE TENNIS'));
  g.userData.setSign = text => {
    const c = banner.image;
    drawSign(c.getContext('2d'), c.width, c.height, text);
    banner.needsUpdate = true;
  };
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: banner }));
  ban.position.set(0, 5.6, -11.9);
  g.add(ban);
  // And one on the near wall, for a friend looking from the far end.
  const ban2 = ban.clone();
  ban2.position.set(0, 5.6, 11.9); ban2.rotation.y = Math.PI;
  g.add(ban2);
  return g;
}

// ------------------------------------------------------- the whole world --
export function buildWorld(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  return import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x302820, 1.3);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1.5, 6, 2);
    scene.add(hemi, sun);

    const hall = buildHall();
    const crowd = buildCrowd();
    hall.add(crowd.root);
    scene.add(hall);

    const table = buildTable();
    scene.add(table);

    const robot = buildRobot(env);
    scene.add(robot.root);
    const machine = buildMachine();
    machine.root.visible = false;
    scene.add(machine.root);

    // The ball, its shadow and a short trail.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xff9a2e, roughness: 0.35, emissive: 0x3a1800 }));
    scene.add(ball);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    const TRAIL = 14;
    const trailPos = new Float32Array(TRAIL * 3), trailCol = new Float32Array(TRAIL * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.frustumCulled = false;
    scene.add(trail);
    const trailPts = [];

    return {
      hall, crowd, table, robot, machine, ball, shadow, trail,
      // A second robot, for robot-v-robot exhibitions.
      makeRobot() { const r = buildRobot(env); scene.add(r.root); return r; },
      // Place the ball, its shadow and its trail. p: {x,y,z} or null to hide.
      setBall(p, speed = 0) {
        ball.visible = shadow.visible = !!p;
        if (!p) { trailPts.length = 0; trail.visible = false; return; }
        ball.position.set(p.x, p.y, p.z);
        const onTable = Math.abs(p.x) <= T.halfW && Math.abs(p.z) <= T.halfL && p.y >= T.top;
        const ground = onTable ? T.top + 0.001 : 0.002;
        const hgt = Math.max(0, p.y - ground);
        shadow.position.set(p.x, ground, p.z);
        shadow.scale.setScalar(0.05 + hgt * 0.06);
        shadow.material.opacity = Math.max(0.12, 0.75 - hgt * 0.9);
        trailPts.unshift({ x: p.x, y: p.y, z: p.z });
        if (trailPts.length > TRAIL) trailPts.length = TRAIL;
        trail.visible = speed > 4;
        for (let i = 0; i < TRAIL; i++) {
          const q = trailPts[Math.min(i, trailPts.length - 1)];
          trailPos.set([q.x, q.y, q.z], i * 3);
          const k = (1 - i / TRAIL) * Math.min(1, (speed - 4) / 8);
          trailCol.set([k, k * 0.6, k * 0.25], i * 3);
        }
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.color.needsUpdate = true;
      },
      // Mixed reality: hide the hall so you see your own room round the table.
      setMixedReality(on) { hall.visible = !on; },
      // The far wall's sign: TABLE TENNIS, MINI GOLF or DARTS.
      setSign(text) { hall.userData.setSign(text); },
    };
  });
}
