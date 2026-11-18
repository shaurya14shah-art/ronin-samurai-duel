// The single authority on which interface layer is showing.
//
// Overlays (menus, death) are opened and closed explicitly. Gameplay states are reported every
// frame by the world. The highest-priority state wins and is written to <body data-ui=…>, so
// every component styles itself from one attribute instead of fighting over visibility:
//
//   title > death > settings > character > pause > forge > cinematic > duel > combat > explore

export type Overlay = 'title' | 'death' | 'settings' | 'character' | 'pause' | 'forge' | 'photo' | 'map' | 'multiplayer';
export type Gameplay = 'explore' | 'combat' | 'duel';
export type UIStateName = Overlay | 'cinematic' | Gameplay;

const OVERLAY_PRIORITY: Overlay[] = ['title', 'death', 'settings', 'character', 'map', 'multiplayer', 'pause', 'forge', 'photo'];

type Listener = (state: UIStateName, previous: UIStateName) => void;

class UIStateStore {
    private overlays = new Set<Overlay>();
    private gameplay: Gameplay = 'explore';
    private cinematicUntil = 0;
    private current: UIStateName = 'title';
    private listeners = new Set<Listener>();

    get state(): UIStateName { return this.current; }
    /** True when a menu or screen covers the world and play should be suspended. */
    get blocking(): boolean { return this.overlays.size > 0; }
    has(o: Overlay): boolean { return this.overlays.has(o); }

    open(o: Overlay): void { this.overlays.add(o); this.resolve(); }
    close(o: Overlay): void { this.overlays.delete(o); this.resolve(); }
    setGameplay(g: Gameplay): void { if (g !== this.gameplay) { this.gameplay = g; this.resolve(); } }
    /** Hold the cinematic layer (duel title, aftermath) for `seconds` of real time. */
    cinematic(seconds: number): void { this.cinematicUntil = performance.now() + seconds * 1000; this.resolve(); }
    tick(): void { if (this.current === 'cinematic' && performance.now() > this.cinematicUntil) this.resolve(); }

    on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    private resolve(): void {
        const overlay = OVERLAY_PRIORITY.find(o => this.overlays.has(o));
        const next: UIStateName = overlay ?? (performance.now() < this.cinematicUntil ? 'cinematic' : this.gameplay);
        if (next === this.current) return;
        const prev = this.current;
        this.current = next;
        if (typeof document !== 'undefined') document.body.dataset.ui = next;
        for (const fn of this.listeners) fn(next, prev);
    }
}

export const uiState = new UIStateStore();
if (typeof document !== 'undefined') document.body.dataset.ui = uiState.state;
