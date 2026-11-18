# Decisions

## D1. Combat rules move into a deterministic shared simulation (2026-10-02)
**Context:** Combat lives in client classes coupled to Three.js, the DOM, `window` events and
`Math.random`. The player and the AI resolve attacks by different code paths. The server
can't run any of it.
**Decision:** All combat rules go in `shared/src/combat`. They are pure TypeScript with a fixed
60 Hz tick, take inputs and emit events, and use no randomness. The client, server and AI all
use it.
**Consequence:** The legacy `CombatSystem`/`CollisionSystem`/`SwordPhysics` get replaced, not
patched. Hit-pause can no longer slow the rules; impact feel moves to presentation.

## D2. 2.5D combat space (2026-10-02)
**Decision:** The sim models fighters as discs with facing. Attacks are timed angular sweeps
plus a line (high/left/right/center/low). The 3D blade is rendered from sim state.
**Why:** It captures distance, angle, line and timing, which is what decides a real exchange.
It's cheap, robust and networkable. Full 3D blade rigid bodies would add nondeterminism and
latency sensitivity for little readable gain. Revisit only if testers can't read outcomes.

## D3. No randomness in combat outcomes (2026-10-02)
**Decision:** Remove the crit rolls and random wound rolls. Seeded randomness is allowed only in
AI *decision-making*, and only through an injected seeded PRNG.

## D4. Stat progression is parked (2026-10-02)
**Decision:** XP, levels, stat-granting server actions and stat-modifying schools are frozen and
will be removed from combat math. Progression will be mastery (techniques learned by doing,
rival knowledge, reputation), designed after the slice.
**Status:** Superseded by D5 (the old system was removed in session 3).

## D5. Progression is physical training, bounded (2026-10-03)
**Decision:** At the player's request, progression returns as *The Way*: physical only.
Conditioning (strength, endurance, defence, footwork) and blade proficiency (long, short), three
ranks each, worth about a tenth at most per branch; techniques that are body movements
(passing step, kesa-giri, void step, maki-otoshi, iai), learned with insight and mastered by
landing them. Insight comes from duels won. No levels, no XP from hits, nothing magical.
**Why:** The archived plan (progression = knowledge, stat growth ≤ 10%, mastery by use) and the
player's ask for physical moves and sword types. Player skill still decides duels.
**Online:** no conditioning, every technique open to both fighters: only skill decides.
