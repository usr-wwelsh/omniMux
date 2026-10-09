import { describe, it, expect } from 'vitest';
import { progressAt, stageFor, scrambleFrame, nextWord, LOADER_WORDS, LOADER_STAGES, PROGRESS_CAP } from './discoverLoader';

describe('discover loader progress', () => {
  it('starts at zero', () => {
    expect(progressAt(0)).toBe(0);
  });

  it('only moves forward', () => {
    expect(progressAt(4000)).toBeGreaterThan(progressAt(2000));
  });

  it('never claims completion before the response lands', () => {
    expect(progressAt(10 * 60_000)).toBeLessThanOrEqual(PROGRESS_CAP);
    expect(PROGRESS_CAP).toBeLessThan(100);
  });
});

describe('discover loader stages', () => {
  it('begins on the first stage', () => {
    expect(stageFor(0)).toBe(LOADER_STAGES[0]);
  });

  it('ends on the last stage at the progress cap', () => {
    expect(stageFor(PROGRESS_CAP)).toBe(LOADER_STAGES[LOADER_STAGES.length - 1]);
  });
});

describe('discover loader scramble', () => {
  const rand = () => 0;

  it('shows only noise on the first frame', () => {
    expect(scrambleFrame('discovering', 0, rand).revealed).toBe(0);
  });

  it('keeps the word length while scrambling', () => {
    expect(scrambleFrame('discovering', 5, rand).text).toHaveLength('discovering'.length);
  });

  it('reveals the full word once enough frames pass', () => {
    const f = scrambleFrame('discovering', 100, rand);
    expect(f.text).toBe('discovering');
    expect(f.revealed).toBe('discovering'.length);
  });
});

describe('discover loader words', () => {
  it('never repeats the current word', () => {
    for (let i = 0; i < LOADER_WORDS.length; i++) {
      expect(nextWord(LOADER_WORDS[i], () => 0)).not.toBe(LOADER_WORDS[i]);
    }
  });

  it('picks randomly from the list', () => {
    expect(LOADER_WORDS).toContain(nextWord('discovering', Math.random));
  });
});
