import { PlayerStats, getEffectiveStatLevel } from './player-stats.js';

export interface StatRequirement {
  stat: keyof PlayerStats;
  threshold: number; // The integer threshold required
}

export interface Epiphany {
  id: string;
  name: string;
  description: string;
  requirements: StatRequirement[];
  unlockedMoveId: string;
}

export const EPIPHANIES: Epiphany[] = [
  {
    id: 'epiphany_flowing_water_strike',
    name: 'Flowing Water Strike',
    description: 'A smooth, unblockable strike that requires both agility and technique.',
    requirements: [
      { stat: 'agility', threshold: 5 },
      { stat: 'technique', threshold: 3 }
    ],
    unlockedMoveId: 'move_flowing_water'
  },
  {
    id: 'epiphany_iron_mountain_block',
    name: 'Iron Mountain Block',
    description: 'A solid defensive stance rooted in vitality and strength.',
    requirements: [
      { stat: 'strength', threshold: 4 },
      { stat: 'vitality', threshold: 6 }
    ],
    unlockedMoveId: 'move_iron_mountain'
  },
  {
    id: 'epiphany_void_step',
    name: 'Void Step',
    description: 'A mystical evasion technique demanding supreme focus and agility.',
    requirements: [
      { stat: 'agility', threshold: 8 },
      { stat: 'focus', threshold: 7 }
    ],
    unlockedMoveId: 'move_void_step'
  }
];

/**
 * Check which epiphanies a player has unlocked based on their current stats.
 * Returns an array of newly unlocked epiphanies.
 */
export function getNewlyUnlockedEpiphanies(stats: PlayerStats, alreadyUnlockedIds: string[] = []): Epiphany[] {
  return EPIPHANIES.filter(epiphany => {
    // Skip if they already unlocked it
    if (alreadyUnlockedIds.includes(epiphany.id)) {
      return false; 
    }

    // Check if player meets all stat requirements for this epiphany
    return epiphany.requirements.every(req => {
      const effectiveLevel = getEffectiveStatLevel(stats[req.stat]);
      return effectiveLevel >= req.threshold;
    });
  });
}
