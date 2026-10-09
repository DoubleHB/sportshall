// The bowling cup: the same eight-player draw as the other cups. Quarter-finals
// and semi-finals are a 5-frame game, the final a full 10 frames; most pins
// goes through, and a tie goes to a roll-off (one ball each at a full rack,
// again if it's level). Robot-v-robot games are played out from each robot's
// usual bowling (bowling every ball with the real physics and the robots'
// line-finding would take several seconds on a headset). Pure, tested in Node.
import { Bowling } from './rules.js';

export const BOWL_CUP_FRAMES = [5, 5, 10];

// How each robot's first ball goes (the chance of knocking down 0..10 pins)
// and how often it picks up what's left, from `dev/bowling-balance.mjs`-style
// runs of the real thing (25 games each).
export const BOWL_FORM = {
  rookie: { first: [0.041, 0.004, 0, 0.079, 0.049, 0.116, 0.142, 0.225, 0.154, 0.157, 0.034], spare: 0.26 },
  bolt: { first: [0, 0, 0, 0, 0.008, 0.027, 0.087, 0.182, 0.235, 0.322, 0.14], spare: 0.52 },
  spinny: { first: [0, 0, 0, 0, 0.019, 0.072, 0.11, 0.163, 0.163, 0.261, 0.212], spare: 0.41 },
  chopper: { first: [0, 0, 0, 0, 0, 0.004, 0.048, 0.191, 0.099, 0.272, 0.386], spare: 0.58 },
  zippy: { first: [0, 0, 0, 0, 0, 0, 0.037, 0.152, 0.119, 0.316, 0.375], spare: 0.61 },
  vortex: { first: [0, 0, 0, 0, 0, 0.029, 0.021, 0.05, 0.121, 0.332, 0.446], spare: 0.69 },
  omega: { first: [0, 0, 0, 0, 0, 0, 0.011, 0.025, 0.112, 0.266, 0.586], spare: 0.66 },
};
const form = id => BOWL_FORM[id] ?? BOWL_FORM.rookie;
// Their averages over a 10-frame game (the same runs), for the menu.
export const BOWL_AVG = { rookie: 100, bolt: 145, spinny: 145, chopper: 175, zippy: 180, vortex: 195, omega: 215 };

// One ball at a full rack: how many go down.
export function quickFirst(id, rng = Math.random) {
  const p = form(id).first, total = p.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let n = 0; n < p.length; n++) { x -= p[n]; if (x < 0) return n; }
  return 10;
}
// A second ball at `left` standing pins.
export function quickSpare(id, left, rng = Math.random) {
  if (rng() < form(id).spare) return left;
  return Math.max(0, left - 1 - Math.floor(rng() * rng() * left));
}

// A whole game for one robot: its frames (pins per ball) and its score.
export function quickGame(id, frames = 10, rng = Math.random) {
  const g = new Bowling({ players: 1, frames });
  while (!g.over) {
    const stood = g.standing;
    g.roll(stood === 10 ? quickFirst(id, rng) : quickSpare(id, stood, rng));
  }
  return { frames: g.frames[0], score: g.score(0) };
}

// A cup game between two robots: { winner, score: [{a, b}] plus the roll-off
// as a second { a, b } if there was one }.
export function quickCupGame(a, b, frames = 10, rng = Math.random) {
  const sa = quickGame(a, frames, rng).score, sb = quickGame(b, frames, rng).score;
  const score = [{ a: sa, b: sb }];
  if (sa !== sb) return { winner: sa > sb ? a : b, score };
  const ro = rollOff(() => quickFirst(a, rng), () => quickFirst(b, rng));
  score.push(ro.score);
  return { winner: ro.a > ro.b ? a : b, score };
}

// A roll-off: one ball each until someone knocks down more. Returns the
// last balls, and every ball as { a, b } totals (for the bracket).
export function rollOff(ballA, ballB, max = 20) {
  let ta = 0, tb = 0;
  for (let k = 0; k < max; k++) {
    const x = ballA(), y = ballB();
    ta += x; tb += y;
    if (x !== y) return { a: x, b: y, score: { a: ta, b: tb } };
  }
  return { a: 1, b: 0, score: { a: ta + 1, b: tb } };
}
