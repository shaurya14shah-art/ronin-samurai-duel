# Performance

Budget (CLAUDE.md): 16.6 ms per frame at 1080p on desktop; sim < 0.5 ms for a 2-fighter duel.

## Sim (Node, `npx tsx --tsconfig client/tsconfig.json tools/bench-sim.ts`)

| What | Cost |
|---|---|
| Duel step, 2 fighters, mixed inputs | **1.2 µs** |
| Client prediction: input + reconcile with ~15 unacked ticks | **0.04 ms** (runs ~30×/s) |

The sim is far inside its budget.

## Frame (`node tools/bench-frame.mjs`, 1920×1080, headless Chromium, ANGLE/Metal, Apple Silicon)

Median of 120 frames after warm-up; render time includes `gl.finish()`.

| Place | World update | Render | Draw calls | Triangles |
|---|---|---|---|---|
| Courtyard | 0.3 ms | 10–13 ms | ~355–740 | 1.0–1.9 M |
| Bamboo grove | 0.2 ms | ~15 ms | ~590 | 1.8 M |
| Shrine approach | 0.2 ms | ~12 ms | ~640 | 1.8 M |
| Hamlet | 0.3 ms | ~13 ms | ~500 | 1.5 M |
| Bridge | 0.2 ms | ~11.5 ms | ~500 | 1.6 M |

**These GPU numbers are noisy.** The same scene measured 2.5 ms and 13.7 ms in one run with
nothing relevant changed, and p95 often doubles the median. Treat them as rough, and confirm
in a real browser before tuning further.

Steps taken this session, each removing work rather than relying on a timing:
- Static batching (`batchStatic` in `world/Architecture.ts`): Structures went from 557 meshes
  to a few per place. Draw calls roughly halved.
- Bamboo split into one instanced set per clump, so clumps out of view are culled.
- Bamboo culms: fewer rings and sides (~45% fewer triangles).
- The shadow map is refreshed at 30 Hz (every other frame) instead of every frame. It was
  consistently the largest single cost when it could be isolated.

The biggest remaining triangle source is the instanced grass (~320 k).

## Real browser (`node tools/bench-real.mjs`: visible Chromium, 1920×1080, DPR 1, Apple Silicon)

Uses the in-game bench (`?bench`), which records the real animation-frame loop.

| Place | Frame (median / p95) | CPU per frame | Frames over 25 ms |
|---|---|---|---|
| Courtyard | 16.7 / 17.6 ms | 3.4 ms | 0% |
| Bamboo grove | 16.8 / 19.2 ms | 3.7 ms | 0% |
| Shrine approach | 16.7 / 17.6 ms | 3.8 ms | 0% |
| Hamlet | 16.7 / 17.7 ms | 3.6 ms | 0% |
| Bridge | 16.7 / 17.4 ms | 3.4 ms | 0% |

Frames are vsync-locked at 60 Hz, so the median shows the cap, not the headroom. The grove ran
17.5 / 21 ms until bamboo leaf cards stopped casting shadows (culms still do). The GPU timer
query is exposed but its readings on ANGLE/Metal are not trustworthy (they exceed the frame
interval), so they are not used. A second tab running the game in the background halves the
frame rate: close other game tabs when measuring.
