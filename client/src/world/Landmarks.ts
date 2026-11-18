import type { PersonalityName } from '@ronin/combat';
import type { RivalId } from './JourneySave';

// The named places of the mountain roads and the swordsmen who keep them.

export interface Landmark {
    id: RivalId;
    name: string;
    description: string;
    rivalName: string;
    title: string;
    x: number;
    z: number;
    personality: PersonalityName;
    robe: number;
    hakama: number;
}

/** The forge courtyard at the centre of the world. */
export const COURTYARD = { name: 'Forge Courtyard', description: 'A swept clearing, a shelter, an anvil and a fire that is never quite out. The roads begin here.', x: 0, z: 0 };

export const LANDMARKS: Landmark[] = [
    { id: 'shrine', description: 'An old bell hangs under a hall that leans with the years. Someone rings it at dusk who is never seen arriving.', name: 'Evening Bell Shrine', rivalName: 'Ren of the Bell', title: 'The one who waits', x: -70, z: 16, personality: 'patient', robe: 0x2a3346, hakama: 0x2c2c30 },
    { id: 'hamlet', description: 'Reed roofs and drying racks by the paddies. The villagers have learned not to watch the woman at the edge of the field.', name: 'Reed Hamlet', rivalName: 'Aya of the Reeds', title: 'The pressing tide', x: 55, z: -44, personality: 'aggressive', robe: 0x4a2a24, hakama: 0x2a2420 },
    { id: 'bridge', description: 'A stone crossing older than any road that leads to it. A man sits on its rail and waits for someone to try.', name: 'Old Stone Crossing', rivalName: 'Jiro of the Crossing', title: 'The empty hand', x: 76, z: 10, personality: 'counter', robe: 0x3a3a36, hakama: 0x1e1e20 },
    { id: 'battlefield', description: 'Banners that no one carries any more, faded to the colour of straw. One soldier never left.', name: 'Field of Quiet Banners', rivalName: 'Sora of the Banners', title: 'The last one standing', x: 0, z: 78, personality: 'survivor', robe: 0x4a4430, hakama: 0x34302a },
    { id: 'bamboo', description: 'Bamboo so tall the light arrives green. Every sound carries; so does every mistake.', name: 'Whispering Bamboo', rivalName: 'Kaede of the Grove', title: 'The patient teacher', x: 0, z: -70, personality: 'teacher', robe: 0x24342c, hakama: 0x23262a },
];
