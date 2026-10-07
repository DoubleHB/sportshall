// The robots at the oche: how straight each one throws, what they say, and
// the caller's words for each visit.
import { aimPoint } from './board.js';

// Spread of each robot's darts round where it aims (metres, 1 sd across and up).
// Tuned with tests/darts.test.mjs so the three-dart averages climb the ladder.
export const DART_SKILL = {
  rookie: { sx: 0.085, sy: 0.085 },
  bolt: { sx: 0.045, sy: 0.075 },       // throws hard: all over the place up and down
  spinny: { sx: 0.06, sy: 0.04 },       // and side to side
  chopper: { sx: 0.033, sy: 0.033 },
  vortex: { sx: 0.02, sy: 0.02 },
  omega: { sx: 0.0115, sy: 0.0115 },
  zippy: { sx: 0.023, sy: 0.022 },
};
export const skillOf = id => DART_SKILL[id] ?? DART_SKILL.rookie;

function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Where a robot's dart actually goes (board coordinates) when it aims at `label`.
// A dart that could win the leg gets the robot's full concentration: half the
// spread (without it, Rookie can take hundreds of darts to hit a double).
export function robotDart(id, label, rng = Math.random, finishing = false) {
  const s = skillOf(id), a = aimPoint(label), k = finishing ? 0.5 : 1;
  return { x: a.x + gauss(rng) * s.sx * k, y: a.y + gauss(rng) * s.sy * k };
}
// At Killer, only the straighter throwers go for trebles; the rest aim at the big single.
export const goesForTrebles = id => skillOf(id).sx < 0.05;
// Rough three-dart average aiming at T20, for the menu.
export const DART_AVG = { rookie: 26, bolt: 31, spinny: 35, chopper: 39, vortex: 51, omega: 79, zippy: 47 };

// ---------------------------------------------------------------- talk --
// Moments: start; the robot's own visit: big (100+), max (180), low, bust,
// legWin; yours: pBig, pMax, pLow, pBust, pLegWin; the end: win, pWin.
const LINES = {
  nice: {
    start: ['Hello! I\'ve never held a dart before!', 'Pointy end first, is that right?'],
    big: ['A ton! Is that good?', 'Ooh, I hit the little red bit!'],
    max: ['One hundred and eighty?! Did I do that?'],
    low: ['Oops, wrong bit of the board.', 'Whoops!'],
    bust: ['Oh no, I counted wrong!'],
    pBig: ['Great throwing!', 'Wow, well thrown!'],
    pMax: ['One eighty! You\'re amazing!'],
    pLow: ['Unlucky! Next time!', 'Nearly!'],
    pBust: ['Aww, so close!'],
    legWin: ['I got the leg! Yay!'],
    pLegWin: ['Well done! That leg\'s yours!'],
    win: ['I won? Thank you for the game!'],
    pWin: ['You beat me fair and square!', 'Brilliant! Good luck with Bolt!'],
  },
  hyper: {
    start: ['MAXIMUM POWER! THROWING HARD!', 'Darts are just fast arrows! I LOVE fast!'],
    big: ['TON! TON! TON!', 'Did you see the speed on that?'],
    max: ['ONE! HUNDRED! AND! EIGHTY!'],
    low: ['Too much power. Way too much.', 'The board moved! It MOVED!'],
    bust: ['Bust? I wasn\'t counting, I was THROWING!'],
    pBig: ['Whoa! Okay! Okay!', 'Hey! Slow down!'],
    pMax: ['That\'s MY move!'],
    pLow: ['Ha! Missed!', 'Needs more power!'],
    pBust: ['Bust! Bust bust bust!'],
    legWin: ['LEG! Victory lap!'],
    pLegWin: ['Hey! I wasn\'t ready!'],
    win: ['FASTEST DARTS IN THE HALL!'],
    pWin: ['Rematch! REMATCH!', 'Aww. Spinny\'s next. Good luck!'],
  },
  cheeky: {
    start: ['Hope you can count!', 'Watch this. Or don\'t. I\'ll win anyway.'],
    big: ['Treble trouble!', 'Did you blink? You missed it.'],
    max: ['Three in the bed! Who\'s counting? Me.'],
    low: ['Meant to do that.', 'Warming up.'],
    bust: ['Bust. On purpose. Obviously.'],
    pBig: ['Hmph. Fine.', 'Lucky trebles.'],
    pMax: ['Lucky. Very, very lucky.'],
    pLow: ['Bed and breakfast! Ha!', 'The board\'s that way.'],
    pBust: ['Maths isn\'t your thing, is it?'],
    legWin: ['Leg to me. Keep up!'],
    pLegWin: ['You found the double. Annoying.'],
    win: ['Out-thrown! Better luck next time.'],
    pWin: ['You got me. Respect.', 'Chopper\'s next. Bring patience.'],
  },
  dry: {
    start: ['The board is round. So are scores.', 'Take your time. I will.'],
    big: ['Adequate.', 'Steady.'],
    max: ['One eighty. As planned.'],
    low: ['Hm.', 'Noted.'],
    bust: ['Bust. Recounting.'],
    pBig: ['Good. Again.', 'Hm. Acceptable.'],
    pMax: ['Noted. Impressive.'],
    pLow: ['Patience.', 'Breathe.'],
    pBust: ['Too eager.'],
    legWin: ['Leg. Next.'],
    pLegWin: ['You found the double. Correct.'],
    win: ['Steady wins.'],
    pWin: ['You were patient. I respect that.', 'Vortex is next. It talks a lot.'],
  },
  cocky: {
    start: ['Darts? I invented darts.', 'Try to keep up.'],
    big: ['Easy money.', 'Too easy.'],
    max: ['One eighty. Try it sometime.'],
    low: ['The board moved.', 'That one was a warm-up.'],
    bust: ['That bust was... strategic.'],
    pBig: ['Fluke.', 'I let you have that.'],
    pMax: ['Okay. Now I\'m trying.'],
    pLow: ['Is the board too small for you?', 'Wrong board.'],
    pBust: ['Can\'t count? I can.'],
    legWin: ['And that\'s a leg. Obviously.'],
    pLegWin: ['Enjoy it while it lasts.'],
    win: ['Flawless. As always.'],
    pWin: ['That... wasn\'t supposed to happen.', 'Omega will crush you. Probably.'],
  },
  cold: {
    start: ['Calculating trajectories. You lose.', 'Your chances: 0.3 percent.'],
    big: ['Within tolerance.', 'As computed.'],
    max: ['Maximum. Inevitable.'],
    low: ['Anomaly logged.', 'Recalibrating.'],
    bust: ['Arithmetic fault. Rebooting.'],
    pBig: ['Statistically irrelevant.'],
    pMax: ['Unexpected. Upgrading.', 'Warning: human is improving.'],
    pLow: ['As predicted.'],
    pBust: ['Human arithmetic: insufficient.'],
    legWin: ['Leg secured. Next.'],
    pLegWin: ['Anomaly. Recalibrating.'],
    win: ['Champion. Still.', 'You were adequate.'],
    pWin: ['Impossible... You are the champion now.', 'New champion detected. Well thrown, human.'],
  },
};

// Cricket: cBig (5+ marks), pcBig (yours), cLegWin, pcLegWin. Killer: kKiller
// (it's a killer now), kHit (it took a life off you), kHurt (you took one off
// it), kOut (it's out), kSelf (it hit its own number), kYouOut (you're out).
const MORE = {
  nice: {
    cBig: ['I closed one! Do I get a sticker?', 'Lots of marks! Hooray!'],
    pcBig: ['You\'re closing everything!', 'Wow, so many marks!'],
    cLegWin: ['I closed them all! Yay!'],
    pcLegWin: ['You shut the whole board! Well done!'],
    kKiller: ['I\'m a killer now? That sounds scary!', 'Oh! I\'m a killer! Sorry in advance!'],
    kHit: ['Sorry! Sorry! I had to!', 'Oops, that was your number!'],
    kHurt: ['Ow! Fair enough!', 'Eek! You got me!'],
    kOut: ['I\'m out! That was fun though!'],
    kSelf: ['I hit my own number! Silly me!'],
    kYouOut: ['Oh no, you\'re out! You can cheer for me!'],
  },
  hyper: {
    cBig: ['MARKS! MARKS! MARKS!', 'Closing at TOP SPEED!'],
    pcBig: ['Whoa, slow down with the marks!', 'Hey! Leave some for me!'],
    cLegWin: ['ALL CLOSED! Victory lap!'],
    pcLegWin: ['You closed it all? I wasn\'t ready!'],
    kKiller: ['KILLER MODE! ACTIVATED!', 'Now I go FAST and DANGEROUS!'],
    kHit: ['BOOM! Got you!', 'Too fast for you!'],
    kHurt: ['Hey! Ouch! HEY!', 'That one stung!'],
    kOut: ['Out?! I was just warming up!'],
    kSelf: ['I hit myself! Too much power!'],
    kYouOut: ['You\'re OUT! Zoom zoom!'],
  },
  cheeky: {
    cBig: ['Closed. Closed. Closed. Keep up!', 'Marks for days.'],
    pcBig: ['Lucky marks.', 'Hmph. Showing off.'],
    cLegWin: ['Shut the board. Shut the door.'],
    pcLegWin: ['Okay, you closed it. Annoying.'],
    kKiller: ['Guess who\'s a killer now.', 'Ooh, I\'m armed. Watch your number.'],
    kHit: ['Nothing personal. Okay, a bit personal.', 'Was that your number? Whoops.'],
    kHurt: ['Rude!', 'I\'ll remember that.'],
    kOut: ['I\'m out? I demand a recount.'],
    kSelf: ['Meant to do that. Obviously.'],
    kYouOut: ['Bye bye! Wave from the sofa!'],
  },
  dry: {
    cBig: ['Closed.', 'Efficient.'],
    pcBig: ['Good marks.', 'Hm. Tidy.'],
    cLegWin: ['Board closed. Leg.'],
    pcLegWin: ['You closed it properly.'],
    kKiller: ['Killer. Proceeding.', 'Armed.'],
    kHit: ['A life. Yours.', 'Necessary.'],
    kHurt: ['Hm. Fair.', 'Noted.'],
    kOut: ['Out. Acceptable.'],
    kSelf: ['Own number. Careless.'],
    kYouOut: ['You\'re out. Patience next time.'],
  },
  cocky: {
    cBig: ['Close, close, close. Easy.', 'Watch and learn.'],
    pcBig: ['Fluke marks.', 'I let you close that.'],
    cLegWin: ['Closed. Obviously.'],
    pcLegWin: ['Enjoy it. It won\'t happen again.'],
    kKiller: ['Killer. Who\'s first?', 'Everyone, say goodbye.'],
    kHit: ['Too easy.', 'One less life. You\'re welcome.'],
    kHurt: ['That was luck.', 'Hey! I\'m the killer here!'],
    kOut: ['Out? The board moved.'],
    kSelf: ['That was... a test.'],
    kYouOut: ['And you\'re gone. Next!'],
  },
  cold: {
    cBig: ['Numbers closing. As computed.', 'Efficiency: optimal.'],
    pcBig: ['Unexpected marks. Logged.'],
    cLegWin: ['Board closed. Leg secured.'],
    pcLegWin: ['Anomaly. Recalibrating.'],
    kKiller: ['Killer protocol engaged.', 'Targets acquired.'],
    kHit: ['Target damaged.', 'Life removed.'],
    kHurt: ['Damage detected.', 'Minor setback.'],
    kOut: ['Eliminated. Impossible.'],
    kSelf: ['Self-targeting error.'],
    kYouOut: ['Human eliminated.'],
  },
};
for (const v of Object.keys(MORE)) Object.assign(LINES[v], MORE[v]);

export const DART_TALK_CHANCE = { start: 1, big: 0.7, max: 1, low: 0.4, bust: 0.9, pBig: 0.6, pMax: 1, pLow: 0.35, pBust: 0.8, legWin: 1, pLegWin: 1, win: 1, pWin: 1,
  cBig: 0.6, pcBig: 0.5, cLegWin: 1, pcLegWin: 1, kKiller: 0.8, kHit: 0.7, kHurt: 0.6, kOut: 1, kSelf: 1, kYouOut: 1 };

let lastLine = null;
export function dartLine(rival, moment, rng = Math.random) {
  const set = LINES[rival.voice]?.[moment];
  if (!set?.length) return null;
  let line = set[Math.floor(rng() * set.length)];
  if (line === lastLine && set.length > 1) line = set[(set.indexOf(line) + 1) % set.length];
  lastLine = line;
  return line;
}

// ------------------------------------------------------------ the caller --
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const r = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${r ? ` and ${words(r)}` : ''}`;
}
// What the caller says for a visit.
export function callFor(total, bust) {
  if (bust || !total) return 'No score';
  const w = words(total);
  return w[0].toUpperCase() + w.slice(1) + (total >= 100 ? '!' : '');
}
