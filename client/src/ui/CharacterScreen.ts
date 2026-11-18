import { STANCES, ATTACKS, COST, type Duelist, type Stance } from '@ronin/combat';
import type { Weapon } from '../forge/RecipeManager';
import { CharacterPortrait } from './CharacterPortrait';
import { uiState } from './UIState';
import type { JournalEntry } from '../world/Journal';
import { MASTERY_USES, NODES, mastery, price, type WayNode, type WayState } from '../progression/Way';

// Character screen: the figure on the left (drag to turn it), what you carry and know on the
// right. Every value shown comes from the live game: the inventory, the sim's stance and
// technique tables, and each rival's remembered encounters.

export interface CharacterSource {
    player(): Duelist;
    weapons(): Weapon[];
    activeWeapon(): number;
    equip(index: number): void;
    rivals(): { name: string; title: string; place: string; record: { encounters: number; wins: number; falls: number }; dormant: boolean }[];
    journal(): JournalEntry[];
    way(): WayState;
    /** Spend insight; null on success, else why not. */
    train(id: WayNode['id']): string | null;
}

const KIND_LABEL: Record<JournalEntry['kind'], string> = { place: 'Place', rival: 'Met', duel: 'Duel', fall: 'Fell', forge: 'Forge', online: 'Online', train: 'Training' };

const STANCE_TEXT: Record<Stance, [string, string]> = {
    middle: ['Chūdan', 'The centre line. Quick thrusts, a wider parry window, no weakness to exploit.'],
    high: ['Jōdan', 'Blade raised. Overheads and diagonals come faster and reach further, but the body is open.'],
    low: ['Gedan', 'Point lowered. Low cuts and thrusts come early and steps carry further; the overhead is slow.'],
    fluid: ['Waki', 'Blade carried to the side. Horizontal cuts arrive sooner and steps cost less; the guard is shallow.'],
    empty: ['Mugamae', 'No guard at all. An invitation: the parry window widens and breath returns quickly.'],
};

const CSS = `
#r-character { z-index: 45; pointer-events: none; background: radial-gradient(ellipse at 30% 55%, rgba(30,28,22,.55), rgba(5,5,4,.94) 70%); }
#r-character.is-open { pointer-events: auto; }
#r-character .stage { position: absolute; left: 3vw; top: 6vh; bottom: 4vh; width: 38vw; }
#r-character .stage .caption { position: absolute; left: 3vw; bottom: 2vh; }
#r-character .stage .caption .name { font: 400 calc(30px * var(--ui-scale)) var(--font-brush); }
#r-character nav { position: absolute; left: 44vw; top: 9vh; display: flex; gap: 34px; }
#r-character nav button { all: unset; cursor: pointer; font: 500 calc(12px * var(--ui-scale)) var(--font-sans); letter-spacing: .32em; text-transform: uppercase; color: var(--ivory-faint); padding-bottom: 10px; border-bottom: 1px solid transparent; transition: color var(--fast), border-color var(--mid); }
#r-character nav button[aria-selected="true"], #r-character nav button:hover { color: var(--ivory); border-color: var(--gold); }
#r-character .page { position: absolute; left: 44vw; right: 5vw; top: 17vh; bottom: 10vh; overflow-y: auto; scrollbar-width: thin; }
#r-character .page > * { animation: r-ink .7s var(--ease) both; }
#r-character .close { position: absolute; right: 5vw; top: 8.5vh; }
#r-character .foot { position: absolute; left: 44vw; bottom: 5vh; display: flex; gap: 22px; }
#r-character .item { display: grid; grid-template-columns: 1fr auto; gap: 6px 20px; padding: 18px 0; border-bottom: 1px solid var(--line); }
#r-character .item h3 { margin: 0; font: 500 calc(22px * var(--ui-scale)) var(--font-serif); letter-spacing: .06em; }
#r-character .item .r-body { grid-column: 1 / -1; margin: 0; }
#r-character .item.is-active h3::before { content: ""; display: inline-block; width: 7px; height: 7px; margin: 0 12px 3px 0; transform: rotate(45deg); background: var(--gold); }
#r-character .item button { all: unset; cursor: pointer; font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .25em; text-transform: uppercase; color: var(--gold); }
#r-character .attrs { grid-column: 1 / -1; display: grid; grid-template-columns: auto 1fr auto; gap: 8px 16px; align-items: center; margin-top: 10px; max-width: 520px; }
#r-character .attrs .bar { height: 2px; background: var(--line); }
#r-character .attrs .bar i { display: block; height: 100%; background: var(--ivory-dim); }
#r-character .attrs em { font: italic calc(14px * var(--ui-scale)) var(--font-serif); color: var(--ivory-dim); }
#r-character .tag { font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .25em; text-transform: uppercase; color: var(--ivory-faint); align-self: center; }
#r-character .note { margin-top: 22px; }
#r-character .way-head { display: flex; align-items: baseline; gap: 14px; padding-bottom: 8px; }
#r-character .way-head .way-n { font: 400 calc(40px * var(--ui-scale)) var(--font-brush); color: var(--gold); }
#r-character .item h3 .jp { font: italic 400 calc(14px * var(--ui-scale)) var(--font-serif); color: var(--ivory-faint); margin-left: 12px; letter-spacing: .02em; }
#r-character .item button[disabled] { color: var(--ivory-faint); cursor: default; }
`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

export class CharacterScreen {
    readonly root = h('section', 'r-layer r-screen r-grain');
    private stage = h('div', 'stage');
    private page = h('div', 'page');
    private nav = h('nav');
    private portrait: CharacterPortrait | null = null;
    private tab: 'gear' | 'stances' | 'way' | 'rivals' | 'journal' = 'gear';
    onClose: () => void = () => {};

    constructor(private source: CharacterSource) {
        const s = h('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-character';
        const caption = h('div', 'caption');
        caption.append(h('div', 'r-eyebrow', 'Wandering swordsman'), h('div', 'name', 'The Rōnin'));
        this.stage.appendChild(caption);
        for (const [id, label] of [['gear', 'Gear'], ['stances', 'Stances'], ['way', 'The Way'], ['rivals', 'Rivals'], ['journal', 'Journal']] as const) {
            const b = h('button', '', label);
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.addEventListener('click', () => { this.tab = id; this.render(); });
            b.dataset.tab = id;
            this.nav.appendChild(b);
        }
        const close = h('div', 'close r-menu');
        const back = h('button', '', 'Return');
        back.type = 'button';
        back.addEventListener('click', () => this.onClose());
        close.appendChild(back);
        const foot = h('div', 'foot r-micro');
        foot.innerHTML = 'Drag the figure to turn it &nbsp;·&nbsp; <kbd class="r-key">Esc</kbd> return';
        this.root.append(this.stage, this.nav, this.page, close, foot);
        document.body.appendChild(this.root);
        this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.onClose(); } });
    }

    get isOpen(): boolean { return this.root.classList.contains('is-open'); }

    open(): void {
        if (!this.portrait) this.portrait = new CharacterPortrait(this.stage, { fps: 60, interactive: true, framing: 'full' });
        this.portrait.active = true;
        this.render();
        this.root.classList.add('is-open');
        uiState.open('character');
        (this.nav.querySelector('button') as HTMLElement).focus({ preventScroll: true });
    }

    close(): void {
        this.root.classList.remove('is-open');
        if (this.portrait) this.portrait.active = false;
        uiState.close('character');
    }

    update(dt: number): void {
        if (this.isOpen) this.portrait?.update(this.source.player(), dt);
    }

    private render(): void {
        this.nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
        this.page.replaceChildren(...this[this.tab]());
    }

    private gear(): HTMLElement[] {
        const weapons = this.source.weapons();
        const active = this.source.activeWeapon();
        return weapons.map((w, i) => {
            const item = h('div', `item${i === active ? ' is-active' : ''}`);
            item.appendChild(h('h3', '', w.name));
            if (i === active) item.appendChild(h('span', 'tag', 'Carried'));
            else {
                const b = h('button', '', 'Carry');
                b.type = 'button';
                b.addEventListener('click', () => { this.source.equip(i); this.render(); });
                item.appendChild(b);
            }
            const g = w.geometry;
            const s = w.stats as unknown as Record<string, number>;
            const describe = g
                ? `${g.bladeLength} cm of ${g.curvature > 2.2 ? 'deeply curved' : g.curvature > 1.4 ? 'gently curved' : 'nearly straight'} steel, a ${g.tsukaLength} cm grip, ${g.hamonPattern} temper line.`
                : 'A plain katana, honest and well kept. Forge your own at the courtyard.';
            item.appendChild(h('p', 'r-body', describe));
            const attrs = h('div', 'attrs');
            const row = (label: string, v: number, word: string) => {
                const bar = h('div', 'bar');
                const fill = h('i');
                fill.style.width = `${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%`;
                bar.appendChild(fill);
                attrs.append(h('span', 'r-micro', label), bar, h('em', '', word));
            };
            const reach = (g?.bladeLength ?? 74) / 100;
            row('Reach', (reach - 0.45) / 0.8, reach > 0.85 ? 'long' : reach > 0.65 ? 'measured' : 'close');
            if (Number.isFinite(s.weight)) row('Weight', (s.weight - 0.6) / 1.8, s.weight > 1.6 ? 'heavy in the hand' : s.weight > 1.0 ? 'balanced' : 'light');
            if (Number.isFinite(s.balancePointCm)) row('Balance', 1 - s.balancePointCm / 40, s.balancePointCm < 12 ? 'close to the hand' : 'forward');
            if (Number.isFinite(s.durability)) row('Toughness', s.durability / 100, s.durability > 70 ? 'forgiving' : 'brittle');
            item.appendChild(attrs);
            return item;
        });
    }

    private stances(): HTMLElement[] {
        const current = this.source.player().stance;
        const items = (Object.keys(STANCE_TEXT) as Stance[]).map(st => {
            const item = h('div', `item${st === current ? ' is-active' : ''}`);
            item.append(h('h3', '', `${STANCE_TEXT[st][0]}`), h('span', 'tag', st === current ? 'Held' : st));
            item.appendChild(h('p', 'r-body', STANCE_TEXT[st][1]));
            const def = STANCES[st];
            const facts: string[] = [];
            if (def.parryWindow !== 1) facts.push(`parry window ×${def.parryWindow}`);
            if (def.blockCap < 1) facts.push(def.blockCap === 0 ? 'no guard' : 'shallow guard');
            if (def.staminaRegen !== 1) facts.push(`breath ×${def.staminaRegen}`);
            if (def.stepDistance !== 1) facts.push(`step ×${def.stepDistance}`);
            if (facts.length) item.appendChild(h('p', 'r-micro', facts.join('  ·  ')));
            return item;
        });
        const note = h('p', 'r-micro note');
        note.innerHTML = 'Change stance in play with <kbd class="r-key">V</kbd>. The change takes a moment, and in that moment there is no guard.';
        return [...items, note];
    }

    /** Training: the body, the blade, and techniques. Everything here is physical. */
    private way(): HTMLElement[] {
        const w = this.source.way();
        const out: HTMLElement[] = [];
        const head = h('div', 'way-head');
        head.append(h('span', 'r-eyebrow', 'Insight'), h('span', 'way-n', String(w.insight)), h('span', 'r-micro', `to spend  ·  ${w.earned} earned on the road  ·  won in duels; a first victory over a rival teaches the most`));
        out.push(head);
        const numeral = (n: number) => ['—', 'I', 'II', 'III'][n] ?? String(n);
        for (const branch of ['Body', 'Blade', 'Technique'] as const) {
            out.push(h('div', 'r-eyebrow note', branch === 'Body' ? 'The body' : branch === 'Blade' ? 'The blade' : 'Techniques'));
            for (const node of NODES.filter(n => n.branch === branch)) {
                const item = h('div', 'item');
                const title = h('h3', '', node.name);
                if (node.jp) title.appendChild(h('span', 'jp', node.jp));
                const p = price(w, node);
                let status: string;
                if (node.kind === 'rank') status = `Rank ${numeral(w.ranks[node.id as keyof WayState['ranks']])} of III`;
                else if (w.known.includes(node.id as never)) {
                    const m = mastery(w, node.id as never);
                    status = m >= 1 ? 'Mastered' : m >= 0.5 ? 'Seasoned' : m > 0 ? 'Practised' : 'Learned';
                } else status = 'Not learned';
                item.append(title, h('span', 'tag', status));
                item.appendChild(h('p', 'r-body', node.text));
                const foot = h('p', 'r-micro');
                if (node.kind === 'technique' && w.known.includes(node.id as never)) {
                    const uses = w.uses[node.id as never] ?? 0;
                    foot.textContent = `${node.keys ? `${node.keys}  ·  ` : ''}landed ${Math.min(uses, MASTERY_USES)} of ${MASTERY_USES} times toward mastery (quicker and cheaper as it grows)`;
                    item.appendChild(foot);
                } else {
                    if ('blocked' in p) foot.textContent = p.blocked;
                    else {
                        const b = h('button', '', `Train · ${p.cost} insight`);
                        b.type = 'button';
                        if (w.insight < p.cost) { b.disabled = true; b.title = 'Not enough insight yet'; }
                        b.addEventListener('click', () => {
                            const why = this.source.train(node.id);
                            if (why) foot.textContent = why; else this.render();
                        });
                        foot.appendChild(b);
                        if (node.keys && node.kind === 'technique') foot.appendChild(h('span', 'keys', `  ·  ${node.keys}`));
                    }
                    item.appendChild(foot);
                }
                out.push(item);
            }
        }
        out.push(h('p', 'r-micro note', 'Conditioning is deliberately small: three ranks of anything are worth about a tenth. The duel is decided by your hands. Online duels use no conditioning, and every technique is open to both fighters.'));
        return out;
    }

    private rivals(): HTMLElement[] {
        return this.source.rivals().map(r => {
            const item = h('div', 'item');
            item.append(h('h3', '', r.name), h('span', 'tag', r.dormant ? 'Recovering' : r.record.encounters ? 'Met' : 'Unmet'));
            item.appendChild(h('p', 'r-body', `${r.title}. Found at ${r.place}.`));
            const { encounters, wins, falls } = r.record;
            item.appendChild(h('p', 'r-micro', encounters
                ? `Crossed blades ${encounters} ${encounters === 1 ? 'time' : 'times'}  ·  you prevailed ${falls}  ·  they prevailed ${wins}  ·  they remember how you fight`
                : 'You have not yet crossed blades.'));
            return item;
        });
    }

    private journal(): HTMLElement[] {
        const entries = this.source.journal();
        if (!entries.length) return [h('p', 'r-body note', 'Nothing written yet. The journal fills as things happen: places reached, swordsmen met, duels, blades forged.')];
        const out: HTMLElement[] = [];
        let day = '';
        for (const e of entries) {
            const d = new Date(e.t);
            const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
            if (label !== day) { day = label; out.push(h('div', 'r-eyebrow note', label)); }
            const item = h('div', 'item');
            item.append(h('p', 'r-body', e.text), h('span', 'tag', `${KIND_LABEL[e.kind]} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`));
            item.querySelector('.r-body')!.setAttribute('style', 'grid-column: 1; margin: 0;');
            out.push(item);
        }
        return out;
    }
}
