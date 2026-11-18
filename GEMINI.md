# RONIN — Project Memory

## What Is This?
RONIN is a Vagabond-inspired first-person 3D multiplayer samurai combat game.
Built with Three.js + Rapier 3D + Colyseus + Howler.js + TypeScript + Vite.

## Architecture
Monorepo with npm workspaces:
- `shared/` — Pure TypeScript: types, simulation, physics, combat math (no DOM)
- `client/` — Three.js renderer, 3D scenes, interactions, UI, audio (Vite dev server, port 3000)
- `server/` — Colyseus game server, Express, room logic (port 2567)

## Key Systems

### Forge System (weapon creation)
- Physics-driven material properties (density, hardness, elasticity, grain structure)
- Interactive forging: smelting → hammering → shaping → quenching → grinding → handle assembly
- Procedural weapon mesh from control point deformation
- Combat stats derived from physical properties — no RPG stat sheets
- Every weapon is unique based on player actions during forging

### Combat System (planned)
- Stance-based: high guard, middle guard, low guard, fluid, empty
- First-person sword control with directional attacks
- Parry/deflect/block timing system
- Stamina and recovery management
- Opponent reading (pattern recognition)

### Multiplayer (planned)
- Server-authoritative via Colyseus
- 1v1 duels, 2v2, free roam
- Client prediction + server reconciliation

## Rules
- NEVER create fake/placeholder systems that pretend to work
- All simulation code in shared/ must be deterministic
- Server is authoritative for all game state
- Combat stats emerge from physics, not arbitrary numbers
- UI must be minimal and atmospheric — no MMO HUD
- Test before claiming something works

## Commands
```bash
npm run dev          # Start both client and server
npm run dev:client   # Client only (port 3000)
npm run dev:server   # Server only (port 2567)
npm run test         # All tests
npm run test:forge   # Forge system tests
```
