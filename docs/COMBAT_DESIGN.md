# Combat Design

Status markers: **[sim]** = implemented in `shared/src/combat` and covered by tests ·
**[planned]** = designed, not built. The legacy client `CombatSystem` is being replaced. It is
not the reference for any rule below.

## Principles

- The loop is OBSERVE → POSITION → READ → COMMIT → STRIKE → RECOVER → ADAPT.
- Every outcome follows from **geometry and timing**: where the blade is, how far, from which
  line, at which moment. The rules use **no randomness**. If a player loses, the reason exists
  in the state and could be shown in a replay.
- No invulnerability frames. You evade by **leaving the arc**.
- Nothing is free. Every attack, step, parry and block spends something.

## Space

Fighters are discs (r = 0.28 m) on the ground plane with a facing angle. An attack is a sweep
in that plane plus a **line** (high / left / right / center / low) that decides which guard
meets it. Reach = arm (0.55 m) + blade (0.95 m by default) + any lunge.

Which part of the blade arrives is **[sim]**, read from distance:

| Contact point along blade | Result |
|---|---|
| tip third (monouchi) | clean cut: full damage |
| middle | solid: 70 % damage, more posture |
| base / hands (too close) | jammed: 25 % damage, posture only |
| beyond the tip | whiff |

So the ranges (too far / ideal / danger / close) are **not tuned constants or UI labels**. They
fall out of reach. Stepping in too deep is as bad as standing too far.

## Attack timeline **[sim]**

`WINDUP → (commit point) → ACTIVE → RECOVERY`

- Before the commit point the attack can be **feinted**. After it, the direction is locked and
  **turn rate is capped** (1.2 rad/s in windup, 0.6 rad/s while active), so a committed cut can't
  track a sidestep.
- **ACTIVE** sweeps the arc over time. The defender is hit on the tick the sweep crosses them,
  so a wide horizontal arrives at your flank later than at your centre.
- **RECOVERY** is longer after a whiff (×1.35) than after contact.

| Attack | Line | Windup | Active | Recovery | Arc | Reach bonus | Character |
|---|---|---|---|---|---|---|---|
| overhead | high | 0.40 | 0.12 | 0.46 | ±12° | 0 | strongest posture damage, narrow, slow |
| diagonal L / R | right / left (defender's side) | 0.33 | 0.14 | 0.40 | 75° | 0 | the honest workhorse |
| horizontal L / R | right / left | 0.30 | 0.16 | 0.42 | 110° | +0.05 | hard to sidestep, weak vs guard |
| thrust | center | 0.27 | 0.10 | 0.52 | ±6° | +0.30 | longest, fastest, trivially sidestepped, punishable |
| low | low | 0.32 | 0.14 | 0.44 | 70° | −0.10 | attacks legs (mobility wound) |

**Committed strike (R) [sim]:** windup ×1.55, recovery ×1.5, damage ×1.4, posture ×1.8, force ×1.6.
It costs 26 stamina instead of 12. The commit point comes at 70 % of windup instead of 55 %.
A committed whiff also costs composure. The question it poses is "should I commit?", not
"is it off cooldown?".

## The blade itself **[sim]**

What you forge matters. Blade length sets reach. Blade mass, relative to an ordinary 1.1 kg
katana, scales the swing: heavier blades take longer to wind up and recover (up to ×1.3) and land
with more force in clashes and blocks (up to ×1.3). Lighter blades work the other way, down to
×0.85. The bounds keep a forge choice shaping the fight without deciding it (`massFactor`).

## Distance as the AI holds it **[sim]**

Rivals hold one step outside their own reach (reach + ~0.4 m) and **step in to cut**. The cut is
requested during the step and buffered by the sim. The step-in is the readable moment you
answer with a step back, a guard or a parry. Seen openings within a step are punished the same way.

## Defence

**Guard (hold F) [sim].** The guard has a line, set by the direction of your last mouse flick
while guarding: center by default, or high / left / right / low. Guard line vs incoming line
gives the block quality:

|        | high | left | right | center | low |
|---|---|---|---|---|---|
| **center guard** | 0.5 | 0.5 | 0.5 | 1 | 0 |
| **high guard**   | 1 | 0.5 | 0.5 | 0.5 | 0 |
| **left guard**   | 0.5 | 1 | 0 | 0.5 | 0.5 |
| **right guard**  | 0.5 | 0 | 1 | 0.5 | 0.5 |
| **low guard**    | 0 | 0.5 | 0.5 | 0.5 | 1 |

- Quality 1: stamina and posture cost only.
- 0.5: the block holds but costs double and **displaces the blade** (a short "rattled" state:
  you can't attack for 0.25 s).
- 0: you are hit.
- Anything from outside ±75° of your facing gets through.
- Holding guard drains 2 stamina/s and stops stamina regeneration.
- Posture full → **guard break**: stagger 0.9 s.

**Parry (T) [sim].** A 0.13 s window (scaled by composure and stance) that opens 0.03 s after the
press. It needs the attacker within ±50° of facing, but no line. Then:

- Perfect: the attacker is **deflected**. They take heavy posture damage, are staggered 0.6 s,
  and lose composure. The parrier recovers in 0.15 s, which is enough time for a counter.
- Late, within 0.10 s after the window: treated as a poor-quality block.
- Whiffed parry (nothing arrived): a 0.45 s recovery with no guard. **That is the risk.**

**Footwork (Q / Space + direction) [sim].** A 0.22 s dash: forward 1.3 m, back 1.6 m, side 1.0 m (a sidestep beats a committed thrust, not a horizontal cut). Outside a duel the same keys dash 2.4 m.
It costs 10 stamina, and each step within 1.2 s of the previous one costs ×1.5 (no step-spam).
You can't step during windup after the commit point or during active.

## Blade against blade **[sim]**

When both fighters are ACTIVE with overlapping reach and roughly facing each other (dot > 0.4),
the blades meet. Force = attack base force × committed × stamina factor
(0.7 below 15 stamina) × stance factor.

- Forces within 20 %: **mutual deflection**. Both are knocked back into a short recovery and the
  exchange resets.
- Otherwise: the weaker blade is **displaced**. That fighter gets a 0.45 s stagger plus posture
  damage, and the stronger attack continues.

An attack that lands while the defender is still in WINDUP **interrupts** it, which beats them
to the strike.

## Resources **[sim]**

- **Stamina (0–100).** Regen 16/s after a 0.8 s delay, scaled by composure. Below 15 everything
  is slower (windups ×1.15) and clash force drops.
- **Posture (0–100).** Fills from blocks, parried strikes, lost clashes and jammed hits. Drains
  at 14/s once 1 s has passed without new posture damage. Full → broken.
- **Composure (0–1).** Falls when you're hit, parried, guard-broken, whiff a committed strike,
  or chain feints. It returns slowly when you aren't under pressure, and faster on clean hits
  and parries. Low composure lengthens windups (up to +15 %), narrows the parry window (down to
  60 %), slows stamina and posture recovery. **It is never shown as a bar.** The client renders
  it as breathing, weapon sway and audio.
- **Vitality (0–100).** A clean tip cut does 40 (×1.4 committed). About three honest cuts end a
  duel, and one perfect committed cut nearly does.

## Wounds **[sim]** (deterministic, from the line that landed)

- A low line → leg wound: move speed and step distance −15 % per wound.
- A left/right line landing while the defender is in windup/active (arms extended) → arm wound:
  windups +8 %, clash force −10 %.
- Anything else → torso: composure −0.1.
- Wounds stack to 2. They never show as numbers.

## Stances **[sim]** (switch: V, 0.35 s transition, no guard during it)

| Stance | Favours | Costs |
|---|---|---|
| High | overhead/diagonals windup ×0.85, +0.05 reach | thrust/low ×1.3, takes +15 % posture |
| Middle | thrust ×0.9, parry window ×1.1 | none (baseline) |
| Low | low/thrust ×0.85, step distance ×1.1 | overhead ×1.35 |
| Fluid | horizontals ×0.85, step cost ×0.8 | block quality capped at 0.5 |
| Empty | parry window ×1.35, stamina regen ×1.3 | no guard; all windups ×1.1 (the bait stance) |

## Draw / standoff / first strike **[sim]**

- Sheathed fighters can't guard or parry. Drawing takes 0.5 s, sheathing 0.6 s.
- An attack from sheathed is a **draw-cut**: a horizontal with 0.38 s windup that includes the
  draw. It's the standoff weapon.
- A duel starts in **standoff**. The first attack to land clean in a duel deals ×1.3 posture and
  composure damage. That's an advantage, not a kill.

## Techniques **[sim]** (learned in The Way; see DECISIONS D5)

All are body movements; a technique not learned does nothing. Mastery (0–1, from landing it 40
times) makes it up to 12% quicker and 15% cheaper.

- **Passing Step** (`wind_step`, known from the start; 1 then C): a thrust that carries the body
  1.2 m forward during windup. 30 stamina, 0.1 composure. Whiffed, you are deep and slow.
- **Kesa-giri** (needs Strength I; 2 then C): a full-body diagonal. Windup 0.5 s, damage ×1.3,
  posture 34 and ×1.6 against a guard: it breaks guards a diagonal would not. Recovery 0.75 s.
- **Void step** (needs Footwork I; 3 then C, A/D picks the side): a sidestep (1.1× a side step)
  that flows into a thrust with 70% windup. Beats a committed cut, which cannot track it.
- **Maki-otoshi** (needs Defence I; hold F, press T): a binding parry. Window ×0.85; on success
  the attacker takes +35 posture, a 1.6× stagger and has their blade wound out of line.
- **Iai** (needs Endurance I; attack from the scabbard): the draw-cut's windup ×0.65.

## Training **[sim]**

Per rank (0–3): strength +3.5% cut damage, posture and force; endurance +5% stamina regen and
−3% costs; defence −3.5% posture taken; footwork +4% step distance and −5% step cost. Long blade:
−25% of a heavy blade's extra swing time per rank. Short blade: +8% parry window per rank with a
blade under 65 cm. Rivals are trained to their way of fighting and use their techniques.

## What is deliberately not here

No crit rolls, no damage numbers, no XP from hits, no level scaling, no i-frames, no lock-on.
