# Changelog

## 2026-10-03: Session 3
- The title always stands in clear evening light, whatever the saved weather.
- Photo mode: free camera, lens, light and weather controls, depth of field, PNG capture.
- World map: painted from the terrain; discovery, rival records, your mark, zoom and pan.
- Online 1v1: `DuelRoom` runs the shared sim on the server; clients send validated intent only.
  Multiplayer screen with quick match, private code and join. Removed the trusting `WorldRoom`.
- Online: client prediction and reconciliation, open-duel list, server-kept records per browser
  identity, reconnect. Removed `ForgeRoom`.
- World: procedural architecture kit; rebuilt courtyard, shrine, hamlet, bridge, battlefield,
  paddies; real bamboo; terrain paths; colliders; walkable bridge; world-space ground relief.
- Characters: sculpted faces. Straw training targets. Primitive pilgrims removed.
- Journal tab. Stat progression removed. ~10k lines of dead code and React removed.
- Performance: static batching, per-clump bamboo, 30 Hz shadow refresh; `docs/PERFORMANCE.md`.
- Accounts (scrypt, hashed sessions, lockout); production single-process build, Dockerfile,
  fly.toml, DEPLOY.md; in-game frame bench; playtest bot.
- From the first hand-play: W/S fixed, dash fixed and lengthened; sculpted hands under tekko;
  katana rebuilt from its anatomy.
- The Way: physical training, five techniques, sword types in the forge; rivals trained.

## 2026-10-03: Session 2
- Visuals, Mesh2Motion characters, UI system, 3D forge, combat feel (see `PROJECT_STATE.md`).

## 2026-10-02: Session 1
- Audit. Put the project under git (baseline commit). Wrote `CLAUDE.md` and the docs set.
- Added the deterministic duel sim in `shared/src/combat` with 20 rule tests.
- Added the sim-driven AI: delayed perception, five personalities, persistent habit memory.
  4 tests, including a 25-pairing soak.
- Moved the client onto the sim (`client/src/duel/`). Removed the legacy combat stack, random
  crits, damage numbers and the HUD clutter.
- Fixes: walker acceleration, menu click → swing, forge type errors breaking `npm run build`.
