import { Client, type Room } from 'colyseus.js';
import type { DuelistInput, NetSnapshot } from '@ronin/combat';

// The client end of a server-authoritative duel. It sends stamped intent and receives the
// server's state; it never decides an outcome. Prediction of our own fighter lives in the
// shared `Predictor` (driven by DuelDirector). A dropped connection is rejoined automatically
// while the server holds the seat (20 s).

// Where the game server is: VITE_RONIN_SERVER if set at build time; the Vite dev server (port
// 3000) talks to :2567 on the same host; otherwise the page was served by the game server
// itself, so it is the page's own origin (wss on https).
const HTTP_URL: string = (() => {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RONIN_SERVER;
    if (env) return env.replace(/\/$/, '');
    if (typeof location === 'undefined') return 'http://localhost:2567';
    if (location.port === '3000') return `${location.protocol}//${location.hostname}:2567`;
    return location.origin;
})();
export const SERVER_URL = HTTP_URL.replace(/^http/, 'ws');

/** Dev aid: `?lag=150` adds 150 ms each way, to feel and test prediction on a local server. */
const LAG_MS = (() => {
    if (typeof location === 'undefined') return 0;
    const v = Number(new URLSearchParams(location.search).get('lag'));
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1000) : 0;
})();
const later = (fn: () => void) => (LAG_MS ? window.setTimeout(fn, LAG_MS) : fn());

/**
 * This browser's identity on the server: a random UUID it made itself. It only lets the server
 * keep your record between visits; it is not an account and is never shown to other players.
 */
const ID_KEY = 'ronin.identity.v1';
export function myIdentity(): string {
    try {
        let id = localStorage.getItem(ID_KEY);
        if (!id) { id = crypto.randomUUID(); localStorage.setItem(ID_KEY, id); }
        return id;
    } catch { return crypto.randomUUID(); }
}

export interface DuelRecord { wins: number; losses: number }
export interface Session { token: string; account: { id: string; name: string } }

// ── Accounts ───────────────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'ronin.session.v1';

export function currentSession(): Session | null {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
        return s && typeof s.token === 'string' && s.account?.name ? s : null;
    } catch { return null; }
}

function storeSession(s: Session | null): void {
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

async function authCall(path: string, body: unknown, token?: string): Promise<{ account: Session['account']; token?: string; record?: DuelRecord }> {
    const res = await fetch(`${HTTP_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

/** Create an account; signs in on success. */
export async function register(name: string, password: string): Promise<{ session: Session; record: DuelRecord | null }> {
    const r = await authCall('/auth/register', { name, password });
    const session = { token: r.token!, account: r.account };
    storeSession(session);
    return { session, record: r.record ?? null };
}

export async function signIn(name: string, password: string): Promise<{ session: Session; record: DuelRecord | null }> {
    const r = await authCall('/auth/login', { name, password });
    const session = { token: r.token!, account: r.account };
    storeSession(session);
    return { session, record: r.record ?? null };
}

/** Check the stored session with the server; forgets it if it has expired. */
export async function checkSession(): Promise<{ session: Session; record: DuelRecord | null } | null> {
    const s = currentSession();
    if (!s) return null;
    try {
        const r = await authCall('/auth/me', undefined, s.token);
        return { session: s, record: r.record ?? null };
    } catch (e) {
        if (/signed in|401/i.test(String((e as Error).message))) storeSession(null);
        throw e;
    }
}

export async function signOut(): Promise<void> {
    const s = currentSession();
    storeSession(null);
    if (s) await authCall('/auth/logout', {}, s.token).catch(() => {});
}
export interface OpenDuel { code: string; host: string; record: DuelRecord | null; verified: boolean }
export type Connection = 'live' | 'reconnecting' | 'lost';

export class NetDuel {
    you = '';
    names: Record<string, string> = {};
    records: Record<string, DuelRecord> = {};
    /** Fighter id → whether that name is a signed-in account (otherwise a guest). */
    verified: Record<string, boolean> = {};
    latest: NetSnapshot | null = null;
    pingMs = 0;
    connection: Connection = 'live';
    onSnap: (s: NetSnapshot) => void = () => {};
    onResult: (r: { winner: string | null; loser: string; round: number }) => void = () => {};
    onJoined: (id: string, name: string) => void = () => {};
    onLeft: (id: string) => void = () => {};
    onConnection: (c: Connection) => void = () => {};
    private pingTimer = 0;
    private leaving = false;

    private constructor(public room: Room, private client: Client) {
        this.attach(room);
        this.pingTimer = window.setInterval(() => { const t = performance.now(); later(() => { try { this.room.send('ping', { t }); } catch { /* reconnecting */ } }); }, 1000);
    }

    /** The code a friend uses to join this duel. */
    get code(): string { return this.room.roomId; }

    private attach(room: Room): void {
        this.room = room;
        room.onMessage('welcome', (m: { you: string; names: Record<string, string>; records?: Record<string, DuelRecord>; verified?: Record<string, boolean> }) => {
            this.you = m.you; this.names = m.names; this.records = m.records ?? {}; this.verified = m.verified ?? {};
        });
        room.onMessage('snap', (s: NetSnapshot) => later(() => { this.latest = s; this.names = s.names; this.onSnap(s); }));
        room.onMessage('result', (r: { winner: string | null; loser: string; round: number; records?: Record<string, DuelRecord> }) => {
            if (r.records) this.records = r.records;
            this.onResult(r);
        });
        room.onMessage('joined', (m: { id: string; name: string; record?: DuelRecord; verified?: boolean }) => {
            this.names[m.id] = m.name;
            this.verified[m.id] = !!m.verified;
            if (m.record) this.records[m.id] = m.record;
            this.onJoined(m.id, m.name);
        });
        room.onMessage('left', (m: { id: string }) => { delete this.names[m.id]; delete this.records[m.id]; this.onLeft(m.id); });
        room.onMessage('pong', (m: { t: number }) => later(() => { this.pingMs = Math.round(performance.now() - m.t); }));
        room.onLeave(() => { if (!this.leaving) void this.rejoin(); });
        room.send('ping', { t: performance.now() });
    }

    /** The server keeps our seat for 20 s after a drop; try to take it back within that. */
    private async rejoin(): Promise<void> {
        const token = this.room.reconnectionToken;
        this.setConnection('reconnecting');
        for (let attempt = 0; attempt < 9 && !this.leaving; attempt++) {
            await new Promise(r => setTimeout(r, 1000 + attempt * 500));
            try {
                const room = await this.client.reconnect(token);
                if (this.leaving) { void room.leave(true).catch(() => {}); return; }
                this.attach(room);
                this.setConnection('live');
                return;
            } catch { /* not yet */ }
        }
        if (!this.leaving) this.setConnection('lost');
    }

    private setConnection(c: Connection): void {
        this.connection = c;
        this.onConnection(c);
    }

    /** Join options: signed in, the account plays; otherwise a guest with this browser's identity. */
    private static options(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
        const s = currentSession();
        return { name, identity: myIdentity(), ...(s ? { token: s.token } : {}), ...extra };
    }

    static async quick(name: string): Promise<NetDuel> {
        const client = new Client(SERVER_URL);
        return NetDuel.ready(await client.joinOrCreate('duel', NetDuel.options(name)), client);
    }

    static async host(name: string): Promise<NetDuel> {
        const client = new Client(SERVER_URL);
        return NetDuel.ready(await client.create('duel', NetDuel.options(name, { private: true })), client);
    }

    static async join(code: string, name: string): Promise<NetDuel> {
        const client = new Client(SERVER_URL);
        return NetDuel.ready(await client.joinById(code.trim(), NetDuel.options(name)), client);
    }

    /** Public duels with one fighter waiting. */
    static async openDuels(): Promise<OpenDuel[]> {
        const res = await fetch(`${HTTP_URL}/duels`);
        if (!res.ok) throw new Error(`server answered ${res.status}`);
        return res.json();
    }

    private static async ready(room: Room, client: Client): Promise<NetDuel> {
        const net = new NetDuel(room, client);
        // Wait for the seat assignment.
        for (let i = 0; i < 50 && !net.you; i++) await new Promise(r => setTimeout(r, 20));
        if (!net.you) throw new Error('The server did not seat us.');
        return net;
    }

    get opponentId(): string | null {
        return Object.keys(this.names).find(id => id !== this.you) ?? null;
    }

    send(input: DuelistInput & { seq: number }): void {
        later(() => { try { this.room.send('input', input); } catch { /* reconnecting */ } });
    }

    leave(): void {
        this.leaving = true;
        window.clearInterval(this.pingTimer);
        void this.room.leave(true).catch(() => {});
    }
}

export function formatRecord(r: DuelRecord | null | undefined): string {
    return r ? `${r.wins}–${r.losses}` : '';
}
