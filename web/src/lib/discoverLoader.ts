export const LOADER_WORDS = ['discovering', 'listening', 'digging', 'matching', 'curating', 'exploring', 'tuning in'];

export const LOADER_STAGES = [
  'Warming up the crate…',
  'Checking your listening history…',
  'Digging through similar artists…',
  'Matching genres and moods…',
  'Finding fresh picks…',
  'Almost there…',
];

export const PROGRESS_CAP = 92;
const EXPECTED_MS = 12000;
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*@?';
const FRAMES_PER_LETTER = 2;

export function progressAt(elapsedMs: number): number {
  return PROGRESS_CAP * (1 - Math.exp((-3 * elapsedMs) / EXPECTED_MS));
}

export function stageFor(progress: number): string {
  const i = Math.floor((progress / PROGRESS_CAP) * LOADER_STAGES.length);
  return LOADER_STAGES[Math.min(LOADER_STAGES.length - 1, Math.max(0, i))];
}

export function scrambleFrame(word: string, frame: number, rand: () => number): { text: string; revealed: number } {
  const revealed = Math.min(word.length, Math.floor(frame / FRAMES_PER_LETTER));
  const text = [...word]
    .map((c, i) => (i < revealed || c === ' ' ? c : GLYPHS[Math.floor(rand() * GLYPHS.length)]))
    .join('');
  return { text, revealed };
}

export function nextWord(current: string, rand: () => number): string {
  const others = LOADER_WORDS.filter((w) => w !== current);
  return others[Math.floor(rand() * others.length)];
}
