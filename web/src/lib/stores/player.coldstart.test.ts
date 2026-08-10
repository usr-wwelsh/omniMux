import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Track } from './player';

vi.mock('../subsonic', () => ({
  streamUrl: async (id: string) => `/stream/${id}`,
  coverArtUrl: async () => undefined,
  fetchItunesArtwork: async () => null,
  subsonic: { scrobble: async () => {} },
}));
vi.mock('../auth', () => ({ auth: writable({ authenticated: true, role: 'admin' }) }));
vi.mock('../api', () => ({ api: { setQueue: async () => ({}) } }));

// jsdom ships no localStorage, and its <audio> can't play — stand both up here.
const stored = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});

class FakeAudio extends EventTarget {
  src = '';
  volume = 1;
  currentTime = 0;
  duration = 0;
  paused = true;
  playbackRate = 1;
  readyState = 0;
  playCalls = 0;
  play() {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  load() {}
}
let lastAudio: FakeAudio;
vi.stubGlobal('Audio', function Audio(this: unknown) {
  lastAudio = new FakeAudio();
  return lastAudio;
});

const TRACK: Track = {
  id: 't1', title: 'Blue in Green', artist: 'Miles Davis', artistId: 'ar1',
  album: 'Kind of Blue', albumId: 'al1', duration: 337, streamUrl: '/stream/t1',
};

// Fresh module per test: the cold-start snapshot is read once at import, exactly
// as it is on a page load.
async function freshPlayer(session: unknown) {
  stored.clear();
  if (session) stored.set('omnimux-session', JSON.stringify(session));
  vi.resetModules();
  const player = await import('./player');
  player.localDeviceId.set('me');
  return player;
}

const playing = (position: number) => ({
  trackId: 't1', index: 0, position, playing: true, savedAt: Date.now(),
});

describe('first server queue after a page load', () => {
  beforeEach(() => vi.resetModules());

  it('picks the track up where the last session left it', async () => {
    const player = await freshPlayer(playing(61.5));
    player.applyServerQueueState([TRACK], 0, 'me', null, null, 1);

    lastAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(lastAudio.src).toBe('/stream/t1');
    expect(lastAudio.currentTime).toBe(61.5);
    expect(lastAudio.playCalls).toBe(1);
  });

  it('restores the queue around it', async () => {
    const player = await freshPlayer(playing(61.5));
    const second: Track = { ...TRACK, id: 't2', streamUrl: '/stream/t2' };
    player.applyServerQueueState([TRACK, second], 0, 'me', null, null, 1);

    expect(get(player.queue).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(get(player.queueIndex)).toBe(0);
    expect(get(player.currentTrack)?.id).toBe('t1');
    expect(get(player.currentTime)).toBe(61.5);
  });

  it('leaves a track the session never saw at the start', async () => {
    const player = await freshPlayer(null);
    player.applyServerQueueState([TRACK], 0, 'me', null, null, 1);

    lastAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(lastAudio.currentTime).toBe(0);
  });

  it('does not start playing when the session was paused', async () => {
    const player = await freshPlayer({ ...playing(61.5), playing: false });
    player.applyServerQueueState([TRACK], 0, 'me', null, null, 1);

    expect(lastAudio.playCalls).toBe(0);
    lastAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(lastAudio.currentTime).toBe(61.5);
  });

  it('stays silent when another device owns playback', async () => {
    const player = await freshPlayer(playing(61.5));
    player.applyServerQueueState([TRACK], 0, 'other-device', null, null, 1);

    expect(lastAudio.playCalls).toBe(0);
  });

  it('still restarts a track the way a later remote change should', async () => {
    const player = await freshPlayer(playing(61.5));
    // First poll is the restore; a later one is another device skipping tracks.
    player.applyServerQueueState([TRACK], 0, 'me', null, null, 1);
    const second: Track = { ...TRACK, id: 't2', streamUrl: '/stream/t2' };
    player.applyServerQueueState([TRACK, second], 1, 'me', null, null, 2);

    expect(lastAudio.src).toBe('/stream/t2');
    lastAudio.dispatchEvent(new Event('loadedmetadata'));
    expect(lastAudio.currentTime).toBe(0);
  });
});
