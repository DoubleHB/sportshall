// Headless tests for the physics, rules, robot and assist.
// Run: tests\run-tests.ps1   (or: node --test tests)
import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLE, BALL_R, STEP, makeBall, step, predict, solveShot, aimShot, collidePaddle, vec, len, fly } from '../src/physics.js';
import { Referee, Match, P, O } from '../src/rules.js';
import { Bot, Machine, serveFrom, LEVELS } from '../src/ai.js';
import { assistShot } from '../src/assist.js';
import { simulateRally, rng32, simStats } from './sim.mjs';
import { newCup, nextMatch, record, quickMatch, youAreOut, YOU, ROUND_GAMES } from '../src/cup.js';
import { encodeFeel, decodeFeel } from '../src/share.js';

const T = TABLE;

test('dropped ball bounces to about 80% of its height', () => {
  const b = makeBall({ x: 0, y: T.top + BALL_R + 0.3, z: 0.6 });
  const ev = [];
  let peakAfter = 0, bounced = false;
  for (let i = 0; i < 1500; i++) {
    step(b, STEP, ev);
    if (ev.length) bounced = true;
    if (bounced) peakAfter = Math.max(peakAfter, b.p.y - T.top - BALL_R);
  }
  assert.ok(bounced);
  assert.equal(ev[0].type, 'table');
  assert.ok(peakAfter > 0.2 && peakAfter < 0.26, `bounce height ${peakAfter}`);
});

test('topspin dips shorter, backspin floats longer', () => {
  const p = { x: 0, y: 1.0, z: 1.6 }, v = { x: 0, y: 1.5, z: -7 };
  const land = w => predict(makeBall(p, v, w), { stopAt: ['table', 'floor', 'net'] }).events[0].p.z;
  const flat = land(vec()), top = land({ x: -200, y: 0, z: 0 }), back = land({ x: 200, y: 0, z: 0 });
  assert.ok(top > flat + 0.1, `top ${top} flat ${flat}`);
  assert.ok(back < flat - 0.1, `back ${back} flat ${flat}`);
});

test('a low ball hits the net and stays on the near side', () => {
  const r = predict(makeBall({ x: 0, y: T.top + 0.08, z: 0.3 }, { x: 0, y: 0, z: -6 }), { stopAt: ['floor'] });
  assert.equal(r.events[0].type, 'net');
  const lastTable = r.events.filter(e => e.type === 'table').pop();
  assert.ok(!lastTable || lastTable.side === 1);
});

test('solveShot lands within a centimetre', () => {
  const p = { x: 0.3, y: 1.0, z: 1.7 }, target = { x: -0.4, y: T.top + BALL_R, z: -1.0 };
  const w = { x: -120, y: 10, z: 0 };
  const v = solveShot(p, target, 0.5, w);
  const b = makeBall(p, v, w);
  for (let t = 0; t < 0.5 - 1e-9; t += 1 / 400) fly(b, 1 / 400);
  assert.ok(len({ x: b.p.x - target.x, y: b.p.y - target.y, z: b.p.z - target.z }) < 0.01);
});

test('aimShot clears the net at all paces', () => {
  for (const speed of [3, 6, 9, 12]) {
    for (const tz of [-0.4, -1.2]) {
      const s = aimShot({ x: 0, y: T.top + 0.15, z: 1.6 }, 0.3, tz, speed, { x: -80, y: 0, z: 0 });
      assert.ok(s.ok, `speed ${speed} tz ${tz}: ${s.first?.type}`);
    }
  }
});

function paddle(c, n, vel = vec(), ang = vec()) {
  return { c, n, prevC: c, prevN: n, vel, ang };
}

test('a still paddle bounces the ball back', () => {
  const b = makeBall({ x: 0, y: 1, z: 1.55 }, { x: 0, y: 0, z: 5 });
  const prev = { ...b.p };
  b.p.z += 0.03;
  const hit = collidePaddle(b, prev, paddle({ x: 0, y: 1, z: 1.6 }, { x: 0, y: 0, z: 1 }));
  assert.ok(hit);
  assert.ok(b.v.z < -3.8 && b.v.z > -4.5, `vz ${b.v.z}`);
});

test('a swinging paddle adds pace, an upward brush adds topspin', () => {
  const b = makeBall({ x: 0, y: 1, z: 1.58 }, { x: 0, y: 0, z: 4 });
  const prev = { ...b.p };
  const pad = paddle({ x: 0, y: 1, z: 1.6 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 4, z: -6 });
  pad.prevC = { x: 0, y: 0.99, z: 1.61 };
  assert.ok(collidePaddle(b, prev, pad));
  assert.ok(b.v.z < -9, `vz ${b.v.z}`);
  assert.ok(b.w.x < -50, `topspin wx ${b.w.x}`);   // topspin for a ball going -z
});

test('a fast paddle that passes right through the ball in one step still hits', () => {
  const b = makeBall({ x: 0, y: 1, z: 1.5 }, { x: 0, y: 0, z: 3 });
  const prev = { ...b.p };
  const pad = { c: { x: 0, y: 1, z: 1.4 }, n: { x: 0, y: 0, z: 1 }, prevC: { x: 0, y: 1, z: 1.65 }, prevN: { x: 0, y: 0, z: 1 }, vel: { x: 0, y: 0, z: -12 }, ang: vec() };
  assert.ok(collidePaddle(b, prev, pad));
  assert.ok(b.v.z < -10);
});

test('referee: a normal rally and the reasons', () => {
  const r = new Referee(P, { casualServe: false });
  assert.equal(r.event({ type: 'hit', who: P, t: 0 }), null);
  assert.equal(r.event({ type: 'table', side: 1 }), null);
  assert.equal(r.event({ type: 'table', side: -1 }), null);
  assert.equal(r.due, O);
  assert.equal(r.event({ type: 'hit', who: O, t: 1 }), null);
  assert.equal(r.event({ type: 'table', side: 1 }), null);
  const end = r.event({ type: 'floor' });
  assert.equal(end.winner, O);
  assert.equal(end.reason, 'Missed it');
});

test('referee: proper serve must bounce on your side first; casual need not', () => {
  const r = new Referee(P, { casualServe: false });
  r.event({ type: 'hit', who: P, t: 0 });
  assert.equal(r.event({ type: 'table', side: -1 }).winner, O);
  const c = new Referee(P, { casualServe: true });
  c.event({ type: 'hit', who: P, t: 0 });
  assert.equal(c.event({ type: 'table', side: -1 }), null);
  assert.equal(c.due, O);
});

test('referee: net on serve is a let, volley over the table loses, long ball loses', () => {
  const r = new Referee(P, { casualServe: false });
  r.event({ type: 'hit', who: P, t: 0 });
  r.event({ type: 'table', side: 1 });
  r.event({ type: 'net' });
  assert.ok(r.event({ type: 'table', side: -1 }).let);

  const v = new Referee(O);
  v.event({ type: 'hit', who: O, t: 0 }); v.event({ type: 'table', side: 1 });
  v.event({ type: 'hit', who: P, t: 1 });
  assert.equal(v.event({ type: 'hit', who: O, t: 1.3, p: { x: 0, y: 1, z: -0.8 } }).winner, P);

  const l = new Referee(O);
  l.event({ type: 'hit', who: O, t: 0 }); l.event({ type: 'table', side: 1 });
  l.event({ type: 'hit', who: P, t: 1 });
  assert.equal(l.event({ type: 'hit', who: O, t: 1.4, p: { x: 0, y: 1, z: -1.9 } }).winner, O);
});

test('referee: toss that lands before the hit is retossed, double hit loses', () => {
  const r = new Referee(P);
  assert.ok(r.event({ type: 'table', side: 1 }).retoss);
  r.event({ type: 'hit', who: P, t: 0 });
  assert.equal(r.event({ type: 'hit', who: P, t: 0.05 }), null);
  assert.equal(r.event({ type: 'hit', who: P, t: 0.4 }).winner, O);
});

test('match: serve every two points, every point at deuce, win by two', () => {
  const m = new Match({ firstServer: P });
  const servers = [];
  for (let i = 0; i < 4; i++) { servers.push(m.server); m.point(i % 2 ? P : O); }
  assert.deepEqual(servers, [P, P, O, O]);
  m.score = { P: 10, O: 10 };
  const s1 = m.server; m.point(P);
  const s2 = m.server; m.point(O);
  assert.notEqual(s1, s2);
  assert.equal(m.point(P).game, null);   // 12-11
  assert.equal(m.point(P).game, P);      // 13-11
  assert.equal(m.over, P);
});

test('match: best of three swaps the first server each game', () => {
  const m = new Match({ games: 3, firstServer: O });
  for (let i = 0; i < 11; i++) m.point(P);
  assert.equal(m.gamesWon.P, 1);
  assert.equal(m.over, null);
  assert.equal(m.server, P);
  for (let i = 0; i < 11; i++) m.point(P);
  assert.equal(m.over, P);
});

test('robot serves are legal', () => {
  const rng = rng32(7);
  let ok = 0;
  for (let i = 0; i < 40; i++) {
    const p = { x: rng() - 0.5, y: T.top + 0.18, z: -(T.halfL + 0.12) };
    const { v, w } = serveFrom(p, -1, rng, LEVELS.medium);
    const r = predict(makeBall(p, v, w), { stopAt: ['floor', 'edge'] });
    const t = r.events.filter(e => e.type === 'table');
    if (!r.events.some(e => e.type === 'net') && t[0]?.side === -1 && t[1]?.side === 1) ok++;
  }
  assert.ok(ok >= 38, `${ok}/40 legal`);
});

test('ball machine feeds land on your side', () => {
  for (const pace of ['slow', 'medium', 'fast']) {
    const m = new Machine({ pace, spin: 'mix', rng: rng32(3) });
    for (let i = 0; i < 10; i++) {
      const { ball } = m.feed();
      const first = predict(ball, { stopAt: ['table', 'net', 'floor'] }).events[0];
      assert.equal(first?.type, 'table', pace);
      assert.equal(first.side, 1);
    }
  }
});

test('assist pulls a long shot onto the table, and leaves good shots alone', () => {
  const long = makeBall({ x: 0.2, y: T.top + 0.3, z: 1.6 }, { x: -0.5, y: 1.5, z: -11 });
  assert.notEqual(predict(long, { stopAt: ['table', 'floor'] }).events[0].side, -1);
  const v = assistShot(long, 1);
  const after = predict(makeBall(long.p, v, long.w), { stopAt: ['table', 'net', 'floor'] }).events[0];
  assert.equal(after.type, 'table');
  assert.equal(after.side, -1);
  const good = makeBall({ x: 0, y: T.top + 0.25, z: 1.6 }, { x: 0, y: 1.6, z: -6 });
  assert.equal(assistShot(good, 1), null);
  assert.equal(assistShot(long, 0), null);
});

test('light assist rescues a near miss but not a wild swing', () => {
  const lands = (b, v) => {
    const e = predict(makeBall(b.p, v, b.w), { stopAt: ['table', 'net', 'floor'] }).events[0];
    return e?.type === 'table' && e.side === -1;
  };
  const near = makeBall({ x: 0.1, y: T.top + 0.2, z: 1.6 }, { x: 0, y: 0.6, z: -6 });   // clips the net
  assert.ok(!lands(near, near.v));
  const v1 = assistShot(near, 0.55);
  assert.ok(v1 && lands(near, v1));
  const wild = makeBall({ x: 0.1, y: T.top + 0.3, z: 1.6 }, { x: 5, y: 10, z: -2 });     // a skyer off to the side
  assert.equal(assistShot(wild, 0.55), null);
  assert.ok(lands(wild, assistShot(wild, 1)));
});

test('assist works for the far end too (mirrored)', () => {
  const long = makeBall({ x: -0.2, y: T.top + 0.3, z: -1.6 }, { x: 0.5, y: 1.5, z: 11 }, { x: 0, y: 0, z: 0 });
  const v = assistShot(long, 1, -1);
  const after = predict(makeBall(long.p, v, long.w), { stopAt: ['table', 'net', 'floor'] }).events[0];
  assert.equal(after.type, 'table');
  assert.equal(after.side, 1);
});

test('characters tweak the robot', () => {
  const b = new Bot('medium');
  b.setLevel('medium', { chop: 0.6, spin: [150, 300] });
  assert.equal(b.L.chop, 0.6);
  assert.deepEqual(b.L.spin, [150, 300]);
  assert.equal(b.L.react, LEVELS.medium.react);
});

test('cup: draw puts you and Omega in opposite halves, results flow to the final', () => {
  for (let s = 1; s < 30; s++) {
    const cup = newCup(rng32(s));
    const slots = cup.rounds[0].flatMap(m => [m.a, m.b]);
    assert.equal(new Set(slots).size, 8);
    const half = id => (slots.indexOf(id) < 4 ? 0 : 1);
    assert.notEqual(half(YOU), half('omega'));
  }
  const cup = newCup(rng32(5));
  let n, played = 0;
  while ((n = nextMatch(cup))) {
    const winner = n.m.a === YOU || n.m.b === YOU ? YOU : quickMatch(n.m.a, n.m.b, ROUND_GAMES[n.r], rng32(played)).winner;
    record(cup, n.r, n.i, winner, [{ a: 11, b: 5 }]);
    played++;
  }
  assert.equal(played, 7);
  assert.equal(cup.champion, YOU);
  assert.equal(youAreOut(cup), false);
});

test('cup: quick results favour the stronger robot and follow the scoring rules', () => {
  const rng = rng32(9);
  let omegaWins = 0;
  for (let i = 0; i < 200; i++) {
    const r = quickMatch('omega', 'rookie', 1, rng);
    const g = r.score[0];
    assert.ok(Math.max(g.a, g.b) >= 11 && Math.abs(g.a - g.b) >= 2);
    if (r.winner === 'omega') omegaWins++;
  }
  assert.ok(omegaWins > 190, `${omegaWins}`);
  const bo3 = quickMatch('spinny', 'chopper', 3, rng);
  assert.ok(bo3.score.length >= 2 && bo3.score.length <= 3);
});

test('share: paddle feel survives a link, and junk is refused', () => {
  const feel = { size: 0.086, bounce: 0.88, grip: 0.65, power: 1.1, smooth: 0.3 };
  const code = encodeFeel(feel, -15);
  assert.match(code, /^[-\d_]+$/);
  const back = decodeFeel(code);
  assert.deepEqual(back, { feel, angle: -15 });
  assert.equal(decodeFeel('<script>'), null);
  assert.equal(decodeFeel('1_2_3'), null);
  assert.equal(decodeFeel('999_999_999_999_99_400').feel.bounce, 0.96);   // clamped
});

test('robot v robot rallies (balance)', () => {
  for (const level of Object.keys(LEVELS)) {
    const rng = rng32(11);
    let shots = 0, points = 0;
    const reasons = {};
    for (let i = 0; i < 30; i++) {
      const r = simulateRally(level, level, i % 2 ? P : O, rng);
      shots += r.shots; points++;
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    }
    const avg = shots / points;
    console.log(`  ${level}: ${avg.toFixed(1)} shots a rally`, JSON.stringify(reasons), `fallback serves ${simStats.fallbacks}`);
    assert.ok(avg >= 3, `${level} rallies too short: ${avg}`);
  }
});
