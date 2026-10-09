// Headless tests for bowling: scoring, the ball and pins, the robots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Bowling, runningTotals, marks, frameDone, standingFor } from '../src/bowling/rules.js';
import { PIN_SPOTS, LANE } from '../src/bowling/lane.js';
import { simulate, rack } from '../src/bowling/physics.js';
import { aimFor, robotShot, planShot } from '../src/bowling/robots.js';
import { rng32 } from './sim.mjs';

const play = (rolls, players = 1, frames = 10) => { const g = new Bowling({ players, frames }); rolls.forEach(p => g.roll(p)); return g; };

test('bowling scores: perfect game, all spares, gutter game, a mixed game', () => {
  assert.equal(play(new Array(12).fill(10)).score(0), 300);
  assert.equal(play(new Array(21).fill(5)).score(0), 150);
  const gutter = play(new Array(20).fill(0));
  assert.equal(gutter.score(0), 0);
  assert.ok(gutter.over);
  // X, 7/, 9-, X, X, X, 6 3, 8/, X, X X 8 (worked out by hand: 210)
  const g = play([10, 7, 3, 9, 0, 10, 10, 10, 6, 3, 8, 2, 10, 10, 10, 8]);
  assert.deepEqual(g.totals(0), [20, 39, 48, 78, 104, 123, 132, 152, 182, 210]);
  assert.ok(g.over);
});

test('bowling: frames, standing pins and marks, the tenth frame', () => {
  assert.ok(frameDone([10], false) && frameDone([3, 4], false) && !frameDone([3], false));
  assert.ok(!frameDone([10, 10], true) && frameDone([3, 4], true) && !frameDone([3, 7], true) && frameDone([3, 7, 10], true));
  assert.equal(standingFor([3], false), 7);
  assert.equal(standingFor([10], true), 10);
  assert.equal(standingFor([10, 4], true), 6);
  assert.equal(standingFor([3, 7], true), 10);
  assert.deepEqual(marks([10], false), ['X']);
  assert.deepEqual(marks([7, 3], false), ['7', '/']);
  assert.deepEqual(marks([0, 4], false), ['-', '4']);
  assert.deepEqual(marks([10, 10, 10], true), ['X', 'X', 'X']);
  assert.deepEqual(marks([10, 6, 4], true), ['X', '6', '/']);
  assert.deepEqual(marks([9, 1, 10], true), ['9', '/', 'X']);
  // Bonus balls not bowled yet: no total.
  assert.deepEqual(runningTotals([[10], [10]], 10).slice(0, 2), [null, null]);
  assert.deepEqual(runningTotals([[10], [10], [3, 4]], 10).slice(0, 3), [23, 40, 47]);
});

test('bowling: two players take a frame each in turn, and a roll reports strikes and spares', () => {
  const g = new Bowling({ players: 2, frames: 3 });
  assert.equal(g.turn, 0);
  let r = g.roll(10);
  assert.ok(r.strike && r.frameDone && r.rack);
  assert.equal(g.turn, 1);
  r = g.roll(6); assert.ok(!r.frameDone && !r.rack); assert.equal(g.standing, 4);
  r = g.roll(4); assert.ok(r.spare && r.frameDone);
  assert.equal(g.turn, 0); assert.equal(g.frame, 1);
  // Can't knock down more than are standing.
  g.roll(8); r = g.roll(5); assert.equal(r.pins, 2);
  assert.equal(PIN_SPOTS.length, 10);
  assert.ok(LANE.len > 9 && LANE.len < 10);
});

test('bowling physics: a hooked pocket ball usually strikes; head-on leaves splits; the gutter gets nothing', () => {
  const rng = rng32(4), g = () => (rng() + rng() + rng() - 1.5) * 1.41;
  const pocket = aimFor(LANE.x + 0.065, LANE.x + 0.25, 7.5, 0.8), nose = aimFor(LANE.x, LANE.x, 7.5, 0);
  let strikes = 0, noseStrikes = 0;
  for (let k = 0; k < 60; k++) {
    const wob = s => ({ ...s, x: s.x + g() * 0.012, vx: s.vx + g() * 0.01 });
    if (simulate(null, wob(pocket)).down.length === 10) strikes++;
    if (simulate(null, wob(nose)).down.length === 10) noseStrikes++;
  }
  assert.ok(strikes > 30, `pocket strikes ${strikes}/60`);
  assert.ok(noseStrikes < 8, `head-on strikes ${noseStrikes}/60`);
  // Straight into the gutter: no pins, and with bumpers it bounces back on.
  const wide = { x: LANE.x + 0.4, vx: 0.35, vz: -7, spin: 0 };
  assert.equal(simulate(null, wide).down.length, 0);
  assert.ok(simulate(null, wide, { bumpers: true }).ball.state !== 'gutter');
  assert.equal(rack([0, 6]).length, 2);
});

test('robot bowlers: Omega outscores Rookie, and goes for the spare it has', () => {
  const rng = rng32(6);
  const game = id => {
    const g = new Bowling({ frames: 5 });
    let stand = null;
    while (!g.over) {
      const before = stand ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const r = simulate(stand, robotShot(id, stand, rng));
      const res = g.roll(r.down.filter(i => before.includes(i)).length);
      stand = res.rack ? null : before.filter(i => !r.down.includes(i));
    }
    return g.score(0);
  };
  const omega = game('omega') + game('omega'), rookie = game('rookie') + game('rookie');
  assert.ok(omega > rookie, `omega ${omega} rookie ${rookie}`);
  // A lone 10 pin: Omega's plan takes it.
  assert.deepEqual(simulate([9], planShot('omega', [9], rng)).down, [9]);
});
