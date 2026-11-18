import { settings, type SettingValues } from './Settings';
import { uiState } from './UIState';

// Settings: categories on the left, the chosen category's options on the right. Every control
// writes to `settings`, and the owning system applies it through `settings.watch`.

type Control =
    | { kind: 'range'; key: keyof SettingValues; label: string; min: number; max: number; step: number; format: (v: number) => string; note?: string }
    | { kind: 'toggle'; key: keyof SettingValues; label: string; note?: string };

const CATEGORIES: { id: string; label: string; controls: Control[] }[] = [
    { id: 'graphics', label: 'Graphics', controls: [
        { kind: 'range', key: 'renderScale', label: 'Render resolution', min: 0.6, max: 1.5, step: 0.1, format: v => `${Math.round(v * 100)}%`, note: 'Lower is faster; higher is sharper.' },
        { kind: 'toggle', key: 'shadows', label: 'Shadows' },
    ] },
    { id: 'audio', label: 'Audio', controls: [
        { kind: 'range', key: 'masterVolume', label: 'Master volume', min: 0, max: 1, step: 0.05, format: v => `${Math.round(v * 100)}` },
    ] },
    { id: 'controls', label: 'Controls', controls: [
        { kind: 'range', key: 'mouseSensitivity', label: 'Look sensitivity', min: 0.3, max: 2.5, step: 0.05, format: v => `×${v.toFixed(2)}` },
    ] },
    { id: 'interface', label: 'Interface', controls: [
        { kind: 'range', key: 'uiScale', label: 'Interface scale', min: 0.8, max: 1.4, step: 0.05, format: v => `${Math.round(v * 100)}%` },
        { kind: 'toggle', key: 'showHints', label: 'Contextual control hints' },
        { kind: 'toggle', key: 'showPortrait', label: 'Figure in the corner' },
    ] },
    { id: 'accessibility', label: 'Accessibility', controls: [
        { kind: 'toggle', key: 'reducedMotion', label: 'Reduce motion', note: 'Removes interface animation and camera shake.' },
        { kind: 'range', key: 'screenShake', label: 'Camera shake', min: 0, max: 1, step: 0.05, format: v => `${Math.round(v * 100)}%` },
        { kind: 'range', key: 'uiScale', label: 'Text and interface size', min: 0.8, max: 1.4, step: 0.05, format: v => `${Math.round(v * 100)}%` },
    ] },
];

const CSS = `
#r-settings { z-index: 46; pointer-events: none; background: linear-gradient(90deg, rgba(5,5,4,.92), rgba(5,5,4,.78) 50%, rgba(5,5,4,.9)); }
#r-settings.is-open { pointer-events: auto; }
#r-settings .title { position: absolute; left: 6vw; top: 9vh; font: 400 calc(44px * var(--ui-scale)) var(--font-brush); }
#r-settings .cats { position: absolute; left: 6vw; top: 22vh; }
#r-settings .cats .r-menu button { font-size: calc(13px * var(--ui-scale)); }
#r-settings .cats .r-menu button[aria-current="true"] { font-size: calc(16px * var(--ui-scale)); }
#r-settings .opts { position: absolute; left: 36vw; right: 8vw; top: 22vh; display: grid; gap: 4px; }
#r-settings .opt { display: grid; grid-template-columns: 1fr minmax(180px, 320px) 64px; gap: 24px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); animation: r-ink .6s var(--ease) both; }
#r-settings .opt label { font: 500 calc(18px * var(--ui-scale)) var(--font-serif); letter-spacing: .05em; }
#r-settings .opt .r-micro { grid-column: 1 / -1; margin-top: -8px; }
#r-settings .opt output { font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .15em; color: var(--ivory-dim); text-align: right; }
#r-settings input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; background: transparent; cursor: pointer; }
#r-settings input[type=range]::-webkit-slider-runnable-track { height: 1px; background: var(--ivory-faint); }
#r-settings input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 9px; margin-top: -4px; transform: rotate(45deg); background: var(--gold); border: 0; }
#r-settings input[type=range]:focus-visible { outline: 1px solid var(--gold-dim); outline-offset: 4px; }
#r-settings .switch { all: unset; cursor: pointer; justify-self: start; font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .3em; text-transform: uppercase; color: var(--ivory-faint); }
#r-settings .switch[aria-checked="true"] { color: var(--gold); }
#r-settings .switch:focus-visible { outline: 1px solid var(--gold-dim); outline-offset: 6px; }
#r-settings .back { position: absolute; left: 6vw; bottom: 8vh; display: flex; gap: 36px; }
`;

export class SettingsScreen {
    readonly root = document.createElement('section');
    private cats = document.createElement('div');
    private opts = document.createElement('div');
    private current = CATEGORIES[0].id;
    onClose: () => void = () => {};

    constructor() {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-settings';
        this.root.className = 'r-layer r-screen r-grain';
        this.root.insertAdjacentHTML('beforeend', '<div class="title">Settings</div>');
        this.cats.className = 'cats';
        this.opts.className = 'opts';
        const back = document.createElement('div');
        back.className = 'back r-menu';
        const ret = document.createElement('button');
        ret.type = 'button';
        ret.textContent = 'Return';
        ret.addEventListener('click', () => this.onClose());
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Restore defaults';
        reset.addEventListener('click', () => { settings.reset(); this.render(); });
        back.append(ret, reset);
        this.root.append(this.cats, this.opts, back);
        document.body.appendChild(this.root);
        this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.onClose(); } });
    }

    get isOpen(): boolean { return this.root.classList.contains('is-open'); }

    open(): void {
        this.render();
        this.root.classList.add('is-open');
        uiState.open('settings');
        (this.cats.querySelector('button') as HTMLElement)?.focus({ preventScroll: true });
    }

    close(): void {
        this.root.classList.remove('is-open');
        uiState.close('settings');
    }

    private render(): void {
        const list = document.createElement('div');
        list.className = 'r-menu';
        for (const c of CATEGORIES) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = c.label;
            if (c.id === this.current) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', () => { this.current = c.id; this.render(); });
            list.appendChild(b);
        }
        this.cats.replaceChildren(list);
        const cat = CATEGORIES.find(c => c.id === this.current)!;
        this.opts.replaceChildren(...cat.controls.map((c, i) => this.control(c, i)));
    }

    private control(c: Control, i: number): HTMLElement {
        const row = document.createElement('div');
        row.className = 'opt';
        row.style.animationDelay = `${i * 60}ms`;
        const id = `set-${c.key}-${i}`;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = c.label;
        row.appendChild(label);
        if (c.kind === 'range') {
            const input = document.createElement('input');
            input.type = 'range';
            input.id = id;
            input.min = String(c.min); input.max = String(c.max); input.step = String(c.step);
            input.value = String(settings.get(c.key));
            const out = document.createElement('output');
            out.textContent = c.format(Number(input.value));
            input.addEventListener('input', () => { settings.set(c.key, Number(input.value) as never); out.textContent = c.format(Number(input.value)); });
            row.append(input, out);
        } else {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = id;
            b.className = 'switch';
            b.setAttribute('role', 'switch');
            const sync = () => { const on = !!settings.get(c.key); b.setAttribute('aria-checked', String(on)); b.textContent = on ? 'On' : 'Off'; };
            b.addEventListener('click', () => { settings.set(c.key, !settings.get(c.key) as never); sync(); });
            sync();
            row.append(b, document.createElement('span'));
        }
        if (c.note) {
            const n = document.createElement('div');
            n.className = 'r-micro';
            n.textContent = c.note;
            row.appendChild(n);
        }
        return row;
    }
}
