// Table tennis rules: a referee that watches one rally's events and decides the
// point, and a match that keeps the score and says who serves.
// Players are 'P' (you, at the +z end) and 'O' (the opponent, at the -z end).

import { TABLE } from './physics.js';

export const P = 'P', O = 'O';
export const sideOf = who => (who === P ? 1 : -1);
export const other = who => (who === P ? O : P);

// One rally. Feed it events with `event(e)`; it returns null while play goes on,
// or { winner, loser, reason } when the point is over, or { let: true, reason }
// when the serve must be taken again. `info` holds the last notable thing that
// happened (good serve, return landed) for the HUD and the practice mode.
export class Referee {
  constructor(server, { casualServe = true } = {}) {
    this.server = server;
    this.casualServe = casualServe;
    this.stage = 'toss';           // toss -> serveOwn/serveOpp -> toOpp/await
    this.hitter = null;            // who hit last
    this.hits = 0;
    this.netOnServe = false;
    this.lastHitT = -1;
    this.info = null;
    this.done = null;
  }

  // Ball went somewhere the rally can't continue from (floor, side of the table,
  // flew off): whose fault depends on the stage.
  _dead(reason) {
    if (this.stage === 'await') return this._lose(other(this.hitter), reason.await);
    return this._lose(this.hitter, reason.hit);
  }

  _lose(loser, reason) {
    this.done = { winner: other(loser), loser, reason };
    return this.done;
  }

  // e: { type: 'hit', who, t } | { type: 'table', side, p } | { type: 'net' }
  //    | { type: 'floor' } | { type: 'edge' } | { type: 'out' } | { type: 'stall' }
  event(e) {
    if (this.done) return null;
    this.info = null;

    if (this.stage === 'toss') {
      if (e.type === 'hit') {
        if (e.who !== this.server) return this._lose(e.who, 'You can\'t hit it before the serve');
        this.hitter = e.who; this.hits = 1; this.lastHitT = e.t ?? 0;
        this.stage = this.casualServe ? 'serveAny' : 'serveOwn';
        return null;
      }
      if (e.type === 'table' || e.type === 'floor' || e.type === 'edge' || e.type === 'out' || e.type === 'stall') {
        return { retoss: true, reason: 'Toss it up and hit it' };
      }
      return null;
    }

    const H = this.hitter, sH = sideOf(H);

    if (e.type === 'hit') {
      if (e.who === H) {
        // A second touch straight after the hit is the same stroke; later is a double hit.
        if ((e.t ?? 0) - this.lastHitT < 0.15) return null;
        return this._lose(H, 'Double hit');
      }
      if (this.stage !== 'await') {
        // Hit before it bounced on your side. Over the table that's your fault,
        // once it's past your end line it was going out anyway.
        const overEnd = e.p && Math.abs(e.p.z) > TABLE.halfL;
        return overEnd ? this._lose(H, 'Long, it missed the table') : this._lose(e.who, 'You must let it bounce first');
      }
      this.hitter = e.who; this.hits++; this.lastHitT = e.t ?? 0;
      this.stage = 'toOpp';
      return null;
    }

    if (e.type === 'net') {
      if (this.stage === 'serveOpp' || this.stage === 'serveAny' || this.stage === 'serveOwn') this.netOnServe = true;
      return null;
    }

    if (e.type === 'table') {
      const own = e.side === sH;
      switch (this.stage) {
        case 'serveOwn':
          if (!own) return this._lose(H, 'The serve must bounce on your side first');
          this.stage = 'serveOpp';
          return null;
        case 'serveAny':
          if (own) { this.stage = 'serveOpp'; return null; }
          return this._serveLanded(e);
        case 'serveOpp':
          if (own) return this._lose(H, 'The serve didn\'t clear the net');
          return this._serveLanded(e);
        case 'toOpp':
          if (own) return this._lose(H, 'It bounced on your own side');
          this.stage = 'await';
          this.info = { type: 'landed', hitter: H, p: e.p };
          return null;
        case 'await':
          // Any second bounce means the receiver didn't get it back.
          return this._lose(other(H), own ? 'Missed it' : 'It bounced twice');
      }
    }

    if (e.type === 'floor' || e.type === 'out' || e.type === 'stall') {
      return this._dead({ hit: this.hits === 1 && this.stage !== 'await' ? 'The serve missed the table' : 'It missed the table', await: 'Missed it' });
    }
    if (e.type === 'edge') {
      return this._dead({ hit: 'It hit the side of the table', await: 'Missed it' });
    }
    return null;
  }

  _serveLanded(e) {
    if (this.netOnServe) { this.done = { let: true, reason: 'Let: it touched the net, serve again' }; return this.done; }
    this.stage = 'await';
    this.info = { type: 'landed', hitter: this.hitter, serve: true, p: e?.p };
    return null;
  }

  // Who should hit next, or null if nobody is due (ball on its way to the table).
  get due() {
    if (this.done) return null;
    if (this.stage === 'toss') return this.server;
    if (this.stage === 'await') return other(this.hitter);
    return null;
  }
}

// A match: first to `points` (win by 2), best of `games`. Serve changes every
// two points, and every point from 10-10.
export class Match {
  constructor({ points = 11, games = 1, firstServer = P } = {}) {
    this.points = points;
    this.games = games;
    this.firstServer = firstServer;
    this.score = { P: 0, O: 0 };
    this.gamesWon = { P: 0, O: 0 };
    this.gameNo = 0;
    this.over = null;
    this.history = [];
  }

  get gameFirstServer() { return this.gameNo % 2 === 0 ? this.firstServer : other(this.firstServer); }

  get server() {
    const { P: a, O: b } = this.score;
    const n = a + b;
    const deuce = this.points - 1;
    // From deuce (10-10) the serve swaps every point instead of every two.
    const turns = a >= deuce && b >= deuce ? n - deuce : Math.floor(n / 2);
    return turns % 2 === 0 ? this.gameFirstServer : other(this.gameFirstServer);
  }

  get needed() { return Math.floor(this.games / 2) + 1; }

  // Records a point. Returns { game: winner|null, match: winner|null }.
  point(winner) {
    if (this.over) return { game: null, match: this.over };
    this.score[winner]++;
    const s = this.score, l = other(winner);
    let game = null, match = null;
    if (s[winner] >= this.points && s[winner] - s[l] >= 2) {
      game = winner;
      this.gamesWon[winner]++;
      this.history.push({ ...s });
      if (this.gamesWon[winner] >= this.needed) { match = winner; this.over = winner; }
      else { this.gameNo++; this.score = { P: 0, O: 0 }; }
    }
    return { game, match };
  }

  get gamePoint() {
    const s = this.score;
    for (const w of [P, O]) if (s[w] >= this.points - 1 && s[w] - s[other(w)] >= 1) return w;
    return null;
  }
}
