// Player settings: persisted, and each one bound to the system it actually changes.
// Systems subscribe with `settings.watch(key, apply)`; there are no decorative toggles.

export interface SettingValues {
    masterVolume: number;
    mouseSensitivity: number;
    screenShake: number;
    reducedMotion: boolean;
    uiScale: number;
    showHints: boolean;
    showPortrait: boolean;
    renderScale: number;
    shadows: boolean;
}

export const DEFAULTS: SettingValues = {
    masterVolume: 0.8,
    mouseSensitivity: 1,
    screenShake: 1,
    reducedMotion: false,
    uiScale: 1,
    showHints: true,
    showPortrait: true,
    renderScale: 1,
    shadows: true,
};

const KEY = 'ronin.settings.v1';

type Watcher<K extends keyof SettingValues> = (value: SettingValues[K]) => void;

class SettingsStore {
    private values: SettingValues = { ...DEFAULTS };
    private watchers = new Map<keyof SettingValues, Set<Watcher<any>>>();

    constructor() {
        try {
            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
            if (raw) {
                const parsed = JSON.parse(raw);
                for (const k of Object.keys(DEFAULTS) as (keyof SettingValues)[]) {
                    if (typeof parsed?.[k] === typeof DEFAULTS[k]) (this.values as any)[k] = parsed[k];
                }
            }
        } catch { /* unreadable settings fall back to defaults */ }
    }

    get<K extends keyof SettingValues>(key: K): SettingValues[K] {
        return this.values[key];
    }

    set<K extends keyof SettingValues>(key: K, value: SettingValues[K]): void {
        this.values[key] = value;
        try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* private mode */ }
        for (const fn of this.watchers.get(key) ?? []) fn(value);
    }

    /** Subscribe and apply the current value immediately. */
    watch<K extends keyof SettingValues>(key: K, fn: Watcher<K>): void {
        if (!this.watchers.has(key)) this.watchers.set(key, new Set());
        this.watchers.get(key)!.add(fn);
        fn(this.values[key]);
    }

    reset(): void {
        for (const k of Object.keys(DEFAULTS) as (keyof SettingValues)[]) this.set(k, DEFAULTS[k] as never);
    }
}

export const settings = new SettingsStore();

// Interface-only settings apply themselves.
if (typeof document !== 'undefined') {
    settings.watch('uiScale', v => document.documentElement.style.setProperty('--ui-scale', String(v)));
    settings.watch('reducedMotion', v => document.body.classList.toggle('reduced-motion', v));
    settings.watch('showHints', v => document.body.classList.toggle('no-hints', !v));
    settings.watch('showPortrait', v => document.body.classList.toggle('no-portrait', !v));
}
