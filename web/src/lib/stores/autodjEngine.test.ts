import { describe, it, expect } from 'vitest';
import { resolveSkipIntro, PERSONALITY_CONFIGS } from './autodjEngine';

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
