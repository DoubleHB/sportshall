// Darts games: 301/501 (x01) in legs, Around the Clock and Count-up, plus the
// checkout finder that both the scoreboard hints and the robots use.
import { NUMBERS, labelOf } from './board.js';

// Every bed you can aim at, the big trebles first (the order breaks ties).
export const THROWS = (() => {
  const by = [...NUMBERS].sort((a, b) => b - a);
  const t = n => ({ n, mult: 3, score: 3 * n, label: labelOf(n, 3) });
  const s = n => ({ n, mult: 1, score: n, label: labelOf(n, 1) });
  const d = n => ({ n, mult: 2, score: 2 * n, label: labelOf(n, 2) });
  return [...by.map(t), ...by.map(s), s(25), d(25), ...by.map(d)];
})();

// The darts that can end a leg, by score: [any finish, double out].
const FINISHERS = [THROWS, THROWS.filter(t => t.mult === 2)].map(list => {
  const m = new Map();
  for (const t of list) { if (!m.has(t.score)) m.set(t.score, []); m.get(t.score).push(t); }
  return m;
});

// Favourite doubles to finish on (0 = best). The bull counts as a double.
const DOUBLE_COST = { 20: 0, 16: 0, 8: 1, 18: 1, 12: 1, 10: 1, 4: 2, 2: 2, 6: 2, 14: 2, 25: 2.5, 1: 4 };
const finishCost = (t, doubleOut) => (doubleOut
  ? DOUBLE_COST[t.n] ?? 3
  : t.mult === 1 ? (t.n === 25 ? 1.5 : 0) : t.n === 25 ? 2.5 : t.mult === 2 ? 1 : 1.5);
// How awkward a dart is to set up a finish with.
const setupCost = t => (t.mult === 3 ? (t.n === 20 ? 0 : t.n === 19 ? 0.5 : 2) : t.n === 25 ? (t.mult === 2 ? 2.5 : 1.5) : t.mult === 2 ? 2.5 : 0.3);

// The fewest darts that finish exactly on `rem` (ending on a double when
// doubleOut), as labels, e.g. 170 -> ['T20', 'T20', 'Bull']; null if you can't.
const routeCache = new Map();
export function checkoutRoute(rem, darts = 3, doubleOut = true) {
  if (!(rem >= 1) || rem > 180 || darts < 1) return null;
  const key = `${rem}:${darts}:${doubleOut ? 1 : 0}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const finish = FINISHERS[doubleOut ? 1 : 0];
  let best = null;
  const offer = (route, cost) => { if (!best || cost < best.cost) best = { route, cost }; };
  const ends = need => finish.get(need) ?? [];
  for (const f of ends(rem)) offer([f.label], finishCost(f, doubleOut));
  if (!best && darts >= 2) {
    for (const a of THROWS) for (const f of ends(rem - a.score)) offer([a.label, f.label], setupCost(a) + finishCost(f, doubleOut));
  }
  if (!best && darts >= 3) {
    for (const a of THROWS) {
      if (a.score >= rem) continue;
      for (const b of THROWS) for (const f of ends(rem - a.score - b.score)) offer([a.label, b.label, f.label], setupCost(a) + setupCost(b) + finishCost(f, doubleOut));
    }
  }
  const route = best?.route ?? null;
  routeCache.set(key, route);
  return route;
}

// What's left worth leaving: lower is better.
function leaveCost(left, doubleOut) {
  if (checkoutRoute(left, 1, doubleOut)) {
    const t = THROWS.find(x => x.label === checkoutRoute(left, 1, doubleOut)[0]);
    return finishCost(t, doubleOut);
  }
  if (checkoutRoute(left, 2, doubleOut)) return 4;
  if (checkoutRoute(left, 3, doubleOut)) return 6;
  return 8 + left / 100;
}

// Where a robot (or a hint) aims with `dartsLeft` darts in hand and `rem` to get:
// the first dart of a checkout, else a dart that leaves a good finish, else T20.
export function robotTarget(rem, dartsLeft, doubleOut) {
  const route = checkoutRoute(rem, dartsLeft, doubleOut);
  if (route) return route[0];
  if (rem > 230) return 'T20';
  let best = null;
  for (const t of THROWS) {
    const left = rem - t.score;
    if (left < (doubleOut ? 2 : 1)) continue;
    const c = leaveCost(left, doubleOut) + setupCost(t);
    if (!best || c < best.c) best = { t, c };
  }
  return best?.t.label ?? 'T20';
}

// ------------------------------------------------------------------ x01 --
// 301 or 501: each player counts down to exactly zero, three darts a visit.
// A visit that goes below zero (or to 1, or to 0 without a double, when
// doubleOut) is bust: the score goes back to where the visit started.
export class X01 {
  constructor({ start = 501, doubleOut = false, legs = 1, players = 2, firstThrower = 0 } = {}) {
    this.start = start; this.doubleOut = doubleOut; this.bestOf = legs;
    this.legsToWin = Math.ceil(legs / 2);
    this.n = players;
    this.legsWon = Array(players).fill(0);
    this.stats = Array.from({ length: players }, () => ({ darts: 0, points: 0, high: 0, n180: 0, tons: 0, bestOut: 0 }));
    this.legNo = 0; this.legStarter = firstThrower;
    this.over = false; this.winner = null;
    this.history = [];      // legs: { winner, darts }
    this.newLeg();
  }
  newLeg() {
    this.scores = Array(this.n).fill(this.start);
    this.legDarts = Array(this.n).fill(0);
    this.turn = this.legStarter;
    this.beginVisit();
  }
  beginVisit() { this.visit = { darts: [], from: this.scores[this.turn], bust: false, done: false, checkout: false, total: 0 }; }
  get remaining() { return this.scores[this.turn]; }
  get dartsLeft() { return 3 - this.visit.darts.length; }
  // A dart for whoever's turn it is: hit = { n, mult, score, label }.
  throwDart(hit) {
    const v = this.visit, p = this.turn;
    if (v.done || this.over) return null;
    v.darts.push(hit);
    this.legDarts[p]++;
    const left = this.scores[p] - hit.score;
    const bust = left < 0 || (this.doubleOut && (left === 1 || (left === 0 && hit.mult !== 2)));
    if (bust) { this.scores[p] = v.from; v.bust = true; v.done = true; }
    else {
      this.scores[p] = left;
      if (left === 0) { v.checkout = true; v.done = true; }
      else if (v.darts.length === 3) v.done = true;
    }
    if (v.done) {
      const st = this.stats[p];
      v.total = v.bust ? 0 : v.from - this.scores[p];
      st.darts += v.darts.length; st.points += v.total;
      st.high = Math.max(st.high, v.total);
      if (v.total === 180) st.n180++;
      if (v.total >= 100) st.tons++;
      if (v.checkout) {
        st.bestOut = Math.max(st.bestOut, v.total);
        this.legsWon[p]++;
        this.history.push({ winner: p, darts: this.legDarts[p] });
        if (this.legsWon[p] >= this.legsToWin) { this.over = true; this.winner = p; }
      }
    }
    return { bust: v.bust, checkout: v.checkout, done: v.done, total: v.total, matchOver: this.over };
  }
  // After a finished visit: the next player, or (after a checkout) the next leg.
  // Returns 'turn', 'leg' or 'over'.
  next() {
    if (this.over) return 'over';
    if (this.visit.checkout) {
      this.legNo++;
      this.legStarter = (this.legStarter + 1) % this.n;
      this.newLeg();
      return 'leg';
    }
    this.turn = (this.turn + 1) % this.n;
    this.beginVisit();
    return 'turn';
  }
  // Three-dart average for the match so far.
  average(p) { const s = this.stats[p]; return s.darts ? s.points / s.darts * 3 : 0; }
  // A checkout to show for the player throwing now, or null.
  hint() { return checkoutRoute(this.remaining, this.dartsLeft, this.doubleOut); }
}

// ------------------------------------------------------ Around the Clock --
// Hit 1, 2, 3 ... 20 in order, then the bull (either ring). Fewest darts wins.
export const ATC_ORDER = [...Array(20).keys()].map(i => i + 1).concat(25);
export class AroundClock {
  constructor() { this.i = 0; this.darts = 0; this.done = false; }
  get target() { return ATC_ORDER[this.i]; }
  get targetLabel() { return this.target === 25 ? 'Bull' : String(this.target); }
  throwDart(hit) {
    if (this.done) return null;
    this.darts++;
    const ok = hit.n === this.target;
    if (ok && ++this.i >= ATC_ORDER.length) this.done = true;
    return { ok, done: this.done };
  }
}

// --------------------------------------------------------------- Count-up --
// Eight visits of three darts: score as much as you can.
export class CountUp {
  constructor(rounds = 8) { this.rounds = rounds; this.round = 0; this.total = 0; this.visit = []; this.done = false; this.visits = []; }
  throwDart(hit) {
    if (this.done) return null;
    this.visit.push(hit);
    this.total += hit.score;
    const visitDone = this.visit.length === 3;
    if (visitDone) {
      this.visits.push(this.visit.reduce((a, h) => a + h.score, 0));
      this.round++;
      this.visit = [];
      if (this.round >= this.rounds) this.done = true;
    }
    return { visitDone, done: this.done };
  }
}
