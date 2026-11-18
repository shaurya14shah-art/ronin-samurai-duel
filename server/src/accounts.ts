import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Player accounts: a name and a password. Passwords are stored only as scrypt hashes with a
// per-account salt; sessions are random tokens of which only a SHA-256 is stored, so a leaked
// accounts file gives neither passwords nor live sessions. Repeated wrong passwords lock the
// name out for a while. Plain JSON on disk: fine for one server, not for a fleet.

export interface Account { id: string; name: string }

interface StoredAccount extends Account { key: string; salt: string; created: number }
interface StoredSession { account: string; expires: number }
interface Data { accounts: Record<string, StoredAccount>; sessions: Record<string, StoredSession> }

export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} '\-]{1,22}[\p{L}\p{N}]$/u;
export const SESSION_DAYS = 30;
const LOCK_AFTER = 5, LOCK_MS = 60_000;

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const derive = (password: string, salt: string) => scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

export class Accounts {
  private data: Data = { accounts: {}, sessions: {} };
  private failures = new Map<string, { count: number; until: number }>();
  private dirty = false;

  constructor(private file: string | null, private now: () => number = () => Date.now()) {
    if (!file) return;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (d && typeof d === 'object') this.data = { accounts: d.accounts ?? {}, sessions: d.sessions ?? {} };
    } catch { /* first run */ }
  }

  /** True if an account already uses this name (a guest may not pass as its owner). */
  nameTaken(name: string): boolean {
    return !!this.byName(name);
  }

  private byName(name: string): StoredAccount | undefined {
    const key = name.toLocaleLowerCase();
    return Object.values(this.data.accounts).find(a => a.name.toLocaleLowerCase() === key);
  }

  private session(id: string): string {
    const token = randomBytes(32).toString('base64url');
    this.data.sessions[hashToken(token)] = { account: id, expires: this.now() + SESSION_DAYS * 86_400_000 };
    this.dirty = true;
    return token;
  }

  register(rawName: unknown, password: unknown): { account: Account; token: string } {
    const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
    if (!NAME_RULE.test(name)) throw new AuthError('Names are 3–24 letters, numbers, spaces, apostrophes or hyphens.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new AuthError('Passwords are 8 to 200 characters.');
    if (this.byName(name)) throw new AuthError('That name is taken.', 409);
    const salt = randomBytes(16).toString('hex');
    const account: StoredAccount = { id: randomUUID(), name, salt, key: derive(password, salt), created: this.now() };
    this.data.accounts[account.id] = account;
    this.dirty = true;
    return { account: { id: account.id, name }, token: this.session(account.id) };
  }

  login(rawName: unknown, password: unknown): { account: Account; token: string } {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const lock = this.failures.get(name.toLocaleLowerCase());
    if (lock && lock.until > this.now()) throw new AuthError('Too many attempts. Wait a minute and try again.', 429);
    const a = this.byName(name);
    // Hash even when the name is unknown, so timing does not reveal which names exist.
    const key = derive(typeof password === 'string' ? password.slice(0, 200) : '', a?.salt ?? 'no-such-account');
    if (!a || !timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(a.key, 'hex'))) {
      const f = this.failures.get(name.toLocaleLowerCase()) ?? { count: 0, until: 0 };
      f.count++;
      if (f.count >= LOCK_AFTER) { f.until = this.now() + LOCK_MS; f.count = 0; }
      this.failures.set(name.toLocaleLowerCase(), f);
      throw new AuthError('Name or password is wrong.', 401);
    }
    this.failures.delete(name.toLocaleLowerCase());
    return { account: { id: a.id, name: a.name }, token: this.session(a.id) };
  }

  /** The account a session token belongs to, or null if unknown or expired. */
  verify(token: unknown): Account | null {
    if (typeof token !== 'string' || token.length > 100) return null;
    const s = this.data.sessions[hashToken(token)];
    if (!s) return null;
    if (s.expires < this.now()) { delete this.data.sessions[hashToken(token)]; this.dirty = true; return null; }
    const a = this.data.accounts[s.account];
    return a ? { id: a.id, name: a.name } : null;
  }

  logout(token: unknown): void {
    if (typeof token !== 'string') return;
    if (delete this.data.sessions[hashToken(token)]) this.dirty = true;
  }

  flush(): void {
    if (!this.file || !this.dirty) return;
    const t = this.now();
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.expires < t) delete this.data.sessions[k];
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.dirty = false;
  }
}
