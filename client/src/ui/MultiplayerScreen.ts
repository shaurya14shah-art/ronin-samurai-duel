import { NetDuel, SERVER_URL, checkSession, currentSession, formatRecord, register, signIn, signOut, type DuelRecord } from '../net/NetDuel';
import { uiState } from './UIState';

// Multiplayer: one-on-one duels on a server that runs the same rules and is the only judge.
// Quick match, a private duel with a code to share, or joining by code. While searching, the
// screen shows what is true: who has joined, from where, and how far away the server is.

const NAME_KEY = 'ronin.name.v1';
/** Your record as the server last reported it (the server is the source; this is a cache). */
const RECORD_KEY = 'ronin.onlineRecord.v1';

export function rememberRecord(r: DuelRecord | undefined): void {
    if (!r) return;
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)); } catch { /* private mode */ }
}
function lastRecord(): DuelRecord | null {
    try { const r = JSON.parse(localStorage.getItem(RECORD_KEY) ?? 'null'); return r && typeof r.wins === 'number' ? r : null; } catch { return null; }
}

const CSS = `
#r-mp { z-index: 46; pointer-events: none; background: linear-gradient(90deg, rgba(5,5,4,.55), rgba(5,5,4,.2) 40%, rgba(5,5,4,.9)); }
#r-mp.is-open { pointer-events: auto; }
#r-mp .head { position: absolute; left: clamp(28px, 5vw, 90px); top: clamp(28px, 7vh, 80px); }
#r-mp .head .t { font: 400 clamp(46px, 5vw, 76px) var(--font-brush); }
#r-mp .head p { max-width: 420px; }
#r-mp .side { position: absolute; right: clamp(40px, 8vw, 150px); top: 50%; transform: translateY(-50%); width: min(420px, 38vw); display: grid; gap: 22px; justify-items: end; text-align: right; }
#r-mp .side .r-menu { justify-items: end; }
#r-mp .side .r-menu button { flex-direction: row-reverse; }
#r-mp label.name { display: grid; gap: 6px; justify-items: end; }
#r-mp input { all: unset; text-align: right; min-width: 220px; font: 400 calc(24px * var(--ui-scale)) var(--font-brush); border-bottom: 1px solid var(--line); padding: 4px 0; }
#r-mp input:focus { border-color: var(--gold-dim); }
#r-mp .status { display: grid; gap: 8px; justify-items: end; min-height: 90px; }
#r-mp .status .big { font: 400 calc(30px * var(--ui-scale)) var(--font-brush); }
#r-mp .status .code { font: 500 calc(13px * var(--ui-scale)) var(--font-sans); letter-spacing: .2em; color: var(--gold); user-select: all; }
#r-mp .dots::after { content: ''; animation: r-mp-dots 1.6s steps(4) infinite; }
@keyframes r-mp-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
#r-mp .err { color: #d79a85; }
#r-mp .joinrow { display: flex; gap: 16px; align-items: center; }
#r-mp .account { display: grid; gap: 6px; justify-items: end; }
#r-mp .account .links { display: flex; gap: 18px; }
#r-mp .account .links button, #r-mp .auth button.link { all: unset; cursor: pointer; font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .25em; text-transform: uppercase; color: var(--gold); }
#r-mp .account .who { font: 400 calc(26px * var(--ui-scale)) var(--font-brush); }
#r-mp .auth { display: grid; gap: 12px; justify-items: end; }
#r-mp .auth input { min-width: 260px; font: 400 calc(18px * var(--ui-scale)) var(--font-serif); }
#r-mp .tag-guest { font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .2em; text-transform: uppercase; opacity: .6; margin-left: 8px; }
#r-mp .open { display: grid; gap: 6px; justify-items: end; }
#r-mp .open button { all: unset; cursor: pointer; font: 400 calc(15px * var(--ui-scale)) var(--font-serif); color: var(--ink-dim, #cfc6b4); padding: 2px 0; }
#r-mp .open button:hover, #r-mp .open button:focus-visible { color: var(--gold); }
#r-mp .open button .rec { font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .14em; margin-left: 10px; opacity: .7; }
`;

export class MultiplayerScreen {
    readonly root = document.createElement('section');
    private status = document.createElement('div');
    private menu = document.createElement('div');
    private open$ = document.createElement('div');
    private listTimer = 0;
    private net: NetDuel | null = null;
    private timer = 0;
    onClose: () => void = () => {};
    /** Enter the ring with this session (the server seats both fighters). */
    onEnter: (net: NetDuel) => void = () => {};
    onTrain: () => void = () => {};

    constructor() {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-mp';
        this.root.className = 'r-layer r-screen r-grain';
        this.root.insertAdjacentHTML('beforeend', `<div class="head"><div class="r-eyebrow">One blade against another</div><div class="t">Multiplayer</div>
            <p class="r-body">Duels are judged by the server alone, under the same rules as every rival on the road. Your hands send intent; the server decides what landed.</p></div>`);
        const side = document.createElement('div');
        side.className = 'side';
        const name = document.createElement('label');
        name.className = 'name';
        name.innerHTML = '<span class="r-eyebrow">Your name on the road</span>';
        const input = document.createElement('input');
        input.maxLength = 24;
        input.value = (() => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } })() || 'Wanderer';
        input.addEventListener('input', () => { try { localStorage.setItem(NAME_KEY, input.value); } catch { /* private mode */ } });
        name.appendChild(input);
        this.nameLabel = name;
        this.account.className = 'account';
        this.status.className = 'status';
        this.menu.className = 'r-menu';
        this.open$.className = 'open';
        side.append(this.account, name, this.status, this.menu, this.open$);
        this.root.appendChild(side);
        document.body.appendChild(this.root);
        this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.back(); } });
        this.nameInput = input;
    }

    private nameInput: HTMLInputElement;
    private nameLabel!: HTMLLabelElement;
    private account = document.createElement('div');

    /** Signed in: the account's name and a way out. Signed out: guest, with sign in / create. */
    private renderAccount(record?: DuelRecord | null): void {
        const s = currentSession();
        this.nameLabel.style.display = s ? 'none' : '';
        this.account.replaceChildren();
        const links = document.createElement('div');
        links.className = 'links';
        const link = (label: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); links.appendChild(b); };
        if (s) {
            this.account.insertAdjacentHTML('beforeend', `<span class="r-eyebrow">Signed in</span><span class="who">${escape(s.account.name)}</span>`);
            if (record) this.account.insertAdjacentHTML('beforeend', `<span class="r-micro">record ${formatRecord(record)} · wins – losses, as the server judged them</span>`);
            link('Sign out', () => { void signOut().then(() => { this.renderAccount(); this.showMain(); }); });
        } else {
            this.account.insertAdjacentHTML('beforeend', '<span class="r-micro">Playing as a guest. An account keeps your name and record on any machine.</span>');
            link('Sign in', () => this.showAuth('in'));
            link('Create account', () => this.showAuth('new'));
        }
        this.account.appendChild(links);
    }

    private showAuth(mode: 'in' | 'new'): void {
        window.clearInterval(this.listTimer);
        this.account.style.display = 'none';
        this.nameLabel.style.display = 'none';
        this.open$.replaceChildren();
        const form = document.createElement('form');
        form.className = 'auth';
        form.innerHTML = `<span class="r-eyebrow">${mode === 'in' ? 'Sign in' : 'Create an account'}</span>`;
        const user = document.createElement('input');
        user.placeholder = 'name';
        user.autocomplete = 'username';
        user.maxLength = 24;
        user.value = mode === 'new' ? this.nameInput.value.trim() : '';
        const pass = document.createElement('input');
        pass.type = 'password';
        pass.placeholder = mode === 'in' ? 'password' : 'password (8 or more)';
        pass.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
        const err = document.createElement('span');
        err.className = 'r-micro err';
        form.append(user, pass, err);
        const submit = async () => {
            err.textContent = '';
            try {
                const r = mode === 'in' ? await signIn(user.value, pass.value) : await register(user.value, pass.value);
                pass.value = '';
                rememberRecord(r.record ?? undefined);
                this.renderAccount(r.record);
                this.showMain();
            } catch (e) {
                const msg = String((e as Error)?.message ?? e);
                err.textContent = /fetch|network|Failed/i.test(msg) ? `No server answers at ${SERVER_URL}.` : msg;
            }
        };
        form.addEventListener('submit', e => { e.preventDefault(); void submit(); });
        this.status.replaceChildren(form);
        this.items([[mode === 'in' ? 'Sign in' : 'Create account', () => void submit()], ['Back', () => this.showMain()]]);
        (mode === 'in' || !user.value ? user : pass).focus();
    }

    get isOpen(): boolean { return this.root.classList.contains('is-open'); }

    open(): void {
        this.renderAccount();
        this.showMain();
        // Confirm the stored session with the server (and fetch its record); quietly drop it if expired.
        void checkSession().then(r => { if (r) { rememberRecord(r.record ?? undefined); this.renderAccount(r.record); } else this.renderAccount(); }).catch(() => this.renderAccount());
        this.root.classList.add('is-open');
        uiState.open('multiplayer');
    }

    close(): void {
        window.clearInterval(this.timer);
        window.clearInterval(this.listTimer);
        this.root.classList.remove('is-open');
        uiState.close('multiplayer');
    }

    private back(): void {
        // Leaving the screen before entering the ring abandons the search.
        if (this.net) { this.net.leave(); this.net = null; }
        this.onClose();
    }

    private items(list: [string, () => void][]): void {
        this.menu.replaceChildren(...list.map(([label, fn], i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            if (i === 0) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', fn);
            return b;
        }));
    }

    private say(html: string): void {
        this.status.innerHTML = html;
    }

    private showMain(): void {
        window.clearInterval(this.timer);
        this.account.style.display = '';
        this.nameLabel.style.display = currentSession() ? 'none' : '';
        const rec = currentSession() ? null : lastRecord();
        this.say(rec ? `<span class="r-eyebrow">Your record in the ring</span><span class="big">${formatRecord(rec)}</span><span class="r-micro">wins – losses, as the server judged them</span>` : '');
        void this.listOpen();
        window.clearInterval(this.listTimer);
        this.listTimer = window.setInterval(() => void this.listOpen(), 3000);
        this.items([
            ['Quick duel', () => this.connect(() => NetDuel.quick(this.name()))],
            ['Host a private duel', () => this.connect(() => NetDuel.host(this.name()))],
            ['Join by code', () => this.showJoin()],
            ['Train alone', () => this.onTrain()],
            ['Return', () => this.back()],
        ]);
    }

    /** Public duels with someone already waiting in the ring. */
    private async listOpen(): Promise<void> {
        let open: Awaited<ReturnType<typeof NetDuel.openDuels>> = [];
        try { open = await NetDuel.openDuels(); } catch { /* no server: connecting will say so */ }
        if (!this.isOpen || this.net) return;
        this.open$.replaceChildren();
        if (!open.length) return;
        const head = document.createElement('span');
        head.className = 'r-eyebrow';
        head.textContent = 'Waiting in the ring';
        this.open$.appendChild(head);
        for (const d of open.slice(0, 6)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.innerHTML = `${escape(d.host)}${d.verified ? '' : '<span class="tag-guest">guest</span>'}<span class="rec">${formatRecord(d.record)}</span>`;
            b.addEventListener('click', () => this.connect(() => NetDuel.join(d.code, this.name())));
            this.open$.appendChild(b);
        }
    }

    private name(): string {
        return currentSession()?.account.name ?? (this.nameInput.value.trim() || 'Wanderer');
    }

    private showJoin(): void {
        this.say('<span class="r-eyebrow">The code your opponent shared</span>');
        const row = document.createElement('div');
        row.className = 'joinrow';
        const code = document.createElement('input');
        code.placeholder = 'code';
        code.style.minWidth = '160px';
        row.appendChild(code);
        this.status.appendChild(row);
        this.items([
            ['Join', () => this.connect(() => NetDuel.join(code.value, this.name()))],
            ['Back', () => this.showMain()],
        ]);
        code.focus();
    }

    private async connect(make: () => Promise<NetDuel>): Promise<void> {
        window.clearInterval(this.listTimer);
        this.open$.replaceChildren();
        this.say('<span class="big dots">Finding the way</span>');
        this.items([['Cancel', () => this.back()]]);
        try {
            this.net = await make();
        } catch (e) {
            const msg = String((e as Error)?.message ?? e);
            const down = /ECONNREFUSED|connect|failed|WebSocket|1006|network/i.test(msg);
            this.say(down
                ? `<span class="r-micro err">No server answers at ${SERVER_URL}. Start it with <kbd class="r-key">npm run dev:server</kbd> and try again.</span>`
                : `<span class="r-micro err">${msg.replace(/[<>]/g, '')}</span>`);
            this.items([['Try again', () => this.showMain()], ['Return', () => this.back()]]);
            return;
        }
        const net = this.net!;
        rememberRecord(net.records[net.you]);
        const render = () => {
            const foe = net.opponentId;
            const code = net.code;
            const where = 'The ring in the forge courtyard';
            this.say(foe
                ? `<span class="r-eyebrow">Matched</span><span class="big">${escape(net.names[foe])}${net.verified[foe] ? '' : '<span class="tag-guest">guest</span>'}</span><span class="r-micro">${net.records[foe] ? `record ${formatRecord(net.records[foe])} · ` : ''}${where} · server ${net.pingMs} ms away</span>`
                : `<span class="big dots">Searching for an opponent</span><span class="r-micro">Share this code to duel a friend</span><span class="code">${escape(code)}</span><span class="r-micro">server ${net.pingMs} ms away</span>`);
        };
        render();
        window.clearInterval(this.timer);
        this.timer = window.setInterval(render, 500);
        this.items([
            ['Enter the ring', () => { window.clearInterval(this.timer); const n = net; this.net = null; this.onEnter(n); }],
            ['Leave', () => this.back()],
        ]);
    }
}

function escape(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
