import { Room, Client } from '@colyseus/core';
import { Records, identity } from '../records.js';
import { Accounts, type Account } from '../accounts.js';
import { ALL_TECHNIQUES, Duel, DT, InputBuffer, type DuelEvent, type DuelistInput, type NetSnapshot } from '../../../shared/src/combat/index.js';

// A 1v1 duel, authoritative on the server. The shared deterministic sim runs here at 60 Hz;
// clients send intent only (validated by InputBuffer/sanitizeInput) and receive the
// authoritative state ~30 times a second, with the last input applied for each (for prediction). Hits, damage, deaths and rounds are decided here.
//
// Messages
//   client → server  'input'  DuelistInput-shaped object (untrusted) + seq, one per sim tick
//                    'ping'   { t }   → server replies 'pong' { t }
//   server → client  'welcome' { you, names, records }   'snap' NetSnapshot
//                    'result' { winner, loser, round, records }   'left' { id }   'joined' { id, name, record }
//
// Join options: { name, token?, identity?, private? }. With a session `token` the fighter plays
// as that account: its name, its record. Without one, a guest: the name they typed (never an
// account's), and a record kept against `identity`, the browser's own random UUID, which the
// server never shares. A token that is not valid refuses the join rather than playing as a guest.

/** Records survive restarts in data/records.json under the server's working directory (RONIN_RECORDS overrides; "" disables). */
export const records = new Records(process.env.RONIN_RECORDS ?? 'data/records.json');
/** Player accounts (data/accounts.json; RONIN_ACCOUNTS overrides, "" keeps them in memory). */
export const accounts = new Accounts(process.env.RONIN_ACCOUNTS ?? 'data/accounts.json');
setInterval(() => { records.flush(); accounts.flush(); }, 5000).unref();

const SPAWNS = [{ x: 0, z: -16.5, facing: Math.PI }, { x: 0, z: -23.5, facing: 0 }];
const ROUND_PAUSE = 4;
/** Online, only skill decides: every technique known, no conditioning, the standard blade. */
const ONLINE_BODY = { drawn: false, training: { known: ALL_TECHNIQUES } };

export class DuelRoom extends Room {
  maxClients = 2;
  private duel = new Duel();
  private inputs = new Map<string, InputBuffer>();
  private slotOf = new Map<string, string>(); // sessionId → fighter id
  private names: Record<string, string> = {};
  private identities: Record<string, string | null> = {};
  private events: DuelEvent[] = [];
  private round = 1;
  private pause = 0;
  private time = 0;
  private sinceSnap = 0;

  onCreate(options: { private?: boolean } = {}) {
    if (options.private) this.setPrivate(true);
    this.setSimulationInterval(() => this.tick(), 1000 / 60);
    this.onMessage('input', (client, raw) => {
      const id = this.slotOf.get(client.sessionId);
      if (!id) return;
      this.inputs.get(id)?.push(raw, this.time);
    });
    this.onMessage('ping', (client, msg) => client.send('pong', { t: typeof msg?.t === 'number' ? msg.t : 0 }));
  }

  /** Fighter id → { wins, losses } as the server has recorded them. */
  private recordsView() {
    const out: Record<string, { wins: number; losses: number }> = {};
    for (const id of Object.keys(this.names)) out[id] = records.get(this.identities[id]);
    return out;
  }

  /** What the open-duel list shows: who is waiting, and their record. */
  private updateListing(): void {
    const [id] = Object.keys(this.names);
    void this.setMetadata({ host: id ? this.names[id] : '', record: id ? records.get(this.identities[id]) : null, verified: id ? this.verified[id] : false });
  }

  onAuth(_client: Client, options: { token?: unknown } = {}): Account | true {
    if (options.token === undefined) return true;
    const account = accounts.verify(options.token);
    if (!account) throw new Error('Your session has expired. Sign in again.');
    return account;
  }

  /** Fighter id → whether the name belongs to a signed-in account. */
  private verified: Record<string, boolean> = {};

  onJoin(client: Client, options: { name?: unknown; identity?: unknown } = {}, auth?: Account | true) {
    const taken = new Set(this.slotOf.values());
    const id = ['p0', 'p1'].find(x => !taken.has(x))!;
    const spawn = SPAWNS[id === 'p0' ? 0 : 1];
    const account = auth && auth !== true ? auth : null;
    let name = account ? account.name : typeof options.name === 'string' ? options.name.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 24) || 'Wanderer' : 'Wanderer';
    if (!account && accounts.nameTaken(name)) name = `${name.slice(0, 16)} (guest)`;
    this.slotOf.set(client.sessionId, id);
    this.names[id] = name;
    this.verified[id] = !!account;
    this.identities[id] = account ? `acct:${account.id}` : identity(options.identity);
    if (!this.duel.get(id)) this.duel.add(id, { x: spawn.x, z: spawn.z }, spawn.facing, ONLINE_BODY);
    this.inputs.set(id, new InputBuffer(spawn.facing));
    client.send('welcome', { you: id, names: this.names, records: this.recordsView(), verified: this.verified });
    this.broadcast('joined', { id, name, record: records.get(this.identities[id]), verified: !!account }, { except: client });
    if (this.clients.length === 2) this.lock();
    this.updateListing();
  }

  async onLeave(client: Client, consented: boolean) {
    const id = this.slotOf.get(client.sessionId);
    if (!id) return;
    if (!consented) {
      try {
        // Brief disconnects keep the fighter where they stood.
        await this.allowReconnection(client, 20);
        return;
      } catch { /* gave up */ }
    }
    this.slotOf.delete(client.sessionId);
    this.inputs.delete(id);
    this.duel.remove(id);
    delete this.names[id];
    delete this.identities[id];
    delete this.verified[id];
    this.broadcast('left', { id });
    this.unlock();
    this.updateListing();
  }

  private tick(): void {
    this.time += DT;
    const inputs: Record<string, ReturnType<InputBuffer['take']>> = {};
    for (const [id, buf] of this.inputs) inputs[id] = buf.take();
    // Until both are present, nobody can be cut.
    if (this.duel.fighters.length === 2 && this.pause <= 0) {
      const ev = this.duel.step(inputs);
      this.events.push(...ev);
      const dead = ev.find(e => e.type === 'death');
      if (dead) {
        const winner = dead.b ?? null;
        records.result(winner ? this.identities[winner] ?? null : null, this.identities[dead.a] ?? null);
        this.broadcast('result', { winner, loser: dead.a, round: this.round, records: this.recordsView() });
        this.pause = ROUND_PAUSE;
      }
    } else if (this.pause > 0) {
      this.duel.step(inputs);
      this.pause -= DT;
      if (this.pause <= 0) this.newRound();
    } else {
      this.duel.step(inputs);
    }
    this.sinceSnap += DT;
    if (this.sinceSnap >= 1 / 30) {
      this.sinceSnap = 0;
      const acks: Record<string, number> = {}, held: Record<string, DuelistInput> = {};
      for (const [id, buf] of this.inputs) { acks[id] = buf.ack; held[id] = buf.heldInput; }
      const snap: NetSnapshot = { state: this.duel.snapshot(), events: this.events, round: this.round, names: this.names, acks, held };
      this.broadcast('snap', snap);
      this.events = [];
    }
  }

  private newRound(): void {
    this.round++;
    for (const f of [...this.duel.fighters]) {
      const spawn = SPAWNS[f.id === 'p0' ? 0 : 1];
      this.duel.remove(f.id);
      this.duel.add(f.id, { x: spawn.x, z: spawn.z }, spawn.facing, ONLINE_BODY);
      this.inputs.get(f.id)?.reset(spawn.facing);
    }
    this.duel.firstStrikeAvailable = true;
  }
}
