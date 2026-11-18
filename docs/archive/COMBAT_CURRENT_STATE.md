# Current Combat System State

## Overview
The current combat system is a first-person sword-fighting prototype built with Three.js and TypeScript. It features a state machine-based combat system with directional attacks, parry/block mechanics, stamina management, and an adaptive AI rival.

## Current Mechanics

### Combat State Machine
- **IDLE**: Waiting for player input
- **WINDUP**: Attack preparation (0.24s light, 0.44s heavy)
- **COMMITMENT**: Attack committed, cannot cancel (0.08s light, 0.12s heavy)
- **IMPACT**: Hit detection active (0.16s)
- **RECOVERY**: Post-attack vulnerability (0.3s light, 0.5s heavy)
- **PARRYING**: Defensive state (0.3s parry, held for block)

### Attack System
- **Light Attack (Left Click)**: 14 stamina, 1x damage multiplier
- **Heavy Attack (R)**: 28 stamina, 1.75x damage multiplier
- **Directional Attacks**: 4 directions based on movement + mouse input
  - OVERHEAD (backward/mouse up)
  - LEFT (leftward/mouse left)
  - RIGHT (rightward/mouse right)
  - THRUST (forward)
- **Feint (Right Click)**: Cancel during windup, 0.18s recovery
- **Special Abilities (E + C)**: 3 techniques unlocked via skill tree
  - WIND_STEP: Advancing thrust (1.35x multiplier)
  - BLOOD_PRICE: Committed cut (2x multiplier, costs 30 composure)
  - EMPTY_GROUND: Clearing cut (1x multiplier)

### Defensive System
- **Parry (T)**: 10 stamina, 0.18s window (0.25s with parry_master)
  - Requires facing attacker (58° cone)
  - Successful parry: 0.12s recovery, attacker staggered
- **Block (Hold F)**: 4 stamina to enter, 6 stamina/s held
  - Reduces damage by 75% if facing
  - Guard break at 0 stamina: 0.85s recovery, 25 composure damage
- **Step/Dodge (Q)**: 18 stamina, 0.85m max distance, 0.75s cooldown
  - Directional based on movement keys

### Stamina System
- Base: 100 stamina
- Regeneration: 5/s base + 0.5 per endurance
- Composure affects regen rate (20% at 0 composure)
- Actions cost stamina, fail if insufficient

### Composure System
- Base: 100 composure
- Reduced by taking damage, blocking poorly
- Affects stamina costs (up to 50% more at 0 composure)
- Affects stamina regen (20% at 0 composure)

### Weapon System
- Procedural sword generation via forge
- Blade length affects reach
- Visual mesh attached to camera
- Animation states: IDLE, WINDUP, SWINGING, RECOVERING, PARRYING
- 4 attack directions with distinct animations

### Collision System
- Swept segment collision (previous + current frame)
- 7 temporal samples per frame for continuous detection
- Single hit per target per swing
- Target interface: takeDamage, getHitBox, claimDefeatReward, tryDeflect, onParried
- Blade clash detection via tryDeflect during commitment phase

### AI Rival (AdaptiveRival)
- 3 temperaments: Patient, Pressing, Countering
- Phases: idle, approach, circle, windup, commitment, impact, recovery, evade, staggered, dead
- Intent system: waiting, standoff, observe, probe, circle, retreat, rest, return, cut, feint, recover
- Observation system with reaction delay (0.22-0.3s)
- Stamina/fatigue management
- Feint attacks (cancel during windup)
- Blade clash deflection during commitment
- Memory of player patterns (5-action history)
- Leash system (8m from spawn)

### Input System
- Mouse look with sensitivity
- WASD movement
- Pointer lock for camera control
- Key press/release tracking with hold duration

### Current Limitations
1. **Sword Physics**: No blade segment physics, tip/edge/base differentiation
2. **Attack Trajectories**: Only 4 directions, no low strikes or horizontal variants
3. **Attack Phases**: Missing distinct TRAJECTORY phase between commitment and impact
4. **Heavy Attack**: Just a damage multiplier, not a true committed strike
5. **Blocking**: Binary facing check, no blade angle consideration
6. **Parry**: Generous window, no risk/reward depth
7. **Dodging**: Teleport-style step, not grounded footwork
8. **Distance**: No ma-ai system, no distinct combat ranges
9. **Blade Clash**: Only during commitment, simple deflection
10. **Composure**: Only affects stamina, no behavioral changes
11. **Breathing**: Visual only, no audio feedback
12. **Opponent Reading**: Limited to 5-action history, no deep pattern recognition
13. **AI Adaptation**: Short-term only, no long-term learning across encounters
14. **Feints**: Only during windup, no feint-to-attack transitions
15. **Stances**: None implemented
16. **Special Techniques**: Still feel magical (wind_step, blood_price, empty_ground)
17. **Sword Drawing**: Not implemented (sword always drawn)
18. **Standoff**: Not implemented
19. **First Strike**: Not implemented
20. **Wounds**: No localized consequences
21. **Damage Numbers**: Combat feedback via text events
22. **HUD**: Health/stamina/composure bars visible
23. **First-Person Body**: No hands/arms visible
24. **Multiplayer**: Not implemented (Colyseus scaffold only)

### Architecture
- **Engine**: Three.js + TypeScript + Vite
- **Physics**: Custom swept collision (no Rapier integration yet)
- **Networking**: Colyseus scaffold (server/client/shared workspaces)
- **State Management**: Class-based, single-player authoritative
- **Rendering**: Forward rendering with PCF shadows
- **Audio**: Howler.js + procedural WebAudio (Soundscape)

## Files
- `src/combat/CombatSystem.ts` - Main combat logic (348 lines)
- `src/combat/WeaponModel.ts` - Sword visuals and animation (218 lines)
- `src/combat/CollisionSystem.ts` - Hit detection (147 lines)
- `src/world/AdaptiveRival.ts` - AI opponent (629 lines)
- `src/player/FirstPersonController.ts` - Movement and camera (181 lines)
- `src/player/PlayerStats.ts` - Stats, stamina, composure, XP
- `src/world/WorldScene.ts` - Main game scene (830 lines)
- `src/audio/Soundscape.ts` - Procedural audio
- `src/forge/*` - Weapon forging system
- `src/inventory/*` - Inventory management
- `src/player/SkillTreeSystem.ts` - Skill progression