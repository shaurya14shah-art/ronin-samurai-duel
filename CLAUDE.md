# RŌNIN: Project Constitution

An original first-person sword-duel game. Its tone takes inspiration from grounded,
philosophical swordsmanship stories. It reproduces no manga characters, scenes, dialogue or
designs. Central rule: **player skill > character stats.**

Read first: `docs/PROJECT_STATE.md` (what's true now), then `docs/ROADMAP.md`.
`docs/archive/` and `GEMINI.md` are older and overstate what works.

## Toolchain

- npm workspaces: `shared/` (pure TS), `client/` (Vite 6, Three 0.170, no framework),
  `server/` (Colyseus 0.16, Express).
- Tests run on the Node test runner via tsx.

```bash
npm test                         # all client + shared tests
npm run test:sim                 # sim + AI tests only
npm run dev:client               # Vite (default port 3000)
npm run dev:server               # Colyseus on 2567
npx tsc --noEmit -p client       # typecheck (clean)
npm run build                    # shared + client + server
```

## Architecture rules

1. **Combat rules live only in `shared/src/combat`.** Deterministic, fixed 60 Hz tick,
   inputs in, events out. No DOM, no Three, no `Math.random`, no wall clock.
2. Client, server and AI all drive fighters through `DuelistInput`. The AI sees opponents
   only through delayed observation.
3. Presentation (animation, camera, audio, HUD) reacts to sim **events and state**. It never
   decides outcomes, and it never slows the sim (no hit-pause in rules).
4. The server is authoritative for damage, hits, results and progression. Clients send inputs,
   never outcomes.
5. No floating numbers and no MMO HUD. Composure is never a bar.
6. Never fake a system. If something is incomplete, say so in `PROJECT_STATE.md`.

## Coding standards

- Match surrounding style (4-space TS in client, 2-space in server).
- Every new rule gets a test that would fail without it.
- Hash-based or table-driven generation: verify the output distribution by counting it, not by
  reading the branches.
- Keep files focused. `WorldScene.ts` is a god object to be
  split, not extended.

## Performance budget (desktop, 1080p)

16.6 ms frame. Sim < 0.5 ms for a 2-fighter duel. Measure before optimising; record numbers in
`docs/PERFORMANCE.md` when it exists.

## Directory map

- `shared/src/combat/`: the rules (`constants.ts` is every tuning number), the AI (`ai.ts`), tests
- `client/src/duel/`: everything that connects the sim to the browser game
- `client/src/world/`: terrain, structures, atmosphere, saves; `WorldScene.ts` wires it all
- `client/src/forge/`: the in-world forge session; blade length and mass reach combat
- `docs/`: design and state. Keep `PROJECT_STATE.md` honest at the end of every session

## Status

Roadmap steps 0–2 done; 3–4 and online 1v1 built but awaiting hand-played duels. See `docs/PROJECT_STATE.md`.
