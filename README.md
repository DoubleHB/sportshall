# Sports Hall: Table Tennis (Meta Quest)

WebXR table tennis for the Meta Quest 3S, in VR (a sports hall with a crowd) or
mixed reality (the table in your own room). Plain HTML/JS + three.js, no build
step. Live at https://doublehb.github.io/sportshall/

- **Match**: quick play against a robot at four levels.
- **Ladder**: six robot characters (Rookie, Bolt, Spinny, Chopper, Vortex, Omega), each with its own style, colours and trash talk. Beat one to unlock the next; beat Omega to become champion (a trophy appears in the hall).
- **Cup**: an 8-player knockout (you + seven robots, including the cup-only Zippy). You play your own matches; watch or skip the robot matches (skipped ones are settled by rating-based point odds). Quarters and semis are one game, the final best of three. The bracket is saved between visits.
- **Practice**: ball machine with pace, spin and placement, plus targets.
- **Exhibition** (Match > Watch two robots play): pick any two robots and watch from a courtside seat; they trash-talk each other.
- **Paddle feel** (Settings > Paddle feel…): sweet spot size, bounce, spin grip, swing power and smoothing, plus a log of your last hits (swing speed, ball speed, spin, result). "Share these…" makes a link and QR code (`?feel=82_86_60_105_0_-10`, see `src/share.js`); opening it asks before changing anything.
- **Phones and tablets**: drag to move the paddle, Serve and Menu buttons, wider view when upright. Works for playing solo and for joining a friend.
- **Friend**: host a game from the headset; a friend on a PC opens the same link, chooses "Join a friend's game" and types the 4-letter code. Peer-to-peer through PeerJS (free cloud matchmaker); the host runs the physics and the friend's browser only sends where their mouse points.

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
