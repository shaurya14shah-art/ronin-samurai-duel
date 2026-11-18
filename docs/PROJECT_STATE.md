# Project State

_Last updated: 2026-10-03 (session 3: … online with prediction and accounts, hosting, first hand-play fixes, realistic hands and blade, The Way)_

## Verified this session

| Check | Result |
|---|---|
| `npm test` | **115/115 pass** (sim/AI incl. training and techniques, net input + prediction, server accounts and records, the Way, journal, save migration, walker direction and dash, terrain, soundscape, forge) |
| `npm run build` | passes (shared, client, server) |
| `npm run test:net` (server running) | open duel listed; server resolves a cut, ignores a damage/teleport claim, clients agree; a dropped player reconnects; the result is recorded for both identities |
| `node tools/two-player.mjs <dir> --lag 120` | two headless browsers host and join by code through the UI; with 244 ms ping, A's fighter moves within 120 ms (server copy not yet), settles exactly on the server's state; A's cut lands on B |
| `npm run test:net` accounts part | register, unique names, wrong password, sign in, forged token refused, account name enforced, guests cannot take an account's name, sign out |
| Production build (`npm run serve`, :8080) | one process serves the page, duels and API; net test and two-browser duel pass against it; room monitor off |
| `node tools/bench-real.mjs` (visible Chromium, 1920×1080) | 60 fps held at five places (median 16.7–16.8 ms, p95 ≤ 19.2 ms, no frames over 25 ms) |
| `node tools/playtest.mjs 3 1` | duels fought through trusted key/mouse events (pointer capture simulated: an automated window is refused it); the bot loses to the rivals as expected, landing real damage |
| `node tools/movement-check.mjs` | W moves along the view, S away; Space dashes 2.4 m exploring, 1.6 m back in a duel |
| Headless visual checks (`node tools/shot.mjs <png> --js …`) | title, play HUD, duel, pause, character, settings, death, every forge step, all captured and inspected |

`tools/shot.mjs` drives the running dev server in headless Chromium (Metal/ANGLE). Use it for
visual verification: the desktop preview pane stops presenting frames when hidden.

## First hand-play (by the user) and what it fixed

- **W/S were inverted when walking** (not in duels). The walker multiplied by the wrong sign;
  no test checked direction. Fixed, with a direction test at three yaws.
- **Dash did not work.** Taps shorter than a frame were lost (held-key polling) and the dash was
  capped at walking speed. Now edge-triggered, one per press: 2.4 m outside duels; in a duel
  the step is 1.3 m forward, 1.6 m back, 1.0 m aside.
- **Hands and blade looked toy-like.** Hands are now sculpted (swept fingers with knuckles and
  creases, back of hand, thumb) under indigo tekko; the katana is rebuilt from its anatomy
  (shinogi-zukuri section, kissaki, hamon with nioi, hada, migaki, brass habaki, copper seppa,
  hammered tsuba, ito over samegawa, menuki, kashira). `/hand.html` shows them in isolation.
- **Skill tree**: The Way (DECISIONS D5): physical training, techniques, sword types. See
  COMBAT_DESIGN "Techniques" and "Training".

## What changed in session 3

- **Title light.** The title pins clear evening weather and a low sun, regardless of the save.
  Your saved weather comes back when play begins.
- **Photo mode** (P, or from the pause menu). It freezes the moment and gives you a free
  camera. You can set FOV, exposure, time of day, haze, weather and depth of field (with focus
  distance), and save the frame as a PNG. H hides the panel.
- **World map** (M, or from the pause menu). It is painted from the real terrain heights,
  cedars, meadows and routes. Landmarks appear once discovered (walking near them). Rival
  records come from the duel memory. You can place your own mark (double-click), zoom and pan.
- **Multiplayer: 1v1 duels, server-authoritative** (`server/src/rooms/DuelRoom.ts`).
  - The server runs the same shared sim at 60 Hz. Clients send intent only: `sanitizeInput`,
    plus an `InputBuffer` that rate-limits to 90/s and caps one-shots.
  - The server broadcasts snapshots and events at 30 Hz, and decides hits, deaths and rounds.
    A new round starts 4 s after a death, and a disconnect gets a 20 s reconnect window.
  - UI (`ui/MultiplayerScreen.ts`): Quick duel, Host a private duel (shows a code), Join by
    code. Status shows your opponent and the ping. If the server is down, it says so and tells
    you how to start it.
  - The old trusting `WorldRoom` and its schema were deleted, and the unused `ForgeRoom` too.
  - **Client prediction** (shared `Predictor`): each input is stamped, applied locally at once,
    and replayed over every server snapshot after the server's ack. Tested: on a lossless
    delayed link the prediction equals what the server later decides, tick for tick; a forced
    server correction is snapped to and replayed over. Small corrections ease out on the camera.
  - **Open duels list** (`GET /duels`), **win/loss records** kept by the server per browser
    identity (a random UUID the browser makes; not an account), and **automatic reconnect**
    into the held seat. `?lag=150` on the client URL adds artificial latency for testing.
- **Architecture** (`world/Architecture.ts`): torii with a swept kasagi, timber buildings with
  curved tiled or thatched roofs, shoji that glow at night, stone and paper lanterns, a stone
  arch bridge (walkable deck) over a stream. Courtyard, shrine approach (now facing its road),
  hamlet, battlefield nobori, paddies with rice. Static parts are batched per material. Posts,
  walls, lanterns and parapets collide.
- **Bamboo** (`world/Bamboo.ts`): segmented culms with nodes and leaf sprays, grounded, per
  clump. The floating dark blobs on the title (old icosahedron crowns) and the bare poles are gone.
- **Paths**: worn-earth ribbons on the terrain, with routes to all five places.
- **Faces** (`characters/Face.ts`): a sculpted head (brow, sockets, eyes with lids, nose,
  lips, stubble, ears, hair and topknot) replaces the blank mannequin head on every swordsman.
- **Ground relief**: grass and soil normal maps applied in world space in the terrain shader.
- **Journal** (Character → Journal): written by real events as they happen.
- **Removed**: stat progression (levels, XP, skill tree, sword schools; old saves migrate), the
  primitive capsule "pilgrims", the cylinder training dummies (now straw targets), and ~10k
  lines of dead code (the unmounted React forge, old 3D forge interactions, `RivalFigure`…).
  React is no longer a dependency.

## What changed in session 2

- **Screen specks gone.** The stars were drawn with depth testing off, so they showed over
  everything. They're now depth-tested soft sprites. Square leaf and firefly points were removed.
- **First-person sword.** `FirstPersonRig` replaces `WeaponModel` for the player. The katana is
  held forward in a two-hand grip with wrist-hung forearms. The arc follows the sim. Draw and
  sheathe go from the left hip, and the saya and hakama are visible when looking down.
- **Characters.** `characters/Swordsman` is the Mesh2Motion CC0 body and clips, dressed with
  generated skinned cloth shells (kimono, obi, hakama, tabi), a kasa and a katana. Legs and body
  come from clips; the arms are solved with IK onto the sim-posed blade. All five rivals use it,
  and so does the player's portrait.
- **World.** Physical sky. PBR ground (ambientCG). Needle-card cedars, a following wind grass
  field and a ridged mountain range. Poly Haven rocks and meadows.
- **Rendering fixes.**
  - Bloom smeared HDR infinities into a black frame; a clamp pass now sits before bloom.
  - The grade used a reversed `smoothstep`; fixed, and chromatic aberration is gone.
  - Removed the old night dome and a world-spanning mud plane.
  - Shadow bias added.
  - OutputPass now tone-maps the frame.
- **UI system** (`client/src/ui`):
  - Theme tokens and fonts.
  - `UIState` as the single visibility authority.
  - HUD: thin vitality and stamina lines, a composure ensō, the objective, a duel strip,
    contextual prompts, brush reveals and the top-right figure.
  - Screens: title over the live world, pause, death, character (gear from the inventory,
    stances, techniques, rival journal), and settings bound to real systems.
  - The duel intro and aftermath reveals.
- **Forge.** In-world 3D (`world/Smithy`, `forge/ForgeSession`) with CC0 Quaternius props. Five
  steps: steel, form, fire (timed quench), fittings, finish. Output is a real forged weapon,
  carried and equipped. The old React "Emberhold" overlay is no longer mounted (its code remains
  in `forge/glm`).
- **Combat.**
  - Forged blade mass shapes the swing (`massFactor`, tested).
  - Rivals hold one step out and step in to cut (in-game neutral distance 2.0–2.6 m, was 1.5 m).
  - Footwork in guard is a little quicker.
  - Early duels show the core controls for their first seconds.

## Known gaps (honest)

- **Hands are procedural.** Much better than before, but not photoreal: that needs a scanned
  hand model (a download, not yet approved). The tekko covers most of the forearm for that reason.
- **The new techniques and training have not been hand-played**; the numbers are first guesses
  (constants.ts TRAINING, TECHNIQUE, ATTACKS.kesa_giri).
- **The online duel has never been hand-played by two people**, and never over a real WAN.
  Prediction is verified only with artificial latency.
- **Not deployed.** Dockerfile and fly.toml are written (docs/DEPLOY.md) but the image has not
  been built here (no Docker) and nothing is hosted: that needs the owner's hosting account.
- Accounts have no password reset or email; guests remain per-browser identities.
- The opponent is shown from the latest snapshot, eased, not interpolated on a timeline; cuts
  you see land on them can be up to half a round trip behind the server.
- Faces are sculpted procedurally on top of the low-poly mannequin; the neck below the jaw is
  still the mannequin's, and there is no facial animation.
- Architecture is procedural: no interiors, no doors that open.
- Frame timings are from one machine (Apple Silicon); weaker GPUs are untested.
- The ground normal map's earlier failure (black terrain via the built-in path) was avoided,
  not diagnosed: relief is now applied in world space in the shader.

## Next priorities

1. Keep hand-playing: tune footwork, techniques and training against the feel.
2. Photoreal first-person hands from a scanned CC0 model (needs approval to download).
3. Deploy (docs/DEPLOY.md) and hand-play an online duel between two machines.
