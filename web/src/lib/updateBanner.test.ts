import { describe, it, expect } from 'vitest';
import { pendingCommits, phaseLabel } from './updateBanner';

describe('pendingCommits', () => {
  it('returns the commit list when behind and error-free', () => {
    const status = {
      available: true,
      up_to_date: false,
      error: null,
      commits: [{ hash: 'abc1234', subject: 'fix: bug' }],
    };
    expect(pendingCommits(status)).toEqual([{ hash: 'abc1234', subject: 'fix: bug' }]);
  });

  it('hides the banner when the updater is not configured', () => {
    expect(pendingCommits({ available: false })).toEqual([]);
  });

  it('hides the banner when already up to date', () => {
    expect(pendingCommits({ available: true, up_to_date: true, commits: [] })).toEqual([]);
  });

  it('hides the banner when the host reported a git error', () => {
    expect(
      pendingCommits({ available: true, up_to_date: false, error: 'no upstream branch configured', commits: [] }),
    ).toEqual([]);
  });

  it('hides the banner when status is null', () => {
    expect(pendingCommits(null)).toEqual([]);
  });
});

describe('phaseLabel', () => {
  it('describes each known phase', () => {
    expect(phaseLabel('starting')).toBe('Starting update…');
    expect(phaseLabel('fetching')).toBe('Checking for updates…');
    expect(phaseLabel('pulling')).toBe('Pulling changes…');
    expect(phaseLabel('building')).toBe('Rebuilding (this can take a few minutes)…');
    expect(phaseLabel('done')).toBe('Update complete — reloading…');
    expect(phaseLabel('error')).toBe('Update failed');
  });

  it('falls back to a generic label for an unknown phase', () => {
    expect(phaseLabel('some-future-phase')).toBe('Updating…');
    expect(phaseLabel(undefined)).toBe('Updating…');
  });
});
