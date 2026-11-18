# RŌNIN - Game State Transfer Document

## Project Overview
A first-person, single-player samurai game inspired by Vagabond. Focus on grounded combat, atmosphere, and player mastery over stats. No quests, no floating numbers, minimal diegetic HUD.

**Tech Stack**: TypeScript, Three.js, Vite, WebAudio (procedural), Playwright for browser tests
**Build**: `npm run build` (tsc + vite) - compiles successfully
**Tests**: 103/103 unit tests pass (Terrain, AdaptiveRival, FirstPersonController, Soundscape)
**Browser Gates**: Free-roam journey verified playable

---

## Controls (Current)

| Key/Action | Function | Notes |
|------------|----------|-------|
| **WASD** | Walk | Shift = Run (drains stamina) |
| **Mouse** | Look / Aim | Pointer lock required |
| **Left Click** | Attack | Sword must be drawn (X) |
| **Right Click** | Feint | During windup/commitment |
| **Middle Click** | Ability | Uses selected technique |
| **R** | Committed Strike | Heavy attack, costs composure |
| **T** | Timed Parry | High risk, narrow window |
| **F** (Hold) | Hold Guard | Drains stamina while held |
| **Q** | Footwork Step | Shift+Dir, 1.6m, 0.18s, stamina cost |
| **X** | Draw/Sheath Sword | **Required before any combat** |
| **E** | Cycle Technique / Forge | Technique when drawn, Forge when near |
| **V** | Cycle Stance | 5 stances: High/Middle/Low/Fluid/Empty |
| **Z** | Initiate Standoff | Pre-combat tension mechanic |
| **C** | Use Ability | Same as middle click |
| **K** | Open Skill Tree | |
| **Tab** | Open Inventory | |
| **Alt** | Release Pointer Lock | Pause menu |

**Critical UX Issue**: Sword starts sheathed. Player must press X first. Menu says "CLICK Cut" but doesn't explain this.

---

## Core Systems Implemented

### 1. Combat System (`src/combat/CombatSystem.ts` - 860 lines)
**5-Phase Attack System:**
- `WINDUP` → `COMMITMENT` → `TRAJECTORY` → `IMPACT` → `RECOVERY`
- Plus `PARRYING`, `FEINT_RECOVERY`, `DRAWING`, `SHEATHING`

**7 Attack Trajectories:**
1. OVERHEAD (vertical down)
2. LEFT_DIAGONAL (↘)
3. RIGHT_DIAGONAL (↙)
4. HORIZONTAL_LEFT (←)
5. HORIZONTAL_RIGHT (→)
6. THRUST (straight)
7. LOW_STRIKE (upward from low)

**Key Mechanics:**
- **Committed Strike (R)**: 2.2x damage, 15 composure cost, longer recovery
- **Positional Blocking**: F key hold, drains 6 stamina/sec, breaks on stamina depletion
- **Timed Parry (T)**: 0.15s window, deflects with riposte opportunity
- **Feint (Right Click)**: Cancel windup → feint recovery → new attack
- **Footwork (Q)**: 4-direction step, 0.7s cooldown, 18 stamina, collides with targets
- **Distance/Ma-Ai**: 4 phases (too_far >3m, ideal 1.5-3m, danger 1-1.5m, close <1m)
- **Blade Clash**: Deflect/Bind/Redirect/Overpower outcomes based on momentum
- **Composure System**: Separate from stamina, governs parry/feint/ability costs
- **Breathing**: Visual/audio feedback based on exertion
- **Opponent Reading**: Tracks enemy patterns, predicts next move
- **Wounds**: Arm/leg/torso/weapon degradation (reduces speed, damage, stamina)

### 2. Sword Physics (`src/combat/SwordPhysics.ts`)
- **3 Blade Segments**: Base (0.2m), Edge (0.45m), Tip (0.3m) = 0.95m total
- **Physical Simulation**: Velocity, acceleration, angular velocity per segment
- **Hit Detection**: Segment-based with different damage multipliers (Tip 1.5x, Edge 1.0x, Base 0.6x)
- **Clash Physics**: Momentum transfer, bind state, redirect vectors

### 3. Weapon Model (`src/combat/WeaponModel.ts`)
- Procedural katana geometry with metallurgy variations
- Attachment to camera for first-person view
- Windup/swing/impact/recovery animations via procedural rotation

### 4. Collision System (`src/combat/CollisionSystem.ts`)
- Raycast + sphere sweep for attack detection
- Target interface for dummies, rivals, enemies
- Damage application with wound location tracking

### 5. World Scene (`src/world/WorldScene.ts` - 844 lines)
- **Terrain**: Seeded noise heightfield, chunk streaming (courtyard r<12 flat, blend 12-20, rolling beyond)
- **5 Landmarks**: Shrine+bell, Tea-house, Rice terraces, Battlefield memorial, Bridge+path
- **Structures**: Imperfect placement, weathered materials, contextual details
- **Atmosphere**: 40-min day/night cycle, 4 weather states, living world (travelers, monks, birds, smoke)
- **Audio**: Full WebAudio soundscape (wind, rain, footsteps, steel, bell, breathing, wildlife)
- **Free Roam**: 5 roaming rivals with memory/temperament, localStorage saves, bell interaction

### 6. Player Systems
- **FirstPersonController**: Grounded movement, no jump, step bobbing, breath sway
- **PlayerStats**: Stamina + Composure dual resource, wound states, exhaustion/panic
- **PlayerHUD**: Bars-only (no numbers), posture/composure/stance indicators
- **SkillTreeSystem**: 3 branches (Body/Mind/Blade), school-exclusive techniques
- **SwordSchools**: 5 schools (Shinto/Ryu/Kage/Yagyu/Niten), reputation-gated, stat modifiers

### 7. AI - AdaptiveRival (`src/world/AdaptiveRival.ts`)
- **3 Temperaments**: Patient (waits), Pressing (aggressive), Countering (reactive)
- **Habit Learning**: Tracks player trajectory frequency, adapts defense
- **Memory**: Remembers defeats, adjusts aggression
- **Stance System**: AI uses same 5 stances as player

---

## Known Issues / Realism Problems

### Controls UX
1. **Sword starts sheathed** - No visual indicator, menu doesn't explain X to draw
2. **No tutorial/prompts** - Player discovers controls by accident
3. **E key conflict** - Cycle technique vs Forge interaction

### Combat Feel (Realism)
1. **No weight/momentum feel** - Sword moves instantly to target rotation
2. **Footwork slides** - No proper stepping animation, camera teleports
3. **No impact pause** - Hits don't freeze frame, no screenshake
4. **Floaty movement** - No acceleration curves, instant velocity changes
5. **No blade presence** - Sword doesn't collide with environment
6. **Parry/block feedback weak** - Just audio, no visual hit pause
7. **Enemy AI predictable** - Habit learning exists but behavior feels robotic

### Technical Debt
1. **InputSystem not fully utilized** - Some events fired but not all consumed
2. **CombatSystem.update() doesn't read input directly** - Relies on event callbacks
3. **No attack queuing/buffering** - Rapid clicks lost during recovery
4. **Fixed timestep in tick() but variable dt in update()** - Inconsistent simulation

---

## Files to Modify for Realism Fixes

### High Priority
1. `src/combat/CombatSystem.ts` - Attack initiation, weight, impact feedback
2. `src/combat/SwordPhysics.ts` - Blade segment physics, collision with world
3. `src/combat/WeaponModel.ts` - Procedural animation curves, follow-through
4. `src/player/FirstPersonController.ts` - Acceleration curves, step animation, camera shake
5. `src/world/WorldScene.ts` - Draw prompt, control hints

### Medium Priority
6. `src/combat/CollisionSystem.ts` - Hit pause, better hit detection
7. `src/world/AdaptiveRival.ts` - More human-like behavior, feint reading
8. `src/audio/Soundscape.ts` - Impact sounds based on velocity/material

---

## Next Steps for Realism

### 1. Sword Weight & Momentum
- Add angular acceleration to sword movement (not instant rotation)
- Implement follow-through physics after impact
- Blade should resist direction changes during swing

### 2. Grounded Footwork
- Replace instant camera displacement with animated step
- Add IK foot placement preview
- Step should commit - can't cancel mid-step

### 3. Impact Feedback
- Hit pause (10-30ms time dilation on hit)
- Camera shake proportional to impact force
- Blade visual feedback (spark, bend, vibration)

### 4. Environmental Collision
- Sword collides with walls/ground - stops swing, causes stumble
- Blade binds on parry - physical push-back

### 5. Visual Polish
- Draw/sheath animation with hand IK
- Stance transitions animated
- Breathing affects aim sway
- Wound limping animation

### 6. Control Clarity
- Show "X to draw" prompt when sword sheathed
- Contextual control hints (hold F to guard, tap T to parry)
- Stance/technique indicator always visible

---

## Architecture Notes

**Event Flow:**
```
InputSystem (DOM events) → emits custom events
    → CombatSystem listens via inputSystem.on()
    → WorldScene.update() calls combatSystem.update(dt)
    → CombatSystem.tick() simulates fixed timestep
```

**State Persistence:**
- `JourneySave.ts` - localStorage with position, time, skills, weapons, rival memories
- Auto-save every 15s + on pagehide/visibilitychange

**Debug Access:**
```js
window.__RONIN_DEBUG__.scene  // WorldScene instance
scene.combatSystem  // CombatSystem
scene.playerStats   // PlayerStats
scene.firstPersonController  // FirstPersonController
```

---

## Test Commands

```bash
# Build
npm run build

# Unit tests (via esbuild + node)
node --input-type=module -e 'import { build } from "esbuild"; for (const t of ["src/world/Terrain.test.ts","src/world/AdaptiveRival.test.ts","src/player/FirstPersonController.test.ts","src/audio/Soundscape.test.ts"]) { await build({entryPoints:[t],bundle:true,platform:"node",format:"esm",outfile:"/tmp/test."+t.split("/").pop().replace(".ts",".mjs")}); }' && node --test /tmp/test/*.test.mjs

# Dev server
npm run dev
```

---

## Design Philosophy (from MASTER GAME DEVELOPMENT DIRECTIVE)

1. **Mastery Over Stats** - Player skill > character stats
2. **Consequence Over Convenience** - No quick saves, no fast travel, death matters
3. **Atmosphere Over Content** - World feels alive without quests
4. **Readability Over Complexity** - Visual tells > hidden numbers
5. **Tension Over Power Fantasy** - Every fight can kill you
6. **Originality Over Imitation** - Vagabond themes, not Vagabond content

---

## Transfer Notes for Next Session

**Immediate Fixes Needed:**
1. Auto-draw sword on first attack attempt OR show prominent "Press X to draw" prompt
2. Add attack input buffering (queue next attack during recovery)
3. Fix footwork - animate step instead of teleport
4. Add hit pause on successful hit/parry
5. Make sword movement use acceleration curves

**Realism Polish:**
1. Blade-environment collision
2. Proper step animation with IK
3. Camera shake/hit pause
4. Weighted sword animation (anticipation, follow-through)
5. AI that reads feints and adapts in real-time

**The game is playable but feels like a prototype. The systems exist but lack the "juice" that makes combat feel real.**