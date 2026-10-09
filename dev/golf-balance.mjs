// How the robot golfers score: node dev/golf-balance.mjs [ids] [rounds]
// (e.g. node dev/golf-balance.mjs rookie,omega 6). Slow: a few minutes for all six.
import { COURSES, coursePar } from '../src/golf/course.js';
import { planPutt, playHole, golfSkill } from '../src/golf/ai.js';
import { prepareHole, makeGolfBall } from '../src/golf/physics.js';

let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// How long one search from each tee takes (the game spreads it over frames).
for (const c of Object.values(COURSES)) {
  for (const h of c.holes) {
    const t0 = performance.now();
    planPutt(prepareHole(h), makeGolfBall(h.tee[0], h.tee[1]), 0, golfSkill('chopper'), rng);
    console.log(c.id, h.name, `${(performance.now() - t0).toFixed(0)} ms`);
  }
}
const ids = (process.argv[2] ?? 'rookie,bolt,spinny,chopper,vortex,omega').split(',');
const rounds = +(process.argv[3] ?? 6);
for (const c of Object.values(COURSES)) {
  console.log(`\n${c.id} par ${coursePar(c.holes)}`);
  for (const id of ids) {
    const per = c.holes.map(() => 0); let tot = 0;
    for (let r = 0; r < rounds; r++) c.holes.forEach((h, i) => { const s = playHole(h, id, rng); per[i] += s; tot += s; });
    console.log(id.padEnd(8), (tot / rounds).toFixed(1), per.map(p => (p / rounds).toFixed(1)).join(' '));
  }
}
