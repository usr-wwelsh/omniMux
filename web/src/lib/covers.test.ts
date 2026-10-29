import { describe, it, expect, beforeEach } from 'vitest';
import { applyCoverOverrides, hasCoverOverride, coverVersion, resetCoverOverrides } from './covers';
import { coverArtUrl } from './subsonic';

beforeEach(() => resetCoverOverrides());

describe('cover overrides', () => {
  it('knows which albums have a custom cover', () => {
    applyCoverOverrides({ albums: ['a1'], version: 5 });

    expect(hasCoverOverride('a1')).toBe(true);
    expect(hasCoverOverride('a2')).toBe(false);
  });

  it('puts the override version on every cover url so cached art is refetched', async () => {
    applyCoverOverrides({ albums: ['a1'], version: 5 });

    expect(await coverArtUrl('al-a1_x', 300)).toContain(`ov=${coverVersion()}`);
  });

  it('treats a missing albumId as having no override', () => {
    applyCoverOverrides({ albums: ['a1'], version: 5 });

    expect(hasCoverOverride(undefined)).toBe(false);
  });
});
