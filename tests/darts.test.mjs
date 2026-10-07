// Headless tests for darts: board scoring, the games' rules, checkouts, dart
// flight and the robots' aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { R, NUMBERS, BOARD, FACE_Z, OCHE_Z, scoreAt, aimPoint, parseLabel, wireDist, segmentAt } from '../src/darts/board.js';
import { X01, AroundClock, CountUp, checkoutRoute, robotTarget, THROWS } from '../src/darts/rules.js';
import { flightOutcome, solveLaunch, posAt, releaseVelocity } from '../src/darts/flight.js';
import { robotDart, DART_SKILL, DART_AVG, callFor, words } from '../src/darts/robots.js';
import { rng32 } from './sim.mjs';

const h = label => { const { n, mult } = parseLabel(label); return { n, mult, score: n * mult, label }; };
const scoreOf = label => h(label).score;

test('the board scores where it should', () => {
  assert.equal(scoreAt(0, 0).label, 'Bull');
  assert.equal(scoreAt(0, 0.01).label, '25');
  assert.equal(scoreAt(0, 0.103).label, 'T20');
  assert.equal(scoreAt(0, 0.166).label, 'D20');
  assert.equal(scoreAt(0, 0.13).label, '20');
  assert.equal(scoreAt(0.13, 0).label, '6');      // right
  assert.equal(scoreAt(-0.13, 0).label, '11');    // left
  assert.equal(scoreAt(0, -0.13).label, '3');     // bottom
  assert.equal(scoreAt(0, 0.18).score, 0);        // outside the doubles
  assert.equal(segmentAt(0.13 * Math.sin(Math.PI / 10), 0.13 * Math.cos(Math.PI / 10)), 1);
});

test('every bed\'s aim point scores that bed, well clear of the wires', () => {
  for (const t of THROWS) {
    const p = aimPoint(t.label);
    assert.equal(scoreAt(p.x, p.y).label, t.label, t.label);
    if (t.n !== 25) assert.ok(wireDist(p.x, p.y) > 0.003, `${t.label} ${wireDist(p.x, p.y)}`);
  }
  assert.ok(wireDist(0, R.trebleIn) < 1e-9);
  assert.ok(wireDist(0.1 * Math.sin(Math.PI / 20), 0.1 * Math.cos(Math.PI / 20)) < 1e-6);   // on a spoke
});

test('x01: busts, double out, legs and the winner', () => {
  const g = new X01({ start: 101, doubleOut: true, legs: 3, players: 2 });
  assert.equal(g.turn, 0);
  g.throwDart(h('T20')); g.throwDart(h('T20'));            // 101 -> 41 -> bust (would be -19)
  assert.equal(g.visit.bust, true);
  assert.equal(g.scores[0], 101);
  assert.equal(g.next(), 'turn');
  g.throwDart(h('T20')); g.throwDart(h('1')); g.throwDart(h('20'));   // 101 -> 20
  assert.equal(g.scores[1], 20);
  g.next();
  g.throwDart(h('T20')); g.throwDart(h('S1'));             // 101 -> 41 -> 40
  const r = g.throwDart(h('20'));                         // 40 -> 20, visit over
  assert.ok(r.done && !r.bust);
  g.next();
  assert.equal(g.throwDart(h('20')).bust, true);          // 20 -> 0 on a single: bust with double out
  assert.equal(g.scores[1], 20);
  g.next();
  assert.equal(g.throwDart(h('19')).bust, true);          // leaving 1 can't be finished
  g.next(); g.next();
  g.throwDart(h('18'));
  assert.equal(g.throwDart(h('2')).bust, true);           // 2 -> 0 on a single
  assert.equal(g.scores[0], 20);
  // Fresh check of a clean finish.
  const f = new X01({ start: 40, doubleOut: true, legs: 3, players: 2 });
  const fin = f.throwDart(h('D20'));
  assert.ok(fin.checkout && fin.done && !fin.matchOver);
  assert.equal(f.legsWon[0], 1);
  assert.equal(f.next(), 'leg');
  assert.equal(f.turn, 1);                                // the other player starts leg 2
  f.throwDart(h('D20'));
  f.next();
  assert.equal(f.turn, 0);
  const last = f.throwDart(h('D20'));
  assert.ok(last.matchOver);
  assert.equal(f.winner, 0);
  assert.equal(f.next(), 'over');
});

test('x01: any finish, and the average', () => {
  const g = new X01({ start: 60, doubleOut: false, legs: 1, players: 1 });
  g.throwDart(h('20')); g.throwDart(h('20'));
  const r = g.throwDart(h('20'));
  assert.ok(r.checkout && r.matchOver);
  assert.equal(g.average(0), 60);
  const b = new X01({ start: 30, doubleOut: false, legs: 1, players: 1 });
  assert.equal(b.throwDart(h('T20')).bust, true);
  assert.equal(b.scores[0], 30);
  const one = new X01({ start: 21, doubleOut: false, legs: 1, players: 1 });
  assert.equal(one.throwDart(h('20')).bust, false);       // leaving 1 is fine without double out
});

test('checkouts: the classics, and every route adds up', () => {
  assert.deepEqual(checkoutRoute(170, 3, true), ['T20', 'T20', 'Bull']);
  assert.deepEqual(checkoutRoute(40, 1, true), ['D20']);
  assert.deepEqual(checkoutRoute(100, 2, true), ['T20', 'D20']);
  assert.deepEqual(checkoutRoute(50, 1, true), ['Bull']);
  assert.equal(checkoutRoute(41, 1, true), null);
  assert.equal(checkoutRoute(1, 3, true), null);
  for (const bogey of [159, 162, 163, 165, 166, 168, 169]) assert.equal(checkoutRoute(bogey, 3, true), null, bogey);
  for (let rem = 2; rem <= 170; rem++) {
    const r = checkoutRoute(rem, 3, true);
    if (!r) { assert.ok([159, 162, 163, 165, 166, 168, 169].includes(rem), `no route for ${rem}`); continue; }
    assert.equal(r.reduce((a, l) => a + scoreOf(l), 0), rem, `${rem}: ${r}`);
    assert.equal(parseLabel(r[r.length - 1]).mult, 2, `${rem} ends on a double`);
  }
  for (let rem = 1; rem <= 180; rem++) {
    const r = checkoutRoute(rem, 3, false);
    // Scores three darts can never make.
    if ([163, 166, 169, 172, 173, 175, 176, 178, 179].includes(rem)) { assert.equal(r, null); continue; }
    assert.ok(r, `any finish ${rem}`);
    assert.equal(r.reduce((a, l) => a + scoreOf(l), 0), rem);
  }
  assert.deepEqual(checkoutRoute(19, 1, false), ['19']);
});

test('robots aim sensibly', () => {
  assert.equal(robotTarget(501, 3, true), 'T20');
  assert.equal(robotTarget(32, 3, true), 'D16');
  assert.equal(robotTarget(170, 3, true), 'T20');
  // With no finish on, it leaves itself a double rather than busting.
  const t = robotTarget(61, 1, true);
  const left = 61 - scoreOf(t);
  assert.ok(left >= 2 && checkoutRoute(left, 1, true), `${t} leaves ${left}`);
  assert.equal(robotTarget(7, 3, false), '7');
});

test('a solved throw lands where it was aimed', () => {
  const from = { x: 0.15, y: 1.6, z: OCHE_Z + 0.1 };
  for (const label of ['T20', 'D16', 'Bull', '11', 'T19']) {
    const a = aimPoint(label);
    const v = solveLaunch(from, { x: BOARD.x + a.x, y: BOARD.y + a.y, z: FACE_Z }, 0.42);
    const o = flightOutcome(from, v, () => 0.99);
    assert.equal(o.kind, 'board');
    assert.equal(o.hit.label, label);
    assert.ok(Math.abs(o.bx - a.x) < 1e-6 && Math.abs(o.by - a.y) < 1e-6);
  }
  // A lob into the floor, a dart over the top into the wall, and one thrown backwards.
  assert.equal(flightOutcome(from, { x: 0, y: -1, z: -2 }).kind, 'floor');
  assert.equal(flightOutcome(from, solveLaunch(from, { x: 1.2, y: 2.4, z: FACE_Z }, 0.4)).kind, 'wall');
  assert.equal(flightOutcome(from, { x: 0, y: 2, z: 3 }).kind, 'floor');
});

test('release speed: the peak of the throw, even letting go late', () => {
  const s = [];
  // Hand speeds up to 6 m/s forward, then slows over the last 60 ms.
  let z = 0, t = 0;
  for (let i = 0; i < 40; i++) {
    t = i / 90;
    const sp = i < 30 ? i / 30 * 6 : 6 - (i - 30) * 0.5;
    z -= sp / 90;
    s.push({ t, x: 0, y: 1.6 + i * 0.002, z });
  }
  const v = releaseVelocity(s);
  assert.ok(v.z < -5.3 && v.z > -6.3, `vz ${v.z}`);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.equal(releaseVelocity(s.slice(0, 2)), null);
});

test('around the clock and count-up', () => {
  const a = new AroundClock();
  assert.equal(a.target, 1);
  assert.equal(a.throwDart(h('D1')).ok, true);
  assert.equal(a.throwDart(h('3')).ok, false);
  for (let n = 2; n <= 20; n++) a.throwDart(h(`T${n}`));
  assert.equal(a.targetLabel, 'Bull');
  assert.equal(a.throwDart(h('25')).done, true);
  assert.equal(a.darts, 22);
  const c = new CountUp(2);
  for (let i = 0; i < 6; i++) c.throwDart(h('T20'));
  assert.ok(c.done);
  assert.equal(c.total, 360);
});

test('the caller', () => {
  assert.equal(words(180), 'one hundred and eighty');
  assert.equal(words(45), 'forty-five');
  assert.equal(callFor(180), 'One hundred and eighty!');
  assert.equal(callFor(26), 'Twenty-six');
  assert.equal(callFor(60, true), 'No score');
});

// Each robot aiming at T20 for 3000 darts: averages climb the ladder and match the menu.
test('robot averages climb the ladder', () => {
  const avg = {};
  for (const id of Object.keys(DART_SKILL)) {
    const rng = rng32(7);
    let pts = 0;
    for (let i = 0; i < 3000; i++) { const p = robotDart(id, 'T20', rng); pts += scoreAt(p.x, p.y).score; }
    avg[id] = pts / 3000 * 3;
  }
  console.log('three-dart averages:', Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, Math.round(v)])));
  const order = ['rookie', 'bolt', 'spinny', 'chopper', 'vortex', 'omega'];
  for (let i = 1; i < order.length; i++) assert.ok(avg[order[i]] > avg[order[i - 1]], `${order[i]} beats ${order[i - 1]}`);
  for (const id of order) assert.ok(Math.abs(avg[id] - DART_AVG[id]) < 8, `${id}: ${avg[id]} v menu ${DART_AVG[id]}`);
});

// Whole legs of 301: how many darts each robot takes, with and without double out.
test('robots finish legs of 301 in a sensible number of darts', () => {
  const rng = rng32(11);
  const limit = { rookie: 110, bolt: 90, chopper: 60, omega: 22 };
  for (const doubleOut of [true, false]) {
    for (const id of Object.keys(limit)) {
      let total = 0;
      for (let leg = 0; leg < 60; leg++) {
        const g = new X01({ start: 301, doubleOut, legs: 1, players: 1 });
        let darts = 0;
        while (!g.over && darts < 1500) {
          const target = robotTarget(g.remaining, g.dartsLeft, doubleOut);
          const p = robotDart(id, target, rng, g.hint()?.length === 1);
          g.throwDart(scoreAt(p.x, p.y));
          darts++;
          if (g.visit.done) g.next();
        }
        assert.ok(g.over, `${id} finished`);
        total += darts;
      }
      console.log(`${id}: ${Math.round(total / 60)} darts a 301 leg (${doubleOut ? 'double out' : 'any finish'})`);
      assert.ok(total / 60 < limit[id], id);
    }
  }
});
