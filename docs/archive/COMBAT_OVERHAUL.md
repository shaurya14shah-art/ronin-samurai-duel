# Combat Overhaul Roadmap

## Vision
Transform the combat from a "damage-first" system to a "read→position→commit→consequence" system where player skill matters more than stats. Every action must have intention, preparation, commitment, consequence, and recovery.

## Phase 1: Core Combat Systems (Weeks 1-3)

### 1.1 Physical Sword System
**File**: `src/combat/SwordPhysics.ts` (new)
- Blade segmented into 3 regions: TIP (0.7-1.0), EDGE (0.3-0.7), BASE (0.0-0.3)
- Each segment has different damage multiplier, stability, clash behavior
- Blade velocity and angular velocity tracked per frame
- Collision uses swept capsule per segment, not single segment
- Impact force = mass × velocity × segment multiplier
- Tip: high reach, low stability, low damage
- Edge: sweet spot, max damage, max stability
- Base: low reach, high stability, parry/deflect bonus

### 1.2 Directional Attack System (7 Trajectories)
**Modify**: `src/combat/CombatSystem.ts`, `src/combat/WeaponModel.ts`
- OVERHEAD: Vertical downward, high posture damage
- LEFT_DIAGONAL: High-to-left, good vs right-side guard
- RIGHT_DIAGONAL: High-to-right, good vs left-side guard
- HORIZONTAL_LEFT: Mid-level left-to-right, wide arc
- HORIZONTAL_RIGHT: Mid-level right-to-left, wide arc
- THRUST: Straight forward, max reach, min arc
- LOW_STRIKE: Low upward, trips/legs, hard to parry high

**Input Mapping**:
- Mouse movement during windup influences trajectory
- WASD + attack = committed directional bias
- Stance modifies available trajectories

### 1.3 Five-Phase Attack System
**Modify**: `src/combat/CombatSystem.ts`
```
WINDUP (0.2-0.5s)     → Readable, feintable, stance visible
COMMITMENT (0.05-0.1s) → Point of no return, blade accelerates
TRAJECTORY (0.1-0.2s)  → Blade follows arc, collision active
IMPACT (0.05-0.1s)     → Hit resolution, clash detection
RECOVERY (0.3-0.8s)    → Vulnerable, cannot act, stance reset
```
- Each phase has distinct visual/audio tells
- Windup: readable by opponent, feint window
- Commitment: blade velocity peaks, cannot cancel
- Trajectory: blade follows physics arc, collision continuous
- Impact: hit resolution, blade clash, damage application
- Recovery: vulnerable, composure penalty if missed

### 1.4 Committed Strike (replaces Heavy Attack)
**Modify**: `src/combat/CombatSystem.ts`
- Key: R (hold) or R + direction
- 2.5x stamina cost, 2x windup, 3x recovery
- Cannot feint after commitment
- Posture damage 3x normal
- Guard break chance on block
- Miss = massive vulnerability (2s recovery)

### 1.5 Positional Blocking System
**Modify**: `src/combat/CombatSystem.ts`, `src/combat/CollisionSystem.ts`
- Block effectiveness = dot(block_direction, attack_direction) × stance_modifier
- Perfect block (dot > 0.9): 0 stamina cost, attacker staggered
- Good block (dot > 0.7): 25% stamina cost, 50% damage
- Poor block (dot > 0.4): 75% stamina cost, 75% damage
- Failed block (dot < 0.4): full damage, guard break
- Blade angle matters: edge-on = best, flat = worst

### 1.6 High-Risk Parry System
**Modify**: `src/combat/CombatSystem.ts`
- Window: 0.08s (0.12s with parry_master)
- Must be within 30° of attack direction
- Success: attacker fully staggered (1.5s), counter window 0.5s
- Failure: full damage + 0.5s additional recovery
- Parry consumes 20 stamina + 10 composure
- Visual/audio tell: blade flash, metallic ring

## Phase 2: Movement & Distance (Weeks 3-4)

### 2.1 Footwork System (replaces Dodge)
**Modify**: `src/player/FirstPersonController.ts`, `src/combat/CombatSystem.ts`
- Remove teleport step (Q)
- Add directional footwork:
  - Sidestep (A/D + Q): 0.8m lateral, 0.3s, 10 stamina
  - Retreat (S + Q): 1.2m backward, 0.4s, 12 stamina
  - Forward step (W + Q): 0.6m forward, 0.25s, 15 stamina
  - Pivot (mouse + Q): rotate in place, 8 stamina
- All footwork: grounded, physics-based, interruptible
- Footwork during recovery = 50% distance, 2x cost
- Stance affects footwork: High = slower, Low = faster

### 2.2 Distance / Ma-Ai System
**New**: `src/combat/DistanceSystem.ts`
- TOO_FAR (>3m): No attacks reach, only footwork/approach
- IDEAL (1.5-3m): Full attack options, max control
- DANGER (1-1.5m): Opponent can reach, committed strikes risky
- CLOSE (<1m): Only thrust/low/short strikes, grappling possible
- Visual tells: blade overlap, footstep audio, breathing volume
- HUD: subtle distance indicator (optional, diegetic)

## Phase 3: Advanced Combat Mechanics (Weeks 4-6)

### 3.1 Blade Clash System
**Modify**: `src/combat/CollisionSystem.ts`
- When two attack segments intersect during trajectory:
  - Calculate: angle, relative velocity, stamina, posture
  - Outcomes:
    - Clean deflection (angle > 45°): both stagger 0.3s
    - Blade bind (angle < 15°): push contest, stamina drain
    - Redirect (angle 15-45°): weaker attack deflected, attacker vulnerable
    - Overpower (stamina diff > 30): weaker fully staggered
  - Audio/visual: spark, metallic ring, screen micro-shake

### 3.2 Composure System (Separate from Stamina)
**Modify**: `src/player/PlayerStats.ts`
- Physical Stamina: attacks, movement, blocking (recovers fast)
- Composure: focus, breathing, hesitation (recovers slow)
- Low composure effects:
  - Attack windup 20% slower
  - Parry window 30% smaller
  - Footwork distance -25%
  - Visual: tunnel vision, hand tremor
  - Audio: heavy breathing, heartbeat
- Composure damage: taking hits, missing attacks, guard break, fear

### 3.3 Breathing System
**New**: `src/audio/BreathingSystem.ts` + integrate with Soundscape
- Breathing rate = f(stamina, composure, exertion, time_since_combat)
- Calm: 8-10 breaths/min, quiet
- Exerted: 20-30 breaths/min, audible
- Panic: 40+ breaths/min, ragged, loud
- Opponent breathing audible at <4m (stereo positioned)
- Inhale/exhale affects aim sway slightly

### 3.4 Opponent Reading System
**New**: `src/combat/OpponentReader.ts`
- Tracks per opponent:
  - Preferred trajectories (7-bin histogram)
  - Preferred range (mean/std)
  - Defensive tendency (parry/block/evade ratio)
  - Reaction time (mean/std)
  - Feint frequency
  - Combo patterns (n-gram of last 5 actions)
  - Stance preferences
- UI: subtle hints after 3+ encounters (diegetic: "He favors the left")
- Data persists across encounters for persistent rivals

### 3.5 Adaptive AI with Habit Learning
**Modify**: `src/world/AdaptiveRival.ts`
- Long-term memory per player (persisted):
  - Encounter count, wins/losses
  - Learned counters to player's top 3 patterns
  - Strategic adjustments per encounter
- Short-term adaptation (within fight):
  - Reaction delay decreases with repeated patterns
  - Feint usage increases vs predictable players
  - Range control adapts to player's preferred distance
- Personality temperaments preserved but evolved

### 3.6 Feint System
**Modify**: `src/combat/CombatSystem.ts`, `src/combat/WeaponModel.ts`
- Feint: start windup → cancel → different attack
- Cost: 15 stamina + 5 composure
- Window: only during first 60% of windup
- Visual tell: subtle hesitation, blade wobble
- Feint → same direction: faster windup (0.8x)
- Feint → opposite direction: slower windup (1.2x)
- Overuse penalty: AI learns, parry window increases vs feints

## Phase 4: Stance & Technique Systems (Weeks 6-8)

### 4.1 Stance System (5 Stances)
**New**: `src/combat/StanceSystem.ts`
| Stance | Guard | Trajectories | Footwork | Stamina | Openings |
|--------|-------|--------------|----------|---------|----------|
| HIGH (Jodan) | Overhead | Overhead, Diagonals | Slow, committed | +20% | Low guard |
| MIDDLE (Chudan) | Center | All 7 | Balanced | Base | Balanced |
| LOW (Gedan) | Low | Thrust, Low, Horizontal | Fast, evasive | -15% | High guard |
| FLUID (Nagare) | Shifting | All, faster transitions | Fast, flowing | +10% | Momentary |
| EMPTY (Mu) | None | Read-only, counter-only | Fastest | -25% | No guard |

- Stance change: 0.5s transition, 10 stamina
- Stance affects: available trajectories, footwork, parry/block angles, recovery
- Stance visible to opponent (blade position, body posture)

### 4.2 Grounded Special Techniques
**Modify**: `src/combat/CombatSystem.ts`, `src/player/SkillTreeSystem.ts`
- WIND_STEP → **PASSING STEP**: Rapid advance + thrust, requires ideal range, 30 stamina, 0.4s recovery, punishable if predicted
- BLOOD_PRICE → **COMMITTED HEART**: Sacrifice 40 composure for unblockable committed strike, 0.8s recovery, leaves open
- EMPTY_GROUND → **VOID STEP**: Instant sidestep + counter-thrust, 0.1s window, 25 stamina, no damage if mistimed

### 4.3 Sword Drawing System
**New**: `src/combat/SwordDrawSystem.ts`
- Sword starts sheathed (X to draw)
- Draw types:
  - Standard: 0.8s, safe
  - Iaijutsu (quick-draw): 0.3s, 25 stamina, first-strike bonus
  - Controlled: 1.2s, stance transition during draw
- Sheathe: 0.6s, recovers 10 composure
- Drawn sword: stance visible, composure drain over time
- Sheathed: faster movement, no attacks, hidden intent

### 4.4 Standoff System
**New**: `src/combat/StandoffSystem.ts`
- Triggered when two opponents face each other at IDEAL range, no recent combat
- State: time_dilation (1.2x), audio_muted (except wind/breathing/footsteps)
- Visual: subtle vignette, opponent highlight
- First strike advantage: +50% posture damage, -50% recovery if landed
- Standoff breaks on: attack, footwork >2m, sheathing, turning away

### 4.5 First Strike System
**Integrate**: `src/combat/StandoffSystem.ts`, `src/combat/CombatSystem.ts`
- Opening exchange: first attacker gains initiative
- Perfect first strike (parried/blocked): attacker recovers 0.5s faster
- Missed first strike: attacker recovery 2x, defender gets free counter
- Encourages patience and reading

## Phase 5: Consequences & Feedback (Weeks 8-10)

### 5.1 Wound Consequences
**New**: `src/combat/WoundSystem.ts`
- Arm: -30% attack speed, -20% damage, +20% windup
- Leg: -40% footwork distance, -30% move speed, stance limited
- Torso: -50% composure regen, +50% composure damage taken
- Weapon: -30% clash stability, blade wobble, occasional drop
- Visual: subtle animation changes, no gore
- Recovery: time-based (30-120s) or sheathing + rest

### 5.2 Remove Floating Damage Numbers
**Modify**: `src/combat/CollisionSystem.ts`, `src/world/WorldScene.ts`
- Remove combatFeedback text events for damage
- Communicate through:
  - Animation (stagger, flinch, recoil)
  - Audio (impact tone, breath, grunt)
  - Visual (blood mist, blade flash, screen pulse)
  - HUD: subtle bar changes only

### 5.3 Minimal HUD
**Modify**: `src/player/PlayerHUD.ts`
- Remove health/stamina/composure bars
- Replace with:
  - Breathing sound (always)
  - Visual: posture (stance), hand tremor (composure), screen edges (health)
  - Diegetic: sword position = stance, blade glow = technique ready
- Optional accessibility: toggle bars on

### 5.4 First-Person Immersion
**Modify**: `src/player/FirstPersonController.ts`, `src/combat/WeaponModel.ts`
- Visible hands/arms with IK
- Sword held naturally, not glued to camera
- Breathing moves camera subtly
- Attack momentum moves camera
- Impact recoil (controlled)
- Stance changes camera height/FOV slightly
- Footstep camera bob (diegetic)

## Phase 6: World & Progression (Weeks 10-12)

### 6.1 Sword Schools
**New**: `src/progression/SwordSchools.ts`
| School | Philosophy | Stances | Techniques |
|--------|------------|---------|------------|
| Still Water | Patience, counter | Low, Empty | Void Step, Perfect Parry |
| Wind | Mobility, pressure | High, Fluid | Passing Step, Flow |
| Iron | Discipline, defense | Middle, High | Committed Heart, Iron Step |
| Empty | Adaptation | All, fast switch | Empty Mind, Adaptation |
| Falling Leaf | Evasion, redirect | Low, Fluid | Second Wind, Echo |

- Join school: unlocks school stances/techniques
- Leave school: lose access, reputation hit
- School reputation affects NPC encounters

### 6.2 Progression = Knowledge
**Modify**: `src/player/SkillTreeSystem.ts`
- XP unlocks techniques/stances, not stats
- Stat growth minimal (10% over entire game)
- Mastery: using technique 50x = mastery (faster, less stamina)
- Reputation: honorable/aggressive/merciless/disciplined
- Affects: NPC dialogue, encounter types, school access

### 6.3 Persistent Rivals
**Modify**: `src/world/AdaptiveRival.ts`, `src/world/JourneySave.ts`
- 5 named rivals with personalities
- Memory across encounters (saved in JourneySave)
- Rival evolves: learns, changes school, gains allies
- Defeat/spare choice affects world state
- Rival can appear in world, not just duels

## Phase 7: Multiplayer Foundation (Weeks 12-16)

### 7.1 Network Architecture
**New**: `src/network/*`
- Server-authoritative combat
- Client prediction + reconciliation
- Rollback netcode for combat (GGPO-style)
- State: positions, stances, attack phases, stamina, composure
- Latency compensation: rewind/resimulate

### 7.2 Duel Matchmaking
- 1v1 ranked/casual
- 2v2 team duels
- Standoff → duel → aftermath flow
- Replay system for analysis

### 7.3 Persistent World
- Shared world with other players
- Encounter naturally
- Form schools/clans
- Territory control (philosophical, not territorial)

## Phase 8: Polish & Vertical Slice (Weeks 16-20)

### 8.1 Vertical Slice Checklist
- [ ] One map: Bamboo forest + shrine
- [ ] Two players networked
- [ ] Two original characters
- [ ] One katana, fully functional
- [ ] Core combat: movement, stance, attack, block, parry, footwork, dodge, blade clash, stamina, composure, posture, recovery
- [ ] One adaptive AI rival
- [ ] One grounded special technique
- [ ] Full audio atmosphere
- [ ] Minimal UI
- [ ] Complete duel loop

### 8.2 Quality Gates
- Sword feels physical ✓
- Movement has weight ✓
- Distance matters ✓
- Timing matters ✓
- Stamina matters ✓
- Composure matters ✓
- Missing attack matters ✓
- Blocking has consequences ✓
- Parrying feels risky ✓
- Players can read each other ✓
- AI adapts ✓
- Environment feels alive ✓
- World feels believable ✓
- Audio communicates ✓
- Multiplayer synchronized ✓
- Combat satisfying without flashy effects ✓
- Looks good without post-processing ✓

## Implementation Priority Order

1. **SwordPhysics.ts** - Foundation for all combat
2. **CombatSystem overhaul** - 5 phases, 7 trajectories, committed strike
3. **Positional blocking/parry** - Core defensive depth
4. **Footwork + Distance system** - Movement depth
5. **Blade clash** - Sword interaction
6. **Composure + Breathing** - Resource depth
6. **OpponentReader + Adaptive AI** - Intelligence
7. **Feint system** - Psychological depth
8. **Stance system** - Strategic variety
9. **Special techniques** - Mastery expression
10. **Sword draw + Standoff + First Strike** - Duel ceremony
11. **Wound system** - Consequences
11. **Minimal HUD + Immersion** - Presentation
12. **Sword schools + Progression** - Long-term depth
13. **Multiplayer architecture** - Core promise
14. **Vertical slice integration** - Delivery

## Technical Debt to Address

- Integrate Rapier3D for physics (currently unused)
- Move collision to fixed timestep (120Hz)
- Separate simulation from rendering
- Add rollback networking framework
- Profile and optimize instanced rendering
- Add LOD system for terrain/vegetation
- Implement asset streaming for open world

## Testing Strategy

- Unit tests: SwordPhysics, DistanceSystem, OpponentReader
- Integration: CombatSystem full duels (headless)
- Visual regression: screenshot comparison
- Network: latency simulation (50-200ms)
- AI: behavior verification across 100 duels
- Accessibility: colorblind, motion reduction, remapping

---

*This roadmap is a living document. Update as implementation reveals new constraints.*