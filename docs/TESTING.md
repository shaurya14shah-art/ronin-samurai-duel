# Testing

`npm test` runs every `*.test.ts` in `shared/src` and `client/src` on the Node test runner (tsx).

- **Sim rules** (`shared/src/combat/duel.test.ts`): one test per rule, written so it fails if the
  rule is removed. Uses `testkit.ts` (two fighters facing along z; `run(duel, ticks, script)`).
- **Determinism**: the same scripted inputs must give equal `duel.hash()`, and snapshot →
  restore → continue must equal an uninterrupted run. Any rule touching `Math.random`, wall
  clock or iteration-order-dependent state breaks this test.
- **AI** (`ai.test.ts`): soak across all personality pairings (finite state, no phase held over
  4 s, fights happen), reaction-time floor, habit exploitation across encounters (averaged over
  seeds, because a single seed is noise), strategy change on encounter 4.
- **Player input** (`client/src/duel/PlayerIntent.test.ts`): gesture → cut direction, guard line,
  one-shot intents, no input without pointer lock, camera-yaw ↔ sim-facing convention.

Not automated yet: in-browser duel flows. The AI only runs during engagement, and pointer lock
can be simulated with `InputSystem.getInstance().setSimulatedLock(true)`. Frames can be stepped
manually via `__RONIN_DEBUG__.scene.update(1/60)` when the tab is throttled.

## Network

- `shared/src/combat/net.test.ts` (in `npm test`): input sanitizing, rate limit and one-shot cap,
  and no teleport through hostile input.
- `net.test.ts` also covers stamped inputs and acks, backlog trimming that never drops a cut,
  and prediction: on a delayed link the predicted fighter equals the server's, tick for tick,
  and a server correction is snapped to and replayed over.
- `server/src/records.test.ts`: identities must be UUIDs, results persist, no self-farming.
- `npm run test:net`: needs `npm run dev:server`. The server must list a waiting public duel
  (and not a private one), resolve an intent-only cut, ignore claimed damage and position, keep
  both clients in agreement, give a dropped player their seat back, and record the result.
- `node tools/two-player.mjs <outdir>`: needs both the client (:3000) and the server (:2567).
  Two headless browsers go through the real UI (host, code, join, enter the ring), and one
  cuts the other. Screenshots are written to `<outdir>`. With `--lag 120`, player A runs with
  added latency and the run checks that A's fighter moves before the server's copy does and
  settles exactly on it.

## Tools

- `tools/bench-sim.ts`, `tools/bench-frame.mjs`: see `docs/PERFORMANCE.md`.
- `tools/face-closeup.mjs <png> [angle]`: a close-up of a rival's face through photo mode.
- `client/src/world/Journal.test.ts`, `JourneySave.test.ts`: the journal log, and old saves
  migrating without levels or skill points.

## Playing it

- `node tools/playtest.mjs [duels] [rival 0-4]`: a visible browser fights rivals with trusted
  keyboard and mouse events through PlayerIntent. Aim (camera yaw) and the walk to the rival are
  set directly; pointer capture is simulated because the browser refuses it to an automated
  window. A smoke test of the whole loop, not a substitute for playing.
- `node tools/movement-check.mjs`: walking direction and dash distances in a real page.
- `node tools/bench-real.mjs`: frame times in a visible browser (see PERFORMANCE.md).
- `/hand.html` on the dev server: the first-person hands and sword from four angles.
- `shared/src/combat/training.test.ts`: one test per training effect and technique (each fails
  if its rule is switched off; checked by mutating the constants).
- `client/src/progression/Way.test.ts`: costs, prerequisites, insight, mastery, save validation.
