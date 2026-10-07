# Sports Hall: Table Tennis, Mini Golf and Darts (Meta Quest)

WebXR sports for the Meta Quest 3S, in VR (a sports hall with a crowd) or
mixed reality (in your own room). Plain HTML/JS + three.js, no build
step. Live at https://doublehb.github.io/sportshall/

- **Match**: quick play against a robot at four levels.
- **Ladder**: six robot characters (Rookie, Bolt, Spinny, Chopper, Vortex, Omega), each with its own style, colours and trash talk. Beat one to unlock the next; beat Omega to become champion (a trophy appears in the hall).
- **Cup**: an 8-player knockout (you + seven robots, including the cup-only Zippy). You play your own matches; watch or skip the robot matches (skipped ones are settled by rating-based point odds). Quarters and semis are one game, the final best of three. The bracket is saved between visits.
- **Practice**: ball machine with pace, spin and placement, plus targets.
- **Stroke lessons** (Practice > Stroke lessons): forehand drive, backhand drive, topspin, backspin push and serve. A ghost paddle demonstrates each stroke where you stand (with a ghost ball for timing), then 10 balls are judged with specific feedback (wrong side, not enough spin, into the net, long, missed) and up to three stars. Lessons cap aim assist at Light and use none on serves. `src/lessons.js` holds the rules; `STROKES` in `src/fx.js` holds the ghost key poses. On a screen the paddle uses a matching swing style (`DESK_STYLES` in `src/desk.js`).
- **Exhibition** (Match > Watch two robots play): pick any two robots and watch from a courtside seat; they trash-talk each other.
- **Paddle feel** (Settings > Paddle feel…): sweet spot size, bounce, spin grip, swing power and smoothing, plus a log of your last hits (swing speed, ball speed, spin, result). "Share these…" makes a link and QR code (`?feel=82_86_60_105_0_-10`, see `src/share.js`); opening it asks before changing anything.
- **Phones and tablets**: drag to move the paddle, Serve and Menu buttons, wider view when upright. Works for playing solo and for joining a friend.
- **Mini golf with a friend** (Mini Golf > Friend): host as below, then "Start a round together". You're player 1, they're player 2; on their turn they drag-and-release on their own screen and the putt is sent to you. Your game runs the course and streams snapshots (`golf.snapshot()`/`applyRemote`); announcements go out as events (`gev`) so each screen words them for its own player ("Your turn" / "Sam's turn").
- **Friend**: host a game from the headset; a friend on a PC opens the same link, chooses "Join a friend's game" and types the 4-letter code. Peer-to-peer through PeerJS (free cloud matchmaker); the host runs the physics and the friend's browser only sends where their mouse points.

**Mini golf** (the Mini Golf switch at the top of the menu): two courses on the
hall floor. Classic (Warm Up, Dog Leg, Bumper Alley, The Hill, Windmill, The Bowl;
par 15) and Trickshot (Loop the Loop, Sliders, The Jump, Spinner, Pipe Dream,
Island; par 18) with a vertical loop that needs pace, sliding blocks and a
spinning bar that knock the ball, a ramp jump over a pit, pipes that teleport the
ball, and water (a penalty stroke and replay from where you hit it). For
1-4 players taking turns, with a scorecard, a 6-stroke limit and best rounds. In
VR a putter hangs from your paddle hand's pointer and you swing it; the free
hand's trigger takes you to your ball, side-on. On a screen, drag back from the
ball and let go. `src/golf/course.js` (holes), `src/golf/physics.js` (rolling,
walls, bumpers, slopes, windmill gate, cup, putter contact; tested in
`tests/golf.test.mjs`) and `src/golf/game.js` (visuals, turns, scorecard).

**Darts** (the Darts switch): a regulation board (1.73 m up, the oche 2.37 m away)
in a cabinet on a little stage. 301 or 501, any finish or double out, one leg or
best of 3 or 5, against any of the six robots (each throws with its own spread:
Rookie averages about 26 a visit, Omega about 79) or two people taking turns. The
robot steps up beside you to throw, the caller calls each visit ("One hundred
and eighty!"), the scoreboard shows checkouts, and the bed for your first dart
glows. **Cricket**: close 20 down to 15 and the bull (three marks each; a double
is two, a treble three), then score on your closed numbers until the other side
closes them; marks per round on the scoreboard, numbers everyone has closed greyed
out on the board, the caller calls marks and white horses. **Killer**: 2-4 players
(you and robots picked round the one you choose, or people taking turns), 3 or 5
lives, each player's number tinted in their colour on the board: hit yours three
times to become a killer, then a single takes one life, a double two, a treble
three, and your own number costs you one. Up to three robots wait their turn on
your left. In cricket and Killer every robot dart gets the concentration of a
finishing double (Rookie would take 60+ visits a cricket leg otherwise). Practice:
Around the Clock (fewest darts), Count-up (8 visits) and Free throw.
**Darts cup** (Darts > Cup): the same eight-player draw as the table tennis cup;
quarter-finals and semi-finals are one leg of 301, the final best of three, with
your finish setting. Watch the robot matches (two robots at the oche) or skip them
(`src/darts/cup.js` plays a skipped match out dart by dart with the robots' real
throwing). **Darts with a friend** (Darts > Friend): host as below, then "Start
darts together" plays the game picked on the Match tab. Both screens run the same
game from the same start (`darts.setup`: who throws first, Killer numbers); the
friend sends where they let go (`dthrow`), the host throws it for them from beside
you and sends every dart's flight and outcome (`dart`) so both boards match. Each
side keeps its own clock, so before a dart from the other side the game skips any
pause between visits (`catchUp`). In VR the friend appears as a person stepping up
to throw beside you. In VR the dart sticks out of your throwing hand's controller: hold the
trigger (or grip), throw, let go. The throw speed is the peak of the last 120 ms
(so letting go a moment late doesn't kill it); Settings has aim help (pulls a
near miss towards where the dart was pointing as you aimed; Full also shows an
aim dot) and throw power (for darts landing low). On a screen, point at the
board, press, and let go when the wobble settles. `src/darts/board.js` (sizes,
scoring, aim points), `rules.js` (x01 legs and busts, checkout routes, Cricket,
Killer and where to aim at each, Around the Clock, Count-up), `flight.js` (projectile, where a throw ends up, bounce-outs off
the wire, release speed), `robots.js` (spreads, lines, the caller) and `game.js`
(stage, turns, robot, cameras); tested in `tests/darts.test.mjs`.

Robots celebrate (fist pumps, spins, dances, sulks), talk in speech bubbles with
beeps or a real voice (Settings > Robot talk), and confetti flies when you win.

## Controls (headset)

| | |
|---|---|
| Paddle hand (right by default) | swing the paddle; point + trigger clicks the menu |
| Free hand trigger | toss the ball to serve |
| X / Y | menu (pauses) |
| Free hand stick | move yourself round the table |
| Click the free hand stick | recentre the table in front of you |

Settings: paddle hand, aim assist (Off / Light / Full), serve rules (Casual /
Proper), paddle angle, sound.

## Layout

- `index.html`: the page, the import map (three.js 0.186.1 from jsdelivr) and the test hooks
- `src/physics.js`: ball physics in table space (drag, Magnus spin, bounces, net, swept paddle hits, shot solver)
- `src/rules.js`: `Referee` (one rally) and `Match` (score, serve order, deuce)
- `src/ai.js`: the robot (`Bot`, `LEVELS`), legal serve search, the practice `Machine`
- `src/assist.js`: aim assist (mirrored for the far end)
- `src/rivals.js`: the robot characters, their play-style tweaks and lines
- `src/fx.js`: confetti, speech bubble, trophy, human avatars
- `src/desk.js`: the mouse-driven paddle (`DeskPaddle`) and blade tracking (`BladeTracker`)
- `src/net.js`: PeerJS host/join with 4-letter room codes
- `src/world.js`, `src/panel.js`, `src/audio.js`: visuals, canvas menus/boards, synthesised sounds
- `src/main.js`: XR session, controllers, game loop, match/practice flow, desktop preview

## Run and test

- Preview: `dev\serve.ps1` (http://localhost:8782/). "Preview on this screen" plays with the mouse.
- `?emulate=1` fakes a Quest 3 with Meta's IWER so the VR code runs on a PC; add `&pump=1` to step frames with `__pump(n)`.
- `window.__sh` exposes the game state (`advance(sec)`, `G.autoplay = true`, `debugXR()`).
- Engine tests: `tests\run-tests.ps1` (Node from `C:\Claude\tools\node`, includes a robot-v-robot balance sim).

## Playing on the Quest

WebXR needs an https page. Host the folder anywhere with https (e.g. GitHub Pages)
and open the link in the Quest browser, then "Play in VR" or "Play in your room".
