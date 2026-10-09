// How the robot bowlers score: node dev/bowling-balance.mjs [ids] [games]
import { Bowling } from '../src/bowling/rules.js';
import { robotShot } from '../src/bowling/robots.js';
import { simulate } from '../src/bowling/physics.js';

let seed = 5;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const ids = (process.argv[2] ?? 'rookie,bolt,spinny,chopper,zippy,vortex,omega').split(',');
const games = +(process.argv[3] ?? 10);
for (const id of ids) {
  let total = 0, strikes = 0, balls = 0, ms = 0, spares = 0;
  for (let k = 0; k < games; k++) {
    const g = new Bowling({ players: 1 });
    let stand = null;
    while (!g.over) {
      const t0 = performance.now();
      const shot = robotShot(id, stand, rng);
      ms += performance.now() - t0; balls++;
      const r = simulate(stand, shot);
      const before = stand ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const res = g.roll(r.down.length);
      if (res.strike) strikes++;
      if (res.spare) spares++;
      stand = res.rack ? null : before.filter(i => !r.down.includes(i));
    }
    total += g.score(0);
  }
  console.log(id.padEnd(8), `average ${(total / games).toFixed(0)}  strikes/game ${(strikes / games).toFixed(1)}  spares/game ${(spares / games).toFixed(1)}  ${(ms / balls).toFixed(1)} ms a ball to plan`);
}
