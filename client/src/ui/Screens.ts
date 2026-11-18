import { uiState } from './UIState';

// Full-screen layers: title, pause and death. All three share one composition: the world stays
// visible behind a directional wash, the words sit on the right, a short line on the left.

const CSS = `
.r-scr { position: fixed; inset: 0; z-index: 40; pointer-events: none; }
.r-scr.is-open { pointer-events: auto; }
.r-scr .wash { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(6,6,5,.6), rgba(6,6,5,.04) 34%, rgba(6,6,5,.1) 56%, rgba(6,6,5,.78) 88%), linear-gradient(180deg, rgba(6,6,5,.35), transparent 30%, transparent 70%, rgba(6,6,5,.45)); }
.r-scr.pause .wash, .r-scr.death .wash { background: linear-gradient(90deg, rgba(6,6,5,.7), rgba(6,6,5,.35) 45%, rgba(6,6,5,.82)); }
.r-scr .brand { position: absolute; left: clamp(28px, 5vw, 90px); top: clamp(26px, 6vh, 70px); }
.r-scr .brand h1 { margin: 0; font: 400 clamp(64px, 8.5vw, 140px) / .95 var(--font-brush); letter-spacing: .02em; text-shadow: 0 4px 40px rgba(0,0,0,.45); animation: r-ink 2.2s var(--ease) both; }
.r-scr .brand h1 .kanji { font: 400 .32em var(--font-kanji); vertical-align: .9em; margin-left: .3em; color: var(--gold); opacity: .85; }
.r-scr .brand .sub { margin: 14px 0 0 6px; animation: r-ink 1.6s var(--ease) .6s both; }
.r-scr .brand .rule { width: 180px; margin: 16px 0 0 6px; }
.r-scr .verse { position: absolute; left: clamp(30px, 5vw, 92px); bottom: clamp(40px, 9vh, 110px); display: grid; gap: 10px; font: 500 calc(12px * var(--ui-scale)) var(--font-sans); letter-spacing: .42em; text-transform: uppercase; color: var(--ivory-dim); }
.r-scr .verse span { animation: r-ink 1.4s var(--ease) both; }
.r-scr .menu { position: absolute; right: clamp(40px, 8vw, 150px); top: 50%; transform: translateY(-36%); display: flex; gap: 28px; align-items: stretch; }
.r-scr .menu .bar { width: 1px; background: linear-gradient(180deg, transparent, var(--ivory-faint), transparent); }
.r-scr .menu .r-menu { justify-items: end; }
.r-scr .menu .r-menu button { flex-direction: row-reverse; }
.r-scr .heading { position: absolute; right: clamp(40px, 8vw, 150px); top: clamp(30px, 8vh, 90px); text-align: right; }
.r-scr .heading .big { font: 400 clamp(38px, 4vw, 64px) var(--font-brush); }
.r-scr .heading .small { margin-top: 8px; }
.r-scr .loading { position: absolute; right: clamp(40px, 8vw, 150px); bottom: clamp(40px, 9vh, 110px); text-align: right; display: grid; gap: 12px; justify-items: end; }
.r-scr .loading .track { width: 220px; height: 1px; background: var(--line); overflow: hidden; }
.r-scr .loading .track i { display: block; width: 40%; height: 100%; background: var(--gold); animation: r-load 1.8s var(--ease) infinite; }
@keyframes r-load { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
.r-scr .error { color: #d79a85; }
.r-scr .line { position: absolute; left: clamp(30px, 5vw, 92px); top: 42%; max-width: 420px; font: italic 400 calc(24px * var(--ui-scale)) / 1.5 var(--font-serif); color: var(--ivory); animation: r-ink 2s var(--ease) both; }
.r-scr .line small { display: block; margin-top: 18px; }
.r-scr .confirm { margin-top: 20px; text-align: right; }
`;

let styled = false;
function style(): void {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
}

export interface MenuItem { label: string; action: () => void; hidden?: () => boolean }

function menu(items: MenuItem[]): { root: HTMLElement; refresh: () => void } {
    const wrap = document.createElement('div');
    wrap.className = 'menu';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const list = document.createElement('div');
    list.className = 'r-menu';
    list.setAttribute('role', 'menu');
    wrap.append(list, bar);
    const refresh = () => {
        list.replaceChildren(...items.filter(i => !i.hidden?.()).map((item, n) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.textContent = item.label;
            if (n === 0) b.setAttribute('aria-current', 'true');
            b.addEventListener('mouseenter', () => { list.querySelectorAll('button').forEach(x => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); });
            b.addEventListener('click', e => { e.stopPropagation(); item.action(); });
            return b;
        }));
    };
    // Arrow keys move the gold mark; Enter takes it.
    wrap.addEventListener('keydown', e => {
        const buttons = [...list.querySelectorAll('button')];
        const i = buttons.findIndex(b => b.getAttribute('aria-current') === 'true');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
            buttons.forEach(b => b.removeAttribute('aria-current'));
            next.setAttribute('aria-current', 'true');
            next.focus();
        }
    });
    refresh();
    return { root: wrap, refresh };
}

abstract class Screen {
    readonly root = document.createElement('section');
    protected refreshMenu: () => void = () => {};
    constructor(cls: string, protected overlay: 'title' | 'pause' | 'death') {
        style();
        this.root.className = `r-scr r-layer r-screen r-grain ${cls}`;
        const wash = document.createElement('div');
        wash.className = 'wash';
        this.root.appendChild(wash);
        document.body.appendChild(this.root);
    }
    protected addMenu(items: MenuItem[]): void {
        const m = menu(items);
        this.refreshMenu = m.refresh;
        this.root.appendChild(m.root);
    }
    open(): void {
        this.refreshMenu();
        this.root.classList.add('is-open');
        uiState.open(this.overlay);
        (this.root.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
    }
    close(): void {
        this.root.classList.remove('is-open');
        uiState.close(this.overlay);
    }
    get isOpen(): boolean { return this.root.classList.contains('is-open'); }
}

/** Original lines for the title and loading moments. Rotated per visit. */
export const VERSES = [
    ['The blade', 'answers only', 'a quiet hand'],
    ['Distance', 'is the first', 'cut'],
    ['Wait', 'until waiting', 'becomes the strike'],
    ['Every rival', 'is a mirror', 'held at sword length'],
];

export class TitleScreen extends Screen {
    private loading = document.createElement('div');
    constructor(items: MenuItem[]) {
        super('title', 'title');
        const verse = VERSES[Math.floor(Date.now() / 86400000) % VERSES.length];
        this.root.insertAdjacentHTML('beforeend', `
            <div class="brand"><h1>Rōnin <span class="kanji">浪人</span></h1><div class="r-eyebrow sub">A swordsman's road</div><hr class="r-rule rule"></div>
            <div class="verse">${verse.map((v, i) => `<span style="animation-delay:${1 + i * 0.35}s">${v}</span>`).join('')}</div>`);
        this.loading.className = 'loading';
        this.loading.innerHTML = '<div class="r-micro">Preparing the road</div><div class="track"><i></i></div>';
        this.root.appendChild(this.loading);
        this.addMenu(items);
        this.root.querySelector('.menu')!.setAttribute('hidden', '');
    }
    ready(): void {
        this.loading.remove();
        this.root.querySelector('.menu')!.removeAttribute('hidden');
        this.refreshMenu();
        (this.root.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
    }
    failed(message: string): void {
        this.loading.innerHTML = `<div class="r-micro error">${message}</div>`;
    }
}

export class PauseScreen extends Screen {
    constructor(items: MenuItem[]) {
        super('pause', 'pause');
        this.root.insertAdjacentHTML('beforeend', '<div class="heading"><div class="big">Stillness</div><div class="r-eyebrow small">The world waits</div></div>');
        this.addMenu(items);
    }
}

const DEATH_LINES = [
    'The ground keeps no record of who fell. Only of who rose.',
    'You were slower than your own doubt.',
    'A cut you did not see is a lesson you have not yet learned.',
];

export class DeathScreen extends Screen {
    private line = document.createElement('div');
    constructor(items: MenuItem[]) {
        super('death', 'death');
        this.line.className = 'line';
        this.root.appendChild(this.line);
        this.addMenu(items);
    }
    show(rivalName: string | null): void {
        const text = DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)];
        this.line.innerHTML = `${text}<small class="r-eyebrow">${rivalName ? `Fallen to ${rivalName}` : 'Fallen'}</small>`;
        this.open();
    }
}
