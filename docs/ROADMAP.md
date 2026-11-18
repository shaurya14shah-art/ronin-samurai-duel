# Roadmap

The order follows the actual dependency graph, not the directive's list order. The key
difference: the directive puts multiplayer at phase 14, but networked server authority is
impossible unless combat rules are portable and deterministic from the start. So the **shared
simulation comes first**, and every later combat phase builds on it. Nothing advances on
"code exists"; each step has an exit check.

## Vertical slice (gate before any expansion)

| # | Step | Exit check |
|---|---|---|
| 0 ✅ | Audit, baseline commit, honest docs | `PROJECT_STATE.md` |
| 1 ✅ | **Deterministic duel sim in `shared/combat`.** Attacks, guard lines, parry, footwork, clash, stamina/posture/composure, wounds, stances, draw, standoff, Wind Step | Unit tests per rule. Same inputs give an identical state hash |
| 2 ✅ | **Sim-driven AI** (`shared/combat/ai`). Delayed observation, personalities, habit model, feints, range control | AI-vs-AI soak with no stuck states. Habit test: a rival that sees the same opening exploit it more often |
| 3 ◐ | **Rewire client onto the sim.** Input → `DuelistInput`. Weapon, arms and rival animation driven from sim state. Remove random crits, numbers, XP popups. Fix menu-click attack | Player duels the AI in-browser. Old `CombatSystem` deleted |
| 4 ◐ | **Movement weight.** Fix the overwritten velocity, unify the two footwork systems into the sim's step | Accel/decel tests. Single step path |
| 5 | **Presentation of state.** Breathing and sway from composure, guard line readable on the blade, hit/clash/parry feel in camera and audio (not in time scale). Minimal HUD | Can a tester say why they lost? |
| 6 | **Networked 1v1** on Colyseus. Server runs the sim at 60 Hz, client prediction + reconciliation of the local fighter, interpolated remote fighter, input validation | Two browser tabs duel. Injected 150 ms latency and 5 % loss stay fair. Invalid inputs rejected in tests |
| 7 | **Persistent rival.** Habit model saved across encounters, with encounter-indexed strategy shifts (1 → 5) | Scripted 5-encounter test shows strategy change |
| 8 | **Forest-temple map pass + audio pass** | Silence test, realism test |
| 9 | Slice QA against the quality gates in the directive | Gate review written up in `PROJECT_STATE.md` |

## Parked until the slice passes

Forge minigame (keep, but don't extend), skill tree / XP / levels / schools (to be replaced by
mastery-based progression: decision recorded in `DECISIONS.md`), inventory, 2v2, open world,
world simulation, narrative, weather-driven gameplay.

Status key: ✅ exit check met · ◐ built, exit check not yet met. Step 3 still needs a hand-played
duel. In step 4 the walker has weight, but the two footwork paths aren't unified: Shift-step is
on the walker, Q-step is in the sim.
