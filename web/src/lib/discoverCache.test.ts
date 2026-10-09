import { describe, it, expect, beforeEach } from 'vitest';
import type { DiscoverResult } from './api';
import { recallDiscover, rememberDiscover, clearDiscover, DISCOVER_TTL_MS } from './discoverCache';

const track: DiscoverResult = { artist: 'a', title: 't', image_url: '', score: 1, seed_artist: 's' };

beforeEach(clearDiscover);

describe('discover cache', () => {
  it('has nothing before the first load', () => {
    expect(recallDiscover(0)).toBeNull();
  });

  it('returns what was remembered while fresh', () => {
    rememberDiscover([track], new Map([['a|t', 'u']]), 1000);
    const hit = recallDiscover(1000 + DISCOVER_TTL_MS - 1);
    expect(hit?.suggestions).toEqual([track]);
    expect(hit?.images.get('a|t')).toBe('u');
  });

  it('expires after the ttl', () => {
    rememberDiscover([track], new Map(), 1000);
    expect(recallDiscover(1000 + DISCOVER_TTL_MS)).toBeNull();
  });
});
