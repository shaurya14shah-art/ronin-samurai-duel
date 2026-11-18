import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Duel records kept by the server. There are no accounts: each browser holds a random identity
// (a UUID it generated) and the server counts the wins and losses it judged for that identity.
// Only the server writes a record, and only from a death it resolved itself. Identities are
// never sent to other players.

export interface Record { wins: number; losses: number }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client-supplied identity if it is a well-formed UUID, otherwise null (an anonymous duel). */
export function identity(raw: unknown): string | null {
  return typeof raw === 'string' && ID.test(raw) ? raw.toLowerCase() : null;
}

export class Records {
  private data: { [id: string]: Record } = {};
  private dirty = false;

  constructor(private file: string | null) {
    if (!file) return;
    try { this.data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ }
  }

  get(id: string | null): Record {
    const r = id ? this.data[id] : undefined;
    return { wins: r?.wins ?? 0, losses: r?.losses ?? 0 };
  }

  /** One judged result. Anonymous sides are not recorded; nobody can win against themselves. */
  result(winner: string | null, loser: string | null): void {
    if (winner && winner === loser) return;
    if (winner) (this.data[winner] ??= { wins: 0, losses: 0 }).wins++;
    if (loser) (this.data[loser] ??= { wins: 0, losses: 0 }).losses++;
    this.dirty = this.dirty || !!(winner || loser);
  }

  /** Write to disk if anything changed (atomic rename). */
  flush(): void {
    if (!this.file || !this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    renameSync(this.file + '.tmp', this.file);
    this.dirty = false;
  }
}
