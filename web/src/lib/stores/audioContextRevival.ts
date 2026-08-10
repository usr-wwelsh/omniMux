// Once an <audio> element is routed through an AudioContext (createMediaElementSource),
// a suspended context means total silence — the element keeps playing, currentTime keeps
// advancing, no pause event, no error, the lock-screen notification still says "playing".
// Browsers suspend on hide, and Safari flips to 'interrupted' on a call or screen lock.
// Waiting for the page to come back to the foreground means the music is simply gone until
// the listener opens the app, so resume on every signal we get and keep retrying: a hidden
// page may refuse the first resume outright.

export interface RevivableContext {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

export interface RevivableAudio {
  readonly paused: boolean;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

const DEAD_STATES = new Set(['suspended', 'interrupted']);
const AUDIO_EVENTS = ['play', 'playing', 'timeupdate'];

export function reviveAudioContext(
  ctx: RevivableContext,
  audio: RevivableAudio,
  { retryMs = 1000 }: { retryMs?: number } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function attempt() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (disposed) return;
    // The context only has to be awake while the element wants to make sound.
    if (audio.paused || !DEAD_STATES.has(ctx.state)) return;
    ctx.resume().catch(() => {});
    timer = setTimeout(attempt, retryMs);
  }

  ctx.addEventListener('statechange', attempt);
  for (const type of AUDIO_EVENTS) audio.addEventListener(type, attempt);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', attempt);

  return () => {
    disposed = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    ctx.removeEventListener('statechange', attempt);
    for (const type of AUDIO_EVENTS) audio.removeEventListener(type, attempt);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', attempt);
  };
}
