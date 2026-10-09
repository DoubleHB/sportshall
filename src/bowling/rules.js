// Ten-pin scoring: frames, strikes, spares and the tenth frame's bonus balls.
// Pure, tested in Node. A frame is the list of pins knocked down by each ball.

// Is this frame finished? (The last frame gets a third ball after a strike or spare.)
export function frameDone(fr, last) {
  if (!last) return fr[0] === 10 || fr.length === 2;
  if (fr.length < 2) return false;
  return fr.length === 3 || fr[0] + fr[1] < 10;
}
// How many pins stand for this frame's next ball.
export function standingFor(fr, last) {
  if (!fr.length) return 10;
  if (!last) return 10 - fr[0];
  if (fr.length === 1) return fr[0] === 10 ? 10 : 10 - fr[0];
  if (fr[0] === 10) return fr[1] === 10 ? 10 : 10 - fr[1];
  return 10;                                     // after a spare
}

// Running totals, frame by frame (null until a frame's bonus balls are known).
export function runningTotals(frames, count = 10) {
  const rolls = frames.flat(), out = [];
  let ri = 0, total = 0, open = false;
  for (let f = 0; f < count; f++) {
    const fr = frames[f];
    if (open || !fr || !frameDone(fr, f === count - 1)) { open = true; out.push(null); continue; }
    let v;
    if (f === count - 1) v = fr.reduce((a, b) => a + b, 0);
    else if (fr[0] === 10) v = rolls[ri + 2] == null ? null : 10 + rolls[ri + 1] + rolls[ri + 2];
    else if (fr[0] + fr[1] === 10) v = rolls[ri + 2] == null ? null : 10 + rolls[ri + 2];
    else v = fr[0] + fr[1];
    if (v == null) { open = true; out.push(null); continue; }
    total += v; out.push(total);
    ri += fr.length;
  }
  return out;
}
// The marks for a frame's boxes: 'X' strike, '/' spare, '-' none, or a number.
export function marks(fr, last) {
  const n = p => (p === 0 ? '-' : String(p));
  const [a, b, c] = fr, out = [];
  if (a == null) return out;
  out.push(a === 10 ? 'X' : n(a));
  if (b == null) return out;
  // The second ball: a fresh rack only after a strike in the tenth.
  if (last && a === 10) out.push(b === 10 ? 'X' : n(b));
  else out.push(a + b === 10 ? '/' : n(b));
  if (c == null) return out;
  // The third (tenth frame only): fresh after two strikes or a spare.
  if (a === 10 && b !== 10) out.push(b + c === 10 ? '/' : n(c));
  else out.push(c === 10 ? 'X' : n(c));
  return out;
}

// A game for one or more players, taking it in turns a frame at a time.
export class Bowling {
  constructor({ players = 1, frames = 10 } = {}) {
    this.n = players;
    this.count = frames;
    this.frames = Array.from({ length: players }, () => []);
    this.turn = 0;            // whose go it is
    this.frame = 0;           // the frame being bowled (the same for everyone)
    this.over = false;
  }
  get current() { return this.frames[this.turn][this.frame] ?? []; }
  get last() { return this.frame === this.count - 1; }
  get standing() { return standingFor(this.current, this.last); }
  get ball() { return this.current.length; }
  // Pins knocked down by a ball (no more than were standing). Returns what it was:
  // { pins, strike, spare, rack (the next ball has all ten), frameDone, over }.
  roll(pins) {
    if (this.over) return null;
    const stood = this.standing;
    pins = Math.max(0, Math.min(stood, Math.round(pins)));
    const fr = (this.frames[this.turn][this.frame] ??= []);
    fr.push(pins);
    const strike = stood === 10 && pins === 10;
    const spare = stood < 10 && pins === stood;
    const done = frameDone(fr, this.last);
    if (done) {
      if (this.turn + 1 < this.n) this.turn++;
      else { this.turn = 0; this.frame++; if (this.frame >= this.count) this.over = true; }
    }
    return { pins, strike, spare, frameDone: done, over: this.over, rack: done || this.standing === 10 };
  }
  totals(p) { return runningTotals(this.frames[p], this.count); }
  score(p) { const t = this.totals(p).filter(v => v != null); return t.length ? t[t.length - 1] : 0; }
  // Who won (null while it's going on, or for a tie).
  winner() {
    if (!this.over) return null;
    const s = this.frames.map((_, p) => this.score(p)), best = Math.max(...s);
    const w = s.map((v, p) => p).filter(p => s[p] === best);
    return w.length === 1 ? w[0] : null;
  }
}
