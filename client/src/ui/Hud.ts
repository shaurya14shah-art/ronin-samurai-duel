import type { Duelist } from '@ronin/combat';
import type { RivalView } from '../duel/DuelDirector';
import { uiState } from './UIState';
import { settings } from './Settings';

// The in-world HUD. It reads real state every frame and writes only what changed.
//
//  top-left      objective (fades in combat, gone in a duel)
//  top-centre    duel strip: opponent's name, epithet, vitality and posture, time in the duel
//  top-right     the player's own figure (CharacterPortrait mounts into #hud-portrait)
//  bottom-left   vitality and stamina as thin lines; composure as an ensō that closes or breaks
//  right edge    contextual controls, only when they help (training, drawing, the forge)
//  centre        reveals: a duel's title, a place's name. Nothing else.

export interface Objective { title: string; text: string }
export interface Prompt { key: string; label: string }

export interface HudSource {
    player(): Duelist;
    rival(): RivalView | null;
    objective(): Objective | null;
    prompts(): Prompt[];
}

const ICON = {
    vitality: '<svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    stamina: '<svg viewBox="0 0 16 16"><path d="M2 10c2-4 4-4 6 0s4 4 6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    posture: '<svg viewBox="0 0 16 16"><path d="M8 2l6 6-6 6-6-6z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    marker: '<svg viewBox="0 0 12 12"><path d="M6 1l5 5-5 5-5-5z" fill="currentColor"/></svg>',
};

const CSS = `
#r-hud { z-index: 20; transition: opacity var(--slow) var(--ease); }
body[data-ui="title"] #r-hud, body[data-ui="pause"] #r-hud, body[data-ui="character"] #r-hud,
body[data-ui="settings"] #r-hud, body[data-ui="death"] #r-hud, body[data-ui="forge"] #r-hud,
body[data-ui="map"] #r-hud, body[data-ui="multiplayer"] #r-hud { opacity: 0; }

.hud-vitals { position: absolute; left: calc(40px * var(--ui-scale)); bottom: calc(36px * var(--ui-scale)); display: grid; gap: calc(9px * var(--ui-scale)); transition: opacity var(--slow) var(--ease); opacity: .5; }
body[data-ui="combat"] .hud-vitals, body[data-ui="duel"] .hud-vitals, .hud-vitals.is-low { opacity: .95; }
body[data-ui="cinematic"] .hud-vitals { opacity: 0; }
.hud-row { display: flex; align-items: center; gap: 12px; height: calc(14px * var(--ui-scale)); }
.hud-row svg { width: calc(13px * var(--ui-scale)); height: calc(13px * var(--ui-scale)); color: var(--ivory-dim); flex: none; }
.hud-line { position: relative; width: calc(200px * var(--ui-scale)); height: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
.hud-line i { position: absolute; inset: 0; transform-origin: left; transition: transform 160ms linear; }
.hud-line i.ghost { background: rgba(233,225,207,.35); transition: transform 900ms var(--ease) 260ms; }
.hud-line.vitality i.fill { background: linear-gradient(90deg, #7d2f26, #b4574a); }
.hud-line.stamina i.fill { background: var(--stamina); }
.hud-line.posture i.fill { background: var(--gold); }
.hud-row.posture { transition: opacity var(--mid) var(--ease); }
.hud-row.posture.is-idle { opacity: 0; }
.hud-vitals.is-exhausted .hud-line.stamina i.fill { animation: hud-pulse 1.1s ease-in-out infinite; }
@keyframes hud-pulse { 50% { opacity: .35; } }
.hud-enso { width: calc(40px * var(--ui-scale)); height: calc(40px * var(--ui-scale)); margin-top: 6px; color: var(--ivory); }
.hud-enso circle { fill: none; stroke: currentColor; stroke-linecap: round; transition: stroke-dashoffset 400ms var(--ease), opacity 400ms; }
.hud-enso.is-shaken { animation: hud-tremble 0.18s linear infinite; }
@keyframes hud-tremble { 25% { transform: translate(.6px,-.4px) rotate(.6deg); } 75% { transform: translate(-.5px,.4px) rotate(-.5deg); } }

.hud-objective { position: absolute; left: calc(40px * var(--ui-scale)); top: calc(36px * var(--ui-scale)); max-width: calc(360px * var(--ui-scale)); transition: opacity var(--slow) var(--ease), transform var(--slow) var(--ease); }
.hud-objective .t { display: flex; gap: 10px; align-items: center; color: var(--gold); }
.hud-objective .t svg { width: 9px; height: 9px; }
.hud-objective .t span { font: 500 calc(12px * var(--ui-scale)) var(--font-sans); letter-spacing: .3em; text-transform: uppercase; color: var(--ivory); }
.hud-objective p { margin: 7px 0 0 19px; font: italic 400 calc(16px * var(--ui-scale)) / 1.4 var(--font-serif); color: var(--ivory-dim); }
body[data-ui="combat"] .hud-objective { opacity: .3; }
body[data-ui="duel"] .hud-objective, body[data-ui="cinematic"] .hud-objective, .hud-objective.is-empty { opacity: 0; transform: translateY(-6px); }

.hud-duel { position: absolute; top: calc(30px * var(--ui-scale)); left: 50%; transform: translate(-50%, -8px); text-align: center; opacity: 0; transition: opacity var(--slow) var(--ease), transform var(--slow) var(--ease); }
body[data-ui="duel"] .hud-duel { opacity: 1; transform: translate(-50%, 0); }
.hud-duel .label { display: flex; gap: 14px; justify-content: center; align-items: baseline; }
.hud-duel .name { font: 400 calc(22px * var(--ui-scale)) var(--font-brush); letter-spacing: .06em; }
.hud-duel .time { font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .25em; color: var(--ivory-faint); }
.hud-duel .epithet { margin-top: 2px; font: italic calc(13px * var(--ui-scale)) var(--font-serif); color: var(--ivory-dim); }
.hud-duel .lines { display: grid; gap: 4px; justify-items: center; margin-top: 10px; }
.hud-duel .hud-line { width: calc(260px * var(--ui-scale)); height: 2px; }
.hud-duel .hud-line.posture { width: calc(180px * var(--ui-scale)); }

.hud-prompts { position: absolute; right: calc(40px * var(--ui-scale)); top: 50%; transform: translateY(-50%); display: grid; gap: 10px; justify-items: end; transition: opacity var(--mid) var(--ease); }
.hud-prompts div { display: flex; gap: 12px; align-items: center; font: 400 calc(12px * var(--ui-scale)) var(--font-sans); letter-spacing: .12em; color: var(--ivory-dim); animation: r-ink var(--mid) var(--ease) both; }
body[data-ui="cinematic"] .hud-prompts, body.no-hints .hud-prompts { opacity: 0; }

.hud-reveal { position: absolute; left: 0; right: 0; top: 30%; text-align: center; pointer-events: none; }
.hud-reveal .big { font: 400 calc(46px * var(--ui-scale)) var(--font-brush); letter-spacing: .08em; text-shadow: 0 2px 30px rgba(0,0,0,.6); }
.hud-reveal .small { margin-top: 10px; font: italic calc(18px * var(--ui-scale)) var(--font-serif); color: var(--ivory-dim); }
.hud-reveal .eyebrow { margin-bottom: 14px; }
.hud-reveal.is-shown > * { animation: r-ink 1.6s var(--ease) both; }
.hud-reveal.is-shown .small { animation-delay: .35s; }
.hud-reveal.is-leaving > * { animation: r-fade-out 1.2s var(--ease) both; }

.hud-crosshair { position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px; border-radius: 50%; background: var(--ivory); opacity: .45; transition: opacity var(--mid), transform var(--fast); }
body[data-ui="cinematic"] .hud-crosshair, body.hide-crosshair .hud-crosshair { opacity: 0; }
.hud-crosshair.is-striking { transform: scale(2.2); opacity: .7; }

.hud-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(60, 8, 4, .55)); opacity: 0; transition: opacity 600ms var(--ease); }
#hud-portrait { position: absolute; right: calc(26px * var(--ui-scale)); top: calc(18px * var(--ui-scale)); width: calc(150px * var(--ui-scale)); height: calc(190px * var(--ui-scale)); transition: opacity var(--slow) var(--ease); opacity: .92;
    -webkit-mask-image: radial-gradient(ellipse 65% 60% at 50% 48%, #000 55%, transparent 100%); mask-image: radial-gradient(ellipse 65% 60% at 50% 48%, #000 55%, transparent 100%); }
body[data-ui="cinematic"] #hud-portrait, body[data-ui="duel"] #hud-portrait, body.no-portrait #hud-portrait { opacity: 0; }
#hud-portrait canvas { width: 100% !important; height: 100% !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
}

class Line {
    readonly root = el('div', 'hud-line');
    private fill = el('i', 'fill');
    private ghost = el('i', 'ghost');
    private last = -1;
    constructor(kind: string) {
        this.root.classList.add(kind);
        this.root.append(this.ghost, this.fill);
    }
    set(v: number): void {
        const q = Math.round(Math.max(0, Math.min(1, v)) * 400) / 400;
        if (q === this.last) return;
        // Losses leave a pale trace that drains after a beat; gains fill straight in.
        if (q > this.last) this.ghost.style.transform = `scaleX(${q})`;
        this.fill.style.transform = `scaleX(${q})`;
        if (q < this.last) this.ghost.style.transform = `scaleX(${q})`;
        this.last = q;
    }
}

export class Hud {
    readonly root = el('div', 'r-layer');
    readonly portraitHost = el('div');
    private vitals = el('div', 'hud-vitals');
    private vitality = new Line('vitality');
    private stamina = new Line('stamina');
    private posture = new Line('posture');
    private postureRow = el('div', 'hud-row posture is-idle');
    private enso = el('div', 'hud-enso');
    private ensoCircle!: SVGCircleElement;
    private objective = el('div', 'hud-objective is-empty');
    private objectiveTitle = el('span');
    private objectiveText = el('p');
    private duel = el('div', 'hud-duel');
    private duelName = el('span', 'name');
    private duelTime = el('span', 'time');
    private duelEpithet = el('div', 'epithet');
    private duelVitality = new Line('vitality');
    private duelPosture = new Line('posture');
    private prompts = el('div', 'hud-prompts');
    private reveal = el('div', 'hud-reveal');
    private crosshair = el('div', 'hud-crosshair');
    private vignette = el('div', 'hud-vignette');
    private promptKey = '';
    private objectiveKey = '';
    private revealTimer = 0;

    constructor(private source: HudSource) {
        const style = el('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        this.root.id = 'r-hud';
        this.portraitHost.id = 'hud-portrait';

        const row = (icon: string, line: Line, cls = 'hud-row') => { const r = el('div', cls, icon); r.appendChild(line.root); return r; };
        this.postureRow.innerHTML = ICON.posture;
        this.postureRow.appendChild(this.posture.root);
        this.enso.innerHTML = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" stroke-width="2.2" stroke-dasharray="94.25" transform="rotate(-100 20 20)"/></svg>';
        this.ensoCircle = this.enso.querySelector('circle')!;
        this.enso.title = 'Composure';
        this.vitals.append(this.postureRow, row(ICON.vitality, this.vitality), row(ICON.stamina, this.stamina), this.enso);

        const t = el('div', 't', ICON.marker);
        t.appendChild(this.objectiveTitle);
        this.objective.append(t, this.objectiveText);

        const label = el('div', 'label');
        label.append(el('span', 'r-eyebrow', 'Duel'), this.duelName, this.duelTime);
        const lines = el('div', 'lines');
        lines.append(this.duelVitality.root, this.duelPosture.root);
        this.duel.append(label, this.duelEpithet, lines);

        this.root.append(this.vignette, this.objective, this.duel, this.prompts, this.reveal, this.crosshair, this.vitals, this.portraitHost);
        document.body.appendChild(this.root);
    }

    /** Large centred calligraphy: a duel's opening, a place reached. */
    showReveal(big: string, small = '', eyebrow = '', seconds = 3.4): void {
        this.reveal.className = 'hud-reveal';
        this.reveal.innerHTML = '';
        if (eyebrow) this.reveal.appendChild(el('div', 'r-eyebrow eyebrow', eyebrow));
        this.reveal.appendChild(el('div', 'big', big));
        if (small) this.reveal.appendChild(el('div', 'small', small));
        void this.reveal.offsetWidth;
        this.reveal.classList.add('is-shown');
        window.clearTimeout(this.revealTimer);
        this.revealTimer = window.setTimeout(() => this.reveal.classList.add('is-leaving'), seconds * 1000);
    }

    update(): void {
        uiState.tick();
        const p = this.source.player();
        const rival = this.source.rival();

        // Which gameplay layer applies: a duel once a rival has engaged and is near; combat while
        // the blade is out or a rival is close; otherwise exploration.
        const dueling = !!rival && rival.engaged && rival.distance < 9;
        uiState.setGameplay(dueling ? 'duel' : p.drawn || (rival && rival.distance < 12) ? 'combat' : 'explore');

        this.vitality.set(p.vitality / 100);
        this.stamina.set(p.stamina / 100);
        this.posture.set(p.posture / 100);
        this.postureRow.classList.toggle('is-idle', p.posture < 4);
        const low = p.vitality < 35 || p.stamina < 25;
        this.vitals.classList.toggle('is-low', low);
        this.vitals.classList.toggle('is-exhausted', p.stamina < 15);
        // Composure: a closed brush circle when calm; it opens and trembles as it breaks.
        this.ensoCircle.style.strokeDashoffset = String(94.25 * (1 - (0.12 + 0.88 * p.composure)));
        this.ensoCircle.style.opacity = String(0.35 + 0.6 * p.composure);
        this.enso.classList.toggle('is-shaken', p.composure < 0.35 && !settings.get('reducedMotion'));
        this.vignette.style.opacity = String(Math.max(0, 1 - p.vitality / 40) * 0.9);
        this.crosshair.classList.toggle('is-striking', p.phase === 'active');

        if (rival) {
            if (this.duelName.textContent !== rival.name) this.duelName.textContent = rival.name;
            if (this.duelEpithet.textContent !== rival.title) this.duelEpithet.textContent = rival.title;
            const s = Math.max(0, Math.floor(rival.since));
            const time = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
            if (this.duelTime.textContent !== time) this.duelTime.textContent = time;
            this.duelVitality.set(rival.vitality);
            this.duelPosture.set(rival.posture);
        }

        const o = this.source.objective();
        const ok = o ? o.title + '|' + o.text : '';
        if (ok !== this.objectiveKey) {
            this.objectiveKey = ok;
            this.objective.classList.toggle('is-empty', !o);
            if (o) { this.objectiveTitle.textContent = o.title; this.objectiveText.textContent = o.text; }
        }

        const prompts = settings.get('showHints') ? this.source.prompts() : [];
        const pk = prompts.map(x => x.key + x.label).join('|');
        if (pk !== this.promptKey) {
            this.promptKey = pk;
            this.prompts.replaceChildren(...prompts.map(x => {
                const d = el('div');
                d.append(document.createTextNode(x.label));
                const k = el('kbd', 'r-key');
                k.textContent = x.key;
                d.appendChild(k);
                return d;
            }));
        }
    }
}
