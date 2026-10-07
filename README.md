# Sports Hall: Table Tennis (Meta Quest)

WebXR table tennis for the Meta Quest 3S, in VR (a sports hall with a crowd) or
mixed reality (the table in your own room). Play a robot at four levels, or
practise against a ball machine with targets. Plain HTML/JS + three.js, no build
step.

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
- `src/assist.js`: aim assist
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
