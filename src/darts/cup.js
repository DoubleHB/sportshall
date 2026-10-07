// The darts cup: the same eight-player draw as the table tennis cup (../cup.js:
// you and seven robots, you and Omega in opposite halves), played over legs of
// 301. A robot-v-robot match you skip is played out dart by dart with the
// robots' real throwing, so the favourites usually (not always) go through.
import { X01, robotTarget } from './rules.js';
import { robotDart } from './robots.js';
import { scoreAt } from './board.js';

export const CUP_START = 301;
// Legs per round: quarter-finals and semi-finals one leg, the final best of three.
export const ROUND_LEGS = [1, 1, 3];

// Robot a v robot b. Returns { winner, score: [{ a, b }] } (legs won).
export function simulateMatch(a, b, { legs = 1, doubleOut = false, start = CUP_START, rng = Math.random } = {}) {
  const ids = [a, b];
  const g = new X01({ start, doubleOut, legs, players: 2, firstThrower: rng() < 0.5 ? 0 : 1 });
  for (let darts = 0; !g.over && darts < 50000; darts++) {
    const id = ids[g.turn];
    const p = robotDart(id, robotTarget(g.remaining, g.dartsLeft, doubleOut), rng, g.hint()?.length === 1);
    g.throwDart(scoreAt(p.x, p.y));
    if (g.visit.done) g.next();
  }
  return { winner: ids[g.winner], score: [{ a: g.legsWon[0], b: g.legsWon[1] }] };
}
