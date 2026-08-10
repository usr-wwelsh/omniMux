// Recovering from a stall re-mints the stream and reloads the audio element, which
// costs the listener about a second of silence. A backgrounded tab stalls over and
// over, so recovery has to back off — otherwise every reload buys one second of
// audio before the next stall reloads it again.

const BASE_RECOVERY_DELAY_MS = 1500;
export const MAX_RECOVERY_DELAY_MS = 30_000;

// How far the element must have moved past a stall to count as buffering through it
export const STALL_PROGRESS_SECONDS = 0.25;
// How long a reloaded stream must hold before the backoff resets to fast retries
export const HEALTHY_PLAYBACK_SECONDS = 5;
// How long a single recovery attempt may stay in flight before it is written off
export const RECOVERY_TIMEOUT_MS = 15_000;

export function backoffDelay(consecutiveAttempts: number): number {
  const n = Math.max(0, consecutiveAttempts);
  return Math.min(BASE_RECOVERY_DELAY_MS * 2 ** n, MAX_RECOVERY_DELAY_MS);
}

export function advancedPast(from: number, now: number, seconds: number): boolean {
  return now - from > seconds;
}
