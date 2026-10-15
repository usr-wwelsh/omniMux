import { describe, it, expect } from 'vitest';
import { resolveSkipIntro, PERSONALITY_CONFIGS, rateFor } from './autodjEngine';

describe('resolveSkipIntro', () => {
  const club = PERSONALITY_CONFIGS.club;

  it('never skips past the track\'s own midpoint on a short track', () => {
    // A mistagged 17s jingle shouldn't get club's flat 45s skip-intro applied —
    // that seeks past the end of the track entirely.
    const skip = resolveSkipIntro(club, { duration: 17 });
    expect(skip).toBeLessThanOrEqual(17 / 2);
  });

  it('uses the configured skip-intro offset for a normal-length track', () => {
    expect(resolveSkipIntro(club, { duration: 200 })).toBe(45);
  });

  it('skips to the halfway point on tracks longer than 4 minutes', () => {
    expect(resolveSkipIntro(club, { duration: 500 })).toBe(250);
  });

  it('never skips personalities with no configured skip-intro', () => {
    expect(resolveSkipIntro(PERSONALITY_CONFIGS.none, { duration: 10 })).toBe(0);
  });
});

describe('rateFor', () => {
  it('speeds a 120 bpm track up to a 180 bpm target', () => {
    expect(rateFor(120, 180)).toBeCloseTo(1.5);
  });

  it('slows a faster track down to the target', () => {
    expect(rateFor(180, 120)).toBeCloseTo(2 / 3);
  });

  it('plays at native speed when no target is set', () => {
    expect(rateFor(120, null)).toBe(1);
  });

  it('plays at native speed when the track has no usable bpm', () => {
    expect(rateFor(undefined, 180)).toBe(1);
    expect(rateFor(0, 180)).toBe(1);
    expect(rateFor(NaN, 180)).toBe(1);
  });

  it('treats a half-time tagged track as double its tagged bpm', () => {
    expect(rateFor(60, 180)).toBeCloseTo(1.5);
  });

  it('treats a double-time tagged track as half its tagged bpm', () => {
    expect(rateFor(360, 180)).toBeCloseTo(1);
  });
});
