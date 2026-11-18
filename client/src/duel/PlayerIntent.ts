import type { ActiveTechnique, AttackDir, DuelistInput, Line, Stance } from '@ronin/combat';
import { InputSystem } from '../core/InputSystem';

const STANCE_ORDER: Stance[] = ['middle', 'high', 'low', 'fluid', 'empty'];
const FLICK = 9;

/**
 * Turns mouse and keyboard into DuelistInput, the only thing the sim accepts from a player.
 * Attack direction comes from the mouse flick that precedes the click (the arc follows the
 * gesture); with no flick it falls back to movement, then to the stance's natural cut.
 */
export class PlayerIntent {
    private gesture = { x: 0, y: 0 };
    private pending: Partial<DuelistInput> = {};
    private guardLine: Line = 'center';
    private cycleStance = false;
    public enabled = true;
    /** The technique the technique key performs (chosen with 1–3). */
    public selected: ActiveTechnique = 'wind_step';
    public static readonly SLOTS: ActiveTechnique[] = ['wind_step', 'kesa_giri', 'void_step'];

    constructor(private input: InputSystem) {
        // Only a captured pointer is a sword hand: menu clicks must never become cuts.
        input.on('mousedown', () => { if (this.live()) this.queueAttack(false); });
        input.on('rightmousedown', () => { if (this.live()) this.pending.feint = true; });
        input.on('middlemousedown', () => { if (this.live()) this.pending.technique = this.selected; });
        input.on('keydown', (code: string) => {
            if (!this.live()) return;
            switch (code) {
                case 'KeyR': this.queueAttack(true); break;
                case 'KeyB': this.pending.feint = true; break;
                // T parries; T while guarding (F held) binds the blade instead (maki-otoshi, once learned).
                case 'KeyT': if (this.input.isKeyPressed('KeyF')) this.pending.bind = true; else this.pending.parry = true; break;
                case 'KeyC': this.pending.technique = this.selected; break;
                case 'Digit1': case 'Digit2': case 'Digit3': this.selected = PlayerIntent.SLOTS[Number(code.slice(5)) - 1]; break;
                case 'KeyX': this.pending.draw = true; break;
                case 'KeyV': this.cycleStance = true; break;
                case 'KeyQ': case 'Space': this.queueStep(); break;
                case 'KeyF': this.guardLine = 'center'; break;
            }
        });
        input.on('pointerlockchange', (locked: boolean) => { if (!locked) this.clear(); });
    }

    private live(): boolean {
        return this.enabled && this.input.isPointerLocked;
    }

    /** Call once per rendered frame, before input deltas are cleared. */
    public frame(): void {
        const d = this.input.mouseDelta;
        this.gesture.x = this.gesture.x * 0.72 + d.x;
        this.gesture.y = this.gesture.y * 0.72 + d.y;
        const l = Math.hypot(this.gesture.x, this.gesture.y);
        if (l > 200) { this.gesture.x *= 200 / l; this.gesture.y *= 200 / l; }
        if (this.input.isKeyPressed('KeyF') && l >= FLICK) {
            const g = this.gesture;
            this.guardLine = Math.abs(g.y) > Math.abs(g.x) ? (g.y < 0 ? 'high' : 'low') : (g.x < 0 ? 'left' : 'right');
        }
    }

    /** Build this tick's input. One-shot intents are consumed by the first tick that reads them. */
    public build(facing: number, stance: Stance): DuelistInput {
        const m = this.input.getMovementVector();
        const out: DuelistInput = {
            move: { x: m.x, z: -m.z },
            facing,
            guard: this.enabled && this.input.isKeyPressed('KeyF'),
            guardLine: this.guardLine,
        };
        if (!this.enabled) { this.clear(); return out; }
        const p = this.pending;
        if (p.attack) out.attack = p.attack;
        if (p.technique) out.technique = p.technique;
        if (p.feint) out.feint = true;
        if (p.parry) out.parry = true;
        if (p.bind) { out.bind = true; out.parry = true; }
        if (p.step) out.step = p.step;
        if (p.draw) out.draw = true;
        if (this.cycleStance) out.stance = STANCE_ORDER[(STANCE_ORDER.indexOf(stance) + 1) % STANCE_ORDER.length];
        this.pending = {};
        this.cycleStance = false;
        return out;
    }

    public clear(): void {
        this.pending = {};
        this.cycleStance = false;
        this.gesture.x = this.gesture.y = 0;
    }

    private queueAttack(committed: boolean): void {
        this.pending.attack = { dir: this.direction(), committed };
        this.gesture.x = this.gesture.y = 0;
    }

    private queueStep(): void {
        const m = this.input.getMovementVector();
        // Standing still, the step is a retreat.
        this.pending.step = m.lengthSq() > 0 ? { x: m.x, z: -m.z } : { x: 0, z: -1 };
    }

    private direction(): AttackDir {
        const g = this.gesture;
        if (Math.hypot(g.x, g.y) >= FLICK) {
            const ax = Math.abs(g.x), ay = Math.abs(g.y);
            if (ay > ax * 1.6) return g.y < 0 ? 'overhead' : 'low';
            // Sweeping right cuts from the left shoulder; a downward slant makes it a diagonal.
            const diagonal = g.y > ax * 0.35;
            if (g.x > 0) return diagonal ? 'diag_l' : 'horiz_l';
            return diagonal ? 'diag_r' : 'horiz_r';
        }
        if (this.input.isKeyPressed('KeyW')) return 'thrust';
        return 'diag_l';
    }
}
