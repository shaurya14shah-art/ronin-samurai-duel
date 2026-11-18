// Helpers for sim tests: two fighters facing each other along the z axis.
import { Duel } from './duel.js';
import type { DuelEvent, DuelistInput } from './types.js';
import type { DuelistOptions } from './duelist.js';

export const A = 'a';
export const B = 'b';

/** A at the origin facing +z, B at `distance` facing back toward A. */
export function face(distance: number, a: DuelistOptions = {}, b: DuelistOptions = {}): Duel {
  const duel = new Duel();
  duel.add(A, { x: 0, z: 0 }, 0, a);
  duel.add(B, { x: 0, z: distance }, Math.PI, b);
  return duel;
}

export type Script = (tick: number, duel: Duel) => Partial<Record<string, Partial<DuelistInput>>>;

/** Run `ticks` steps. Fighters keep facing their opponent and holding nothing unless scripted. */
export function run(duel: Duel, ticks: number, script: Script = () => ({})): DuelEvent[] {
  const all: DuelEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const s = script(i, duel);
    const inputs: Record<string, DuelistInput> = {};
    for (const f of duel.fighters) {
      const other = duel.fighters.find(o => o !== f)!;
      const facing = Math.atan2(other.pos.x - f.pos.x, other.pos.z - f.pos.z);
      inputs[f.id] = { move: { x: 0, z: 0 }, facing, guard: false, ...(s[f.id] ?? {}) };
    }
    all.push(...duel.step(inputs));
  }
  return all;
}

export const ticks = (seconds: number) => Math.round(seconds * 60);
export const of = (events: DuelEvent[], type: DuelEvent['type']) => events.filter(e => e.type === type);
