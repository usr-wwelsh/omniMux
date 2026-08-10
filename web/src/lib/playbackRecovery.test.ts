import { describe, it, expect } from 'vitest';
import {
  backoffDelay,
  advancedPast,
  STALL_PROGRESS_SECONDS,
  HEALTHY_PLAYBACK_SECONDS,
  MAX_RECOVERY_DELAY_MS,
} from './playbackRecovery';

describe('recovery backoff', () => {
  it('retries quickly the first time something stalls', () => {
    expect(backoffDelay(0)).toBe(1500);
  });

  it('waits longer after each reload that did not stick', () => {
    expect(backoffDelay(1)).toBeGreaterThan(backoffDelay(0));
    expect(backoffDelay(2)).toBeGreaterThan(backoffDelay(1));
  });

  it('stops growing so a dead connection still gets periodic retries', () => {
    expect(backoffDelay(50)).toBe(MAX_RECOVERY_DELAY_MS);
  });

  it('treats a nonsense attempt count as the first attempt', () => {
    expect(backoffDelay(-3)).toBe(1500);
  });
});

describe('playback progress', () => {
  it('sees a track that buffered through the stall on its own', () => {
    expect(advancedPast(30, 30.9, STALL_PROGRESS_SECONDS)).toBe(true);
  });

  it('sees a track that is stuck where it stalled', () => {
    expect(advancedPast(30, 30.05, STALL_PROGRESS_SECONDS)).toBe(false);
  });

  it('does not call a backwards jump progress', () => {
    expect(advancedPast(30, 12, STALL_PROGRESS_SECONDS)).toBe(false);
  });

  it('waits for sustained playback before calling a recovery healthy', () => {
    expect(advancedPast(30, 31, HEALTHY_PLAYBACK_SECONDS)).toBe(false);
    expect(advancedPast(30, 36, HEALTHY_PLAYBACK_SECONDS)).toBe(true);
  });
});
