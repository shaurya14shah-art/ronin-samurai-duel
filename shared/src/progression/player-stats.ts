export type StatName = 'strength' | 'agility' | 'vitality' | 'focus' | 'technique';

export type PlayerStats = Record<StatName, number>;

export const INITIAL_PLAYER_STATS: PlayerStats = {
  strength: 1.0,
  agility: 1.0,
  vitality: 1.0,
  focus: 1.0,
  technique: 1.0,
};

// Represents an action that causes stat growth
export interface StatGainEvent {
  stat: StatName;
  amount: number; // e.g., 0.01 for gradual progression
}

/**
 * Increment a stat by a specific float value, maintaining gradual organic growth.
 */
export function addStatGain(stats: PlayerStats, event: StatGainEvent): PlayerStats {
  const current = stats[event.stat] ?? 1.0;
  return {
    ...stats,
    // Avoid floating point precision issues by rounding to 4 decimal places
    [event.stat]: Number((current + event.amount).toFixed(4))
  };
}

/**
 * Computes integer effective level for a stat (e.g., floor of the float stat)
 * Often used to determine if a threshold has been reached.
 */
export function getEffectiveStatLevel(statValue: number): number {
  return Math.floor(statValue);
}
