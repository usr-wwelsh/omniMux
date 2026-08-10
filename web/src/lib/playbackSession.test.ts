import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSession,
  loadSession,
  clearSession,
  resumePlan,
  SESSION_KEY,
  SESSION_MAX_AGE_MS,
  MIN_RESUME_SECONDS,
} from './playbackSession';

const NOW = 1_700_000_000_000;

// jsdom ships no localStorage, so stand one up at the boundary the module reads.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

describe('playback session storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads back what was playing before the app was closed', () => {
    saveSession({ trackId: 'abc', index: 4, position: 61.5, playing: true, savedAt: NOW });
    expect(loadSession()).toEqual({
      trackId: 'abc', index: 4, position: 61.5, playing: true, savedAt: NOW,
    });
  });

  it('has nothing to restore before anything has played', () => {
    expect(loadSession()).toBeNull();
  });

  it('survives a corrupt entry rather than breaking startup', () => {
    window.localStorage.setItem(SESSION_KEY, '{not json');
    expect(loadSession()).toBeNull();
  });

  it('rejects an entry that is missing the fields it needs', () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ position: 30 }));
    expect(loadSession()).toBeNull();
  });

  it('forgets the session once playback is stopped', () => {
    saveSession({ trackId: 'abc', index: 0, position: 30, playing: true, savedAt: NOW });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe('resuming after a reload', () => {
  const snap = { trackId: 'abc', index: 4, position: 61.5, playing: true, savedAt: NOW };

  it('picks up where the listener left off', () => {
    expect(resumePlan(snap, 'abc', NOW + 5_000)).toEqual({ position: 61.5, playing: true });
  });

  it('stays paused when the app was closed on a paused track', () => {
    expect(resumePlan({ ...snap, playing: false }, 'abc', NOW)).toEqual({ position: 61.5, playing: false });
  });

  it('starts a different track from the beginning', () => {
    expect(resumePlan(snap, 'xyz', NOW + 5_000)).toEqual({ position: 0, playing: false });
  });

  it('starts from the beginning when there is no saved session', () => {
    expect(resumePlan(null, 'abc', NOW)).toEqual({ position: 0, playing: false });
  });

  it('ignores a session old enough that resuming would be a surprise', () => {
    expect(resumePlan(snap, 'abc', NOW + SESSION_MAX_AGE_MS + 1)).toEqual({ position: 0, playing: false });
  });

  it('does not bother seeking into a track that had barely started', () => {
    const barely = { ...snap, position: MIN_RESUME_SECONDS - 0.1 };
    expect(resumePlan(barely, 'abc', NOW)).toEqual({ position: 0, playing: true });
  });

  it('treats a nonsense position as the beginning', () => {
    expect(resumePlan({ ...snap, position: NaN }, 'abc', NOW).position).toBe(0);
    expect(resumePlan({ ...snap, position: -20 }, 'abc', NOW).position).toBe(0);
  });

  it('resumes a clock that ran backwards rather than discarding the session', () => {
    expect(resumePlan(snap, 'abc', NOW - 60_000).position).toBe(61.5);
  });
});
