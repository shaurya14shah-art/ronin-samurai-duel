import { TRAINING, cleanTraining, type TechniqueId, type Training } from '@ronin/combat';

// The Way: what a swordsman has trained. Physical only: conditioning of the body, proficiency
// with long and short blades, and techniques (movements) learned and then mastered by use.
//
// Insight is earned in duels (a first victory over a rival teaches the most) and spent on
// training. Conditioning is bounded by the sim (three ranks of anything ≈ a tenth); the duel is
// still decided by the hands. Mastery comes only from doing: each technique that lands counts.

export type Rank = 'strength' | 'endurance' | 'defence' | 'footwork' | 'longBlade' | 'shortBlade';

export interface WayState {
    insight: number;
    /** Insight earned in all (spent + unspent): the measure of the road walked. */
    earned: number;
    ranks: Record<Rank, number>;
    known: TechniqueId[];
    /** Times each technique has landed. */
    uses: Partial<Record<TechniqueId, number>>;
    /** Rivals beaten at least once (a first win teaches more). */
    beaten: string[];
}

export interface WayNode {
    id: Rank | TechniqueId;
    kind: 'rank' | 'technique';
    branch: 'Body' | 'Blade' | 'Technique';
    name: string;
    jp?: string;
    text: string;
    /** For techniques: insight to learn it. Ranks cost their new rank (1, 2, 3). */
    cost?: number;
    requires?: Partial<Record<Rank, number>>;
    keys?: string;
}

export const MASTERY_USES = 40;
export const WIN_FIRST = 5;
export const WIN_AGAIN = 2;
export const WIN_ONLINE = 1;

const pct = (x: number) => `${Number((x * 100).toFixed(1))}%`;

export const NODES: WayNode[] = [
    { id: 'strength', kind: 'rank', branch: 'Body', name: 'Strength', jp: 'Chikara', text: `Hips and back behind the cut: each rank, cuts land ${pct(TRAINING.strength)} harder and press ${pct(TRAINING.strength)} more posture.` },
    { id: 'endurance', kind: 'rank', branch: 'Body', name: 'Endurance', jp: 'Jikyū', text: `Breath that lasts: each rank, stamina returns ${pct(TRAINING.endurance.regen)} faster and every action costs ${pct(TRAINING.endurance.cost)} less.` },
    { id: 'defence', kind: 'rank', branch: 'Body', name: 'Defence', jp: 'Mamori', text: `A frame that holds: each rank, ${pct(TRAINING.defence)} less posture lost to blocked or landed blows.` },
    { id: 'footwork', kind: 'rank', branch: 'Body', name: 'Footwork', jp: 'Ashisabaki', text: `Steps that cover ground: each rank, steps carry ${pct(TRAINING.footwork.distance)} further and cost ${pct(TRAINING.footwork.cost)} less.` },
    { id: 'longBlade', kind: 'rank', branch: 'Blade', name: 'Long blade', jp: 'Nodachi', text: `Training with heavy, long swords (nodachi, tachi): each rank removes ${pct(TRAINING.longBlade)} of the extra swing time a heavy blade costs.`, requires: { strength: 1 } },
    { id: 'shortBlade', kind: 'rank', branch: 'Blade', name: 'Short blade', jp: 'Kodachi', text: `Training with short swords (wakizashi, kodachi): with a blade under 65 cm, each rank widens the parry window by ${pct(TRAINING.shortBlade)}.`, requires: { footwork: 1 } },
    { id: 'wind_step', kind: 'technique', branch: 'Technique', name: 'Passing Step', jp: 'Okuri-tsuki', text: 'A long lunge that carries the body into a thrust from outside the opponent’s ideal range. Whiffed, it leaves you deep and slow to recover.', keys: '1, then C' },
    { id: 'iai', kind: 'technique', branch: 'Technique', name: 'Quick draw', jp: 'Iai', text: 'Draw and cut in a single motion, a third faster than an ordinary draw-cut. Attack from the scabbard to use it.', cost: 2, requires: { endurance: 1 }, keys: 'attack while sheathed' },
    { id: 'kesa_giri', kind: 'technique', branch: 'Technique', name: 'Kesa-giri', text: 'The whole body behind one diagonal from the shoulder: heavy, slow to start, and it drives through a held guard. Long recovery if it misses.', cost: 3, requires: { strength: 1 }, keys: '2, then C' },
    { id: 'void_step', kind: 'technique', branch: 'Technique', name: 'Void step', jp: 'Hiraki-tsuki', text: 'Step off the line of a cut and into a quick counter-thrust. Best against a committed attack, which cannot follow you.', cost: 3, requires: { footwork: 1 }, keys: '3, then C (hold A or D for the side)' },
    { id: 'maki_otoshi', kind: 'technique', branch: 'Technique', name: 'Binding parry', jp: 'Maki-otoshi', text: 'Meet the incoming blade and wind it down and out of line: the attacker is left further off balance than by a parry. The timing is tighter.', cost: 3, requires: { defence: 1 }, keys: 'hold F, press T' },
];

const RANKS: Rank[] = ['strength', 'endurance', 'defence', 'footwork', 'longBlade', 'shortBlade'];

export function freshWay(): WayState {
    return { insight: 0, earned: 0, ranks: { strength: 0, endurance: 0, defence: 0, footwork: 0, longBlade: 0, shortBlade: 0 }, known: ['wind_step'], uses: {}, beaten: [] };
}

/** What learning a node would cost now, or null if it cannot be learned (with the reason). */
export function price(state: WayState, node: WayNode): { cost: number } | { blocked: string } {
    for (const [r, need] of Object.entries(node.requires ?? {}) as [Rank, number][]) {
        if (state.ranks[r] < need) return { blocked: `Needs ${NODES.find(n => n.id === r)!.name} ${'I'.repeat(need)}` };
    }
    if (node.kind === 'rank') {
        const now = state.ranks[node.id as Rank];
        if (now >= TRAINING.maxRank) return { blocked: 'Fully trained' };
        return { cost: now + 1 };
    }
    if (state.known.includes(node.id as TechniqueId)) return { blocked: 'Known' };
    return { cost: node.cost ?? 0 };
}

/** Spend insight on a node. Returns the new state, or a reason it cannot be done. */
export function learn(state: WayState, id: WayNode['id']): WayState | string {
    const node = NODES.find(n => n.id === id);
    if (!node) return 'No such training.';
    const p = price(state, node);
    if ('blocked' in p) return p.blocked;
    if (state.insight < p.cost) return `Needs ${p.cost} insight`;
    const next: WayState = { ...state, insight: state.insight - p.cost, ranks: { ...state.ranks }, known: [...state.known] };
    if (node.kind === 'rank') next.ranks[node.id as Rank]++;
    else next.known.push(node.id as TechniqueId);
    return next;
}

export function mastery(state: WayState, t: TechniqueId): number {
    return Math.min(1, (state.uses[t] ?? 0) / MASTERY_USES);
}

/** The sim's view of this training. */
export function toTraining(state: WayState): Training {
    const m: Training['mastery'] = {};
    for (const t of state.known) m[t] = mastery(state, t);
    return cleanTraining({ ...state.ranks, known: state.known, mastery: m });
}

/** A duel won against a rival: a first victory over them teaches the most. */
export function earnWin(state: WayState, rivalId: string): { state: WayState; gained: number } {
    const first = !state.beaten.includes(rivalId);
    const gained = first ? WIN_FIRST : WIN_AGAIN;
    return { state: { ...state, insight: state.insight + gained, earned: state.earned + gained, beaten: first ? [...state.beaten, rivalId] : state.beaten }, gained };
}

/** An online round won (the server judged it). */
export function earnOnline(state: WayState): WayState {
    return { ...state, insight: state.insight + WIN_ONLINE, earned: state.earned + WIN_ONLINE };
}

/** A known technique landed. */
export function recordUse(state: WayState, t: TechniqueId): WayState {
    if (!state.known.includes(t)) return state;
    return { ...state, uses: { ...state.uses, [t]: Math.min(999, (state.uses[t] ?? 0) + 1) } };
}

/** Load a saved Way, refusing anything that could not have been earned. */
export function validateWay(raw: unknown): WayState {
    const fresh = freshWay();
    if (!raw || typeof raw !== 'object') return fresh;
    const r = raw as Partial<WayState>;
    const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
    const out = freshWay();
    for (const k of RANKS) out.ranks[k] = n(r.ranks?.[k], TRAINING.maxRank);
    out.known = Array.isArray(r.known) ? [...new Set(r.known.filter(k => NODES.some(x => x.id === k && x.kind === 'technique')))] as TechniqueId[] : fresh.known;
    if (!out.known.includes('wind_step')) out.known.unshift('wind_step');
    for (const t of out.known) out.uses[t] = n(r.uses?.[t], 999);
    out.beaten = Array.isArray(r.beaten) ? r.beaten.filter(b => typeof b === 'string').slice(0, 16) : [];
    // Spent insight must be covered by what was earned: ranks cost 1+2+3, techniques their price.
    const spent = RANKS.reduce((a, k) => a + (out.ranks[k] * (out.ranks[k] + 1)) / 2, 0)
        + out.known.reduce((a, t) => a + (NODES.find(x => x.id === t)?.cost ?? 0), 0);
    out.earned = Math.max(n(r.earned, 1e6), spent);
    out.insight = Math.min(n(r.insight, 1e6), out.earned - spent);
    return out;
}
