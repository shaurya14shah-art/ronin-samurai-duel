# Architecture

## Current (end of session 1)

```
shared/src/combat/      Deterministic duel sim + AI (see "Target", now implemented)
client/src/duel/
  DuelDirector.ts       One Duel for the world: player, rivals, dummies. Fixed 60 Hz accumulator,
                        engagement/standoff, sim↔walker position ownership, events → audio/camera
  PlayerIntent.ts       Mouse/keys → DuelistInput (gesture-directed cuts, guard line by flick)
  PlayerSword.ts        First-person WeaponModel driven by the player's sim phase
  RivalFigure.ts        Rival body/blade posed from sim state
client/src/world/WorldScene.ts  Still the world god object (terrain, props, audio, saves, UI glue),
                        but no combat logic
client/src/net/NetDuel.ts  Colyseus client for one online duel: stamped intent, snapshots, reconnect
shared/src/combat/net.ts   sanitizeInput, InputBuffer (ordered, acked), Predictor (client prediction)
server/src/rooms/DuelRoom.ts  Authoritative 1v1: shared sim at 60 Hz, snapshots + acks at 30 Hz
server/src/records.ts      Win/loss per browser identity, persisted to data/records.json
client/src/world/Architecture.ts  Procedural timber/stone kit + batchStatic
client/src/characters/Face.ts     Sculpted head attached to the mannequin's head bone
```

The client imports the sim through the `@ronin/combat` alias (`client/vite.config.ts`,
`client/tsconfig.json` paths). Tests run with `--tsconfig client/tsconfig.json` so the alias resolves.

## Target (implemented: sim, AI, authoritative server, client prediction)

```
shared/src/combat/     PURE, deterministic, fixed 60 Hz tick, no DOM/Three/random
  types.ts             Vec2, DuelistInput, DuelistState, events
  constants.ts         All tuning in one place (timings, costs, ranges)
  attacks.ts           Attack definitions per direction (timeline, arc, reach, posture)
  duelist.ts           Per-fighter state machine: stance, guard, footwork, attack phases,
                       stamina / composure / posture
  resolve.ts           Blade-vs-body and blade-vs-blade resolution from geometry + timing
  duel.ts              N-fighter world step: apply inputs → advance → resolve → events
  rng.ts               Seeded PRNG for AI only (rules themselves are random-free)

server/   Runs shared/combat authoritatively. Validates input rates and ranges.
          Snapshots state at 30 Hz.
client/   Samples input → DuelistInput. Predicts the local fighter with the same shared code,
          reconciles on snapshot. Renders: body, blade, camera, audio react to EVENTS, never
          to rule internals.
client AI Produces DuelistInput, exactly like a human. It sees the opponent only through
          delayed observations. The same sim judges it.
```

Rules of the target architecture:

1. **One rulebook.** Player, AI and remote players all go through `shared/combat`. Nothing in
   `client/` decides whether a hit landed.
2. **Inputs in, events out.** The sim consumes `DuelistInput` per tick and emits typed events
   (`swing_start`, `clash`, `parry`, `hit`, `whiff`, `guard_break` …). Audio, animation and camera
   subscribe to events.
3. **Deterministic.** Same inputs, same outputs. No `Math.random`, no wall-clock in rules. This is
   what makes reconciliation, replays and AI-vs-AI regression tests possible.
4. **Hit-pause is presentation.** Slowing the rules for juice breaks networking. Impact feel is
   done in the camera, weapon and audio layers.
5. **2.5D combat space.** Fighters are discs on the ground plane with a facing. Attacks are swept
   arcs in that plane, plus a height band (high/mid/low) for line and guard matching. That is
   enough to model distance, angle, line and timing believably. It's far cheaper and more robust
   to network than full 3D rigid-body blades. The visible 3D blade is driven *from* the sim
   state, not the other way round.
