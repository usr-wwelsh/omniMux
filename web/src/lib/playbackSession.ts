// Relaunching an installed PWA from the homescreen can navigate the app to its
// start_url, which throws away every in-memory store. Without a record of what was
// playing, startup looks like a fresh install: the queue comes back from the server
// but the track restarts from zero. We keep a small snapshot on disk so a cold start
// can pick playback up where it stopped.

export interface PlaybackSnapshot {
  trackId: string;
  index: number;
  position: number;
  playing: boolean;
  savedAt: number;
}

export const SESSION_KEY = 'omnimux-session';
// Past this, dropping back into a half-finished track is more confusing than helpful.
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// A track that had barely started is cheaper to replay than to seek into.
export const MIN_RESUME_SECONDS = 3;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveSession(snap: PlaybackSnapshot): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch {
    // Private mode / quota — resuming is a nicety, never a reason to fail.
  }
}

export function loadSession(): PlaybackSnapshot | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.trackId !== 'string' || !v.trackId) return null;
    if (typeof v.position !== 'number' || typeof v.savedAt !== 'number') return null;
    return {
      trackId: v.trackId,
      index: typeof v.index === 'number' ? v.index : -1,
      position: v.position,
      playing: v.playing === true,
      savedAt: v.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export interface ResumePlan {
  position: number;
  playing: boolean;
}

// How the given track should come back after a reload. Anything doubtful — another
// track, a stale snapshot, a nonsense position — starts silent from the beginning.
export function resumePlan(
  snap: PlaybackSnapshot | null,
  trackId: string,
  nowMs: number,
): ResumePlan {
  if (!snap || snap.trackId !== trackId) return { position: 0, playing: false };
  if (nowMs - snap.savedAt > SESSION_MAX_AGE_MS) return { position: 0, playing: false };
  const usable = Number.isFinite(snap.position) && snap.position >= MIN_RESUME_SECONDS;
  return { position: usable ? snap.position : 0, playing: snap.playing };
}
