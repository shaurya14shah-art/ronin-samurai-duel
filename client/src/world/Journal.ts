// The journal: a log of what actually happened on the road, written as it happens (places
// reached, swordsmen met, duels won and lost, blades forged, online duels). Nothing is
// generated after the fact; each entry is added by the event it describes.

export type JournalKind = 'place' | 'rival' | 'duel' | 'fall' | 'forge' | 'online' | 'train';

export interface JournalEntry {
    /** Wall-clock time (ms) the entry was written. */
    t: number;
    kind: JournalKind;
    text: string;
}

export interface JournalStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const KEY = 'ronin.journal.v1';
export const JOURNAL_LIMIT = 300;

export class Journal {
    private list: JournalEntry[];

    constructor(private storage: JournalStorage | null = typeof localStorage !== 'undefined' ? localStorage : null, private now: () => number = () => Date.now()) {
        let loaded: unknown = [];
        try { loaded = JSON.parse(storage?.getItem(KEY) ?? '[]'); } catch { /* corrupt or blocked: start fresh */ }
        this.list = Array.isArray(loaded) ? loaded.filter(isEntry) : [];
    }

    /** Write an entry. The same text within a minute is one event, not two. */
    add(kind: JournalKind, text: string): void {
        const t = this.now();
        const last = this.list[this.list.length - 1];
        if (last && last.text === text && t - last.t < 60_000) return;
        this.list.push({ t, kind, text });
        if (this.list.length > JOURNAL_LIMIT) this.list.splice(0, this.list.length - JOURNAL_LIMIT);
        try { this.storage?.setItem(KEY, JSON.stringify(this.list)); } catch { /* private mode: kept for this session */ }
    }

    /** Newest first. */
    entries(): JournalEntry[] {
        return [...this.list].reverse();
    }

    clear(): void {
        this.list = [];
        try { this.storage?.setItem(KEY, '[]'); } catch { /* ignore */ }
    }
}

function isEntry(e: unknown): e is JournalEntry {
    const x = e as JournalEntry;
    return !!x && typeof x.t === 'number' && typeof x.text === 'string' && ['place', 'rival', 'duel', 'fall', 'forge', 'online', 'train'].includes(x.kind);
}
