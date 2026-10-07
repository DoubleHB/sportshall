// The robots you play: who they are, how they play, how they look and what
// they say. The ladder climbs through them in order.

export const RIVALS = [
  {
    id: 'rookie', name: 'Rookie', level: 'easy', games: 1, voice: 'nice',
    bio: 'Just switched on. Very polite.',
    look: { body: 0xeef1f6, accent: 0x58d68d, eyes: 0x7dff9a },
    tweak: { errRate: 0.13 },
  },
  {
    id: 'bolt', name: 'Bolt', level: 'easy', games: 1, voice: 'hyper',
    bio: 'Hits everything as hard as it can.',
    look: { body: 0xfff4c2, accent: 0xffc93c, eyes: 0xfff27a },
    tweak: { pace: [6, 8.5], errRate: 0.12, speed: 2.6, smash: 0.6 },
  },
  {
    id: 'spinny', name: 'Spinny', level: 'medium', games: 3, voice: 'cheeky',
    bio: 'More spin than a washing machine.',
    look: { body: 0xf1e6ff, accent: 0xb057ff, eyes: 0xe08bff },
    tweak: { spin: [150, 300], sideSpin: 70, pace: [5, 7.5] },
  },
  {
    id: 'chopper', name: 'Chopper', level: 'medium', games: 3, voice: 'dry',
    bio: 'Chops everything back with backspin. Never gets bored.',
    look: { body: 0xe3f3ff, accent: 0x2fb8ff, eyes: 0x8fe3ff },
    tweak: { chop: 0.6, errRate: 0.045, pace: [4.5, 7] },
  },
  {
    id: 'vortex', name: 'Vortex', level: 'hard', games: 3, voice: 'cocky',
    bio: 'Fast, flashy and very pleased with itself.',
    look: { body: 0xffe9e4, accent: 0xff5a3c, eyes: 0xff9a7a },
    tweak: {},
  },
  {
    id: 'omega', name: 'Omega', level: 'pro', games: 5, voice: 'cold',
    bio: 'The champion. Has never lost. Says so a lot.',
    look: { body: 0x2a2f3a, accent: 0xd4af37, eyes: 0xff3b3b },
    tweak: {},
  },
];

// Quick-play opponent for each level.
export const QUICK = { easy: 'rookie', medium: 'spinny', hard: 'vortex', pro: 'omega' };
export const rivalById = id => RIVALS.find(r => r.id === id) ?? RIVALS[0];

// Lines by personality and moment. {you} = the player's name on the board.
const LINES = {
  nice: {
    start: ['Hello! Let\'s have fun!', 'I\'ll try my best!', 'Be gentle, I\'m new!'],
    robotPoint: ['Oh! Sorry!', 'Did I do that?', 'Lucky me!'],
    playerPoint: ['Great shot!', 'Wow, well played!', 'Ooh, nice one!', 'You\'re good at this!'],
    playerNet: ['The net\'s tricky, isn\'t it?', 'So close!'],
    playerLong: ['Just a bit long!', 'Nearly!'],
    longRally: ['What a rally!', 'This is fun!'],
    robotStreak: ['I think I\'m getting the hang of this!'],
    playerStreak: ['You\'re on fire!', 'Teach me!'],
    deuce: ['Deuce! How exciting!'],
    robotGamePoint: ['Game point? Me?!'],
    playerGamePoint: ['Game point to you. Eek!'],
    robotWinsGame: ['I won a game! Can I tell my mum?'],
    playerWinsGame: ['Well played! That game\'s yours.'],
    robotWinsMatch: ['I won?! Thank you for playing!'],
    playerWinsMatch: ['Brilliant! You beat me fair and square!', 'Congratulations! Good luck with Bolt!'],
  },
  hyper: {
    start: ['READY? I\'M READY! LET\'S GO!', 'Maximum power!'],
    robotPoint: ['ZOOM!', 'Too fast for you!', 'BOOM! Did you see that?'],
    playerPoint: ['Whoa! Okay! Okay!', 'Lucky! Do it again!', 'Hey! I wasn\'t ready!'],
    playerNet: ['Net! Ha!', 'The net wins again!'],
    playerLong: ['Out! Out out out!', 'Overcooked it!'],
    longRally: ['Faster! FASTER!', 'This is AMAZING!'],
    robotStreak: ['I\'m unstoppable!', 'Battery at 100 percent!'],
    playerStreak: ['Stop doing that!', 'Recharging... RECHARGING!'],
    deuce: ['DEUCE! My circuits are buzzing!'],
    robotGamePoint: ['One more! ONE MORE!'],
    playerGamePoint: ['No no no no no!'],
    robotWinsGame: ['VICTORY LAP!'],
    playerWinsGame: ['Rematch! Rematch!'],
    robotWinsMatch: ['FASTEST BOT IN THE HALL!'],
    playerWinsMatch: ['Aww, I ran out of zoom.', 'You\'re quick! Spinny\'s next. Good luck!'],
  },
  cheeky: {
    start: ['Hope you like spin!', 'Watch it curve... wheee!'],
    robotPoint: ['Spin to win!', 'Didn\'t see that coming, did you?', 'Round the bend!'],
    playerPoint: ['Hmph. Fine.', 'Lucky bounce.', 'You read that one.'],
    playerNet: ['The spin got you!', 'Into the net, as planned.'],
    playerLong: ['Topspin, mate. Try it.', 'Flew off like a frisbee!'],
    longRally: ['Round and round we go!'],
    robotStreak: ['Feeling a bit dizzy? I\'m not.'],
    playerStreak: ['Stop un-spinning my spins!'],
    deuce: ['Deuce! Let\'s twist again.'],
    robotGamePoint: ['Game point. Spin incoming.'],
    playerGamePoint: ['Don\'t get cocky.'],
    robotWinsGame: ['That one had more spin than a washing machine.'],
    playerWinsGame: ['You got lucky. Next game.'],
    robotWinsMatch: ['Spun out! Better luck next time.'],
    playerWinsMatch: ['You untangled me. Respect.', 'Chopper\'s next. Bring patience.'],
  },
  dry: {
    start: ['Chop chop.', 'Take your time. I will.'],
    robotPoint: ['Patience.', 'It always comes back.', 'Chop.'],
    playerPoint: ['Hm. Acceptable.', 'Noted.', 'Good. Again.'],
    playerNet: ['Backspin does that.', 'It sank. As backspin does.'],
    playerLong: ['Too eager.', 'Calm down.'],
    longRally: ['I could do this all day.', 'And I will.'],
    robotStreak: ['Slow and steady.'],
    playerStreak: ['Interesting.'],
    deuce: ['Deuce. Good. More rallies.'],
    robotGamePoint: ['Game point. No hurry.'],
    playerGamePoint: ['Game point. Breathe.'],
    robotWinsGame: ['Backspin is a lifestyle.'],
    playerWinsGame: ['You attacked the chop. Correct.'],
    robotWinsMatch: ['The ball came back. Every time.'],
    playerWinsMatch: ['You were patient. I respect that.', 'Vortex is next. It talks a lot.'],
  },
  cocky: {
    start: ['Is this a warm-up? For me it is.', 'Try to keep up.', 'I\'ll go easy. Joking.'],
    robotPoint: ['Too easy.', 'Is that all you\'ve got?', 'Next!', 'I\'ve seen faster toasters.'],
    playerPoint: ['Fluke.', 'I let you have that one.', 'Enjoy it while it lasts.'],
    playerNet: ['The net likes you more than the table.', 'Try going OVER it.'],
    playerLong: ['Wrong table.', 'That\'s in the car park.'],
    longRally: ['Still here? Impressive.', 'You\'re stubborn, I\'ll give you that.'],
    robotStreak: ['This is my house!', 'Flawless.'],
    playerStreak: ['Okay, now I\'m trying.', 'Who ARE you?'],
    deuce: ['Deuce. You\'re making me sweat. I don\'t sweat.'],
    robotGamePoint: ['Game point. Say goodbye.'],
    playerGamePoint: ['Game point? Don\'t choke.'],
    robotWinsGame: ['And that\'s how it\'s done.'],
    playerWinsGame: ['Fine. I was buffering.'],
    robotWinsMatch: ['Flawless victory. Obviously.'],
    playerWinsMatch: ['That... wasn\'t supposed to happen.', 'Omega will crush you. Probably.'],
  },
  cold: {
    start: ['Calculating... you lose.', 'Your chances: 0.3 percent.', 'I have never lost.'],
    robotPoint: ['As predicted.', 'Inevitable.', 'Resistance is inefficient.', 'Error detected: you.'],
    playerPoint: ['Anomaly logged.', 'Recalibrating.', 'Statistically irrelevant.'],
    playerNet: ['Net. Predicted 0.4 seconds ago.'],
    playerLong: ['Trajectory: incorrect.'],
    longRally: ['Rally exceeds expected length. Adjusting.'],
    robotStreak: ['Efficiency: optimal.'],
    playerStreak: ['Unexpected. Upgrading.', 'Warning: human is improving.'],
    deuce: ['Deuce. Probability recalculating.'],
    robotGamePoint: ['Game point. Ending sequence.'],
    playerGamePoint: ['Game point to human. Unacceptable.'],
    robotWinsGame: ['Game. Next.'],
    playerWinsGame: ['System error. Rebooting confidence.'],
    robotWinsMatch: ['Champion. Still.', 'You were adequate.'],
    playerWinsMatch: ['Impossible... You are the champion now.', 'New champion detected. Well played, human.'],
  },
};

// Pick a line for a moment, or null. Avoids repeating the last line.
let lastLine = null;
export function talkLine(rival, moment, rng = Math.random) {
  const set = LINES[rival.voice]?.[moment];
  if (!set?.length) return null;
  let line = set[Math.floor(rng() * set.length)];
  if (line === lastLine && set.length > 1) line = set[(set.indexOf(line) + 1) % set.length];
  lastLine = line;
  return line;
}

// How keen each moment is to get a comment (1 = always).
export const TALK_CHANCE = {
  start: 1, robotPoint: 0.45, playerPoint: 0.45, playerNet: 0.6, playerLong: 0.5, longRally: 1,
  robotStreak: 0.9, playerStreak: 0.9, deuce: 1, robotGamePoint: 0.8, playerGamePoint: 0.8,
  robotWinsGame: 1, playerWinsGame: 1, robotWinsMatch: 1, playerWinsMatch: 1,
};

export const VOICE = { nice: { pitch: 1.5, rate: 1.05 }, hyper: { pitch: 1.8, rate: 1.35 }, cheeky: { pitch: 1.3, rate: 1.1 }, dry: { pitch: 0.8, rate: 0.85 }, cocky: { pitch: 1.0, rate: 1.1 }, cold: { pitch: 0.4, rate: 0.85 } };
