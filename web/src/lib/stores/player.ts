import { writable, derived, get } from 'svelte/store';
import { streamUrl, coverArtUrl, type Song } from '../subsonic';
import { api } from '../api';

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  coverArt?: string;
  duration: number;
  streamUrl?: string;
  coverUrl?: string;
}

export const currentTrack = writable<Track | null>(null);
export const queue = writable<Track[]>([]);
export const queueIndex = writable<number>(-1);
export const isPlaying = writable(false);
export const currentTime = writable(0);
export const duration = writable(0);
export const volume = writable(1);
export const shuffle = writable(false);
export const loop = writable<'none' | 'all' | 'one'>('none');

// Which device is currently playing audio (server-synced)
export const activeDeviceId = writable<string | null>(null);
// This device's own ID (set by devices.ts on startup)
export const localDeviceId = writable<string>('');
// When true, this device ignores server queue sync entirely
export const soloMode = writable<boolean>(
  typeof localStorage !== 'undefined' && localStorage.getItem('omnimux-solo') === '1'
);
soloMode.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('omnimux-solo', v ? '1' : '0');
});

let audio: HTMLAudioElement | null = null;

let _pushTimer: ReturnType<typeof setTimeout> | null = null;

// activeId: the device that should own playback after this push.
// Pass localDeviceId to claim ownership, or pass the current activeDeviceId to preserve it.
function schedulePushQueue(activeId: string) {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const myId = get(localDeviceId);
    if (!myId || get(soloMode)) return;
    const tracks = get(queue);
    const index = get(queueIndex);
    try {
      await api.setQueue(tracks, index, activeId);
    } catch {}
  }, 150);
}

// Returns the current active device ID, falling back to this device if none set.
function activeOrMe(): string {
  return get(activeDeviceId) || get(localDeviceId);
}

// Returns true if this device should be playing audio.
function isThisDeviceActive(): boolean {
  if (get(soloMode)) return true;
  const active = get(activeDeviceId);
  return !active || active === get(localDeviceId);
}

// Called by devices.ts when polling the server queue
export function applyServerQueueState(
  tracks: Track[],
  index: number,
  serverActiveDevice: string | null,
) {
  if (get(soloMode)) return;
  const myId = get(localDeviceId);
  activeDeviceId.set(serverActiveDevice);

  if (serverActiveDevice === myId) {
    // We're active — apply remote track-list changes (e.g. another device added a song)
    const localTracks = get(queue);
    const changed =
      localTracks.length !== tracks.length ||
      localTracks.some((t, i) => t.id !== tracks[i]?.id);
    if (changed) {
      queue.set(tracks);
      const localIdx = get(queueIndex);
      if (localIdx >= tracks.length) queueIndex.set(tracks.length - 1);
    }
    // Apply remote index change (another device skipped / played a new queue)
    const localIdx = get(queueIndex);
    if (index !== localIdx && index >= 0 && index < tracks.length) {
      queueIndex.set(index);
      playTrack(tracks[index]);
    }
    return;
  }

  // Not the active device — sync display, silence audio
  if (tracks.length === 0) return;
  if (audio && !audio.paused) {
    audio.pause();
    isPlaying.set(false);
  }
  const localTracks = get(queue);
  const tracksChanged =
    localTracks.length !== tracks.length ||
    localTracks.some((t, i) => t.id !== tracks[i]?.id);
  if (tracksChanged) queue.set(tracks);
  const localIdx = get(queueIndex);
  if (index !== localIdx || tracksChanged) {
    queueIndex.set(index);
    if (index >= 0 && index < tracks.length) {
      const t = tracks[index];
      currentTrack.set(t);
      // Pre-load audio src so "Play here" can start instantly
      if (t.streamUrl) {
        const a = getAudio();
        if (a.src !== t.streamUrl) a.src = t.streamUrl;
      }
    }
  }
}

function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return;
  const artwork: MediaImage[] = [];
  if (track.coverUrl) {
    // Must be an absolute URL — the OS fetches artwork outside the page context
    const abs = new URL(track.coverUrl, window.location.href).href;
    artwork.push({ src: abs, sizes: '300x300', type: 'image/jpeg' });
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork
  });
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => {
    const myId = get(localDeviceId);
    if (myId) activeDeviceId.set(myId);
    getAudio().play();
    schedulePushQueue(myId || activeOrMe());
  });
  navigator.mediaSession.setActionHandler('pause', () => getAudio().pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
  navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined) getAudio().currentTime = details.seekTime;
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    const a = getAudio();
    a.currentTime = Math.min(a.duration, a.currentTime + (details.seekOffset ?? 10));
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    const a = getAudio();
    a.currentTime = Math.max(0, a.currentTime - (details.seekOffset ?? 10));
  });
}

function getAudio(): HTMLAudioElement {
  if (!audio && typeof window !== 'undefined') {
    audio = new Audio();
    audio.addEventListener('timeupdate', () => {
      currentTime.set(audio!.currentTime);
      if ('mediaSession' in navigator && audio!.duration) {
        navigator.mediaSession.setPositionState({
          duration: audio!.duration,
          playbackRate: audio!.playbackRate,
          position: audio!.currentTime
        });
      }
    });
    audio.addEventListener('durationchange', () => duration.set(audio!.duration || 0));
    audio.addEventListener('ended', () => playNext());
    audio.addEventListener('pause', () => {
      isPlaying.set(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });
    audio.addEventListener('play', () => {
      isPlaying.set(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });
    setupMediaSession();
  }
  return audio!;
}

export async function songToTrack(song: Song): Promise<Track> {
  const sUrl = await streamUrl(song.id);
  const cUrl = song.coverArt ? await coverArtUrl(song.coverArt) : undefined;
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    artistId: song.artistId,
    album: song.album,
    albumId: song.albumId,
    coverArt: song.coverArt,
    duration: song.duration,
    streamUrl: sUrl,
    coverUrl: cUrl,
  };
}

export async function playSong(song: Song) {
  const track = await songToTrack(song);
  playTrack(track);
}

// playTrack always claims this device as active and starts audio.
// Only call this when you intend to actually play audio here.
export function playTrack(track: Track) {
  const a = getAudio();
  const myId = get(localDeviceId);
  if (myId) activeDeviceId.set(myId);
  currentTrack.set(track);
  updateMediaSession(track);
  if (track.streamUrl) {
    a.src = track.streamUrl;
    a.volume = get(volume);
    a.play();
  }
}

export async function playQueue(songs: Song[], startIndex = 0) {
  const tracks = await Promise.all(songs.map(songToTrack));
  queue.set(tracks);
  queueIndex.set(startIndex);
  if (isThisDeviceActive()) {
    // Play here and claim ownership
    if (tracks[startIndex]) playTrack(tracks[startIndex]);
    schedulePushQueue(get(localDeviceId));
  } else {
    // Send to the active device — update queue/index but don't steal audio
    if (tracks[startIndex]) currentTrack.set(tracks[startIndex]);
    schedulePushQueue(activeOrMe());
  }
}

export function togglePlay() {
  const a = getAudio();
  if (a.paused) {
    // Pressing play is an explicit intent to play on this device — claim active
    const myId = get(localDeviceId);
    if (myId) activeDeviceId.set(myId);
    a.play();
    schedulePushQueue(myId || activeOrMe());
  } else {
    a.pause();
  }
}

// Explicitly transfer audio playback to this device
export function claimPlayback() {
  const myId = get(localDeviceId);
  if (!myId) return;
  activeDeviceId.set(myId);
  const a = getAudio();
  if (a.src) {
    a.volume = get(volume);
    a.play();
  } else {
    const track = get(currentTrack);
    if (track?.streamUrl) {
      a.src = track.streamUrl;
      a.volume = get(volume);
      a.play();
    }
  }
  schedulePushQueue(myId);
}

export function seek(time: number) {
  const a = getAudio();
  a.currentTime = time;
}

export function setVolume(v: number) {
  volume.set(v);
  const a = getAudio();
  a.volume = v;
}

export function playNext() {
  const q = get(queue);
  const idx = get(queueIndex);
  const loopMode = get(loop);
  const shuffleOn = get(shuffle);
  const active = isThisDeviceActive();

  function playOrRoute(track: Track, newIdx: number) {
    queueIndex.set(newIdx);
    if (active) {
      playTrack(track);
      schedulePushQueue(get(localDeviceId));
    } else {
      currentTrack.set(track);
      schedulePushQueue(activeOrMe());
    }
  }

  if (loopMode === 'one') {
    playOrRoute(q[idx], idx);
    return;
  }

  if (shuffleOn && q.length > 1) {
    let next;
    do { next = Math.floor(Math.random() * q.length); } while (next === idx);
    playOrRoute(q[next], next);
    return;
  }

  if (idx < q.length - 1) {
    playOrRoute(q[idx + 1], idx + 1);
  } else if (loopMode === 'all') {
    playOrRoute(q[0], 0);
  } else {
    if (active) isPlaying.set(false);
  }
}

export function toggleShuffle() {
  shuffle.update((s) => !s);
}

export function cycleLoop() {
  loop.update((l) => l === 'none' ? 'all' : l === 'all' ? 'one' : 'none');
}

export function playPrev() {
  const a = getAudio();
  if (a && a.currentTime > 3) {
    a.currentTime = 0;
    return;
  }
  const idx = get(queueIndex);
  if (idx > 0) {
    const prev = idx - 1;
    const track = get(queue)[prev];
    queueIndex.set(prev);
    if (isThisDeviceActive()) {
      playTrack(track);
      schedulePushQueue(get(localDeviceId));
    } else {
      currentTrack.set(track);
      schedulePushQueue(activeOrMe());
    }
  }
}

export function addToQueue(track: Track) {
  queue.update((q) => [...q, track]);
  schedulePushQueue(activeOrMe()); // never steals active
}

export async function addSongToQueue(song: Song) {
  const track = await songToTrack(song);
  queue.update((q) => [...q, track]);
  schedulePushQueue(activeOrMe()); // never steals active
}

export function removeFromQueue(index: number) {
  const q = get(queue);
  const idx = get(queueIndex);
  const newQ = [...q];
  newQ.splice(index, 1);
  queue.set(newQ);

  if (newQ.length === 0) {
    queueIndex.set(-1);
    if (isThisDeviceActive()) isPlaying.set(false);
  } else if (index === idx) {
    const next = Math.min(idx, newQ.length - 1);
    queueIndex.set(next);
    if (isThisDeviceActive()) {
      playTrack(newQ[next]);
    } else {
      currentTrack.set(newQ[next]);
    }
  } else if (index < idx) {
    queueIndex.set(idx - 1);
  }
  schedulePushQueue(activeOrMe());
}

export function reorderQueue(from: number, to: number) {
  if (from === to) return;
  const idx = get(queueIndex);
  const newQ = [...get(queue)];
  const [item] = newQ.splice(from, 1);
  newQ.splice(to, 0, item);
  queue.set(newQ);

  if (idx === from) {
    queueIndex.set(to);
  } else if (from < to && idx > from && idx <= to) {
    queueIndex.set(idx - 1);
  } else if (from > to && idx >= to && idx < from) {
    queueIndex.set(idx + 1);
  }
  schedulePushQueue(activeOrMe());
}

export function jumpToQueue(index: number) {
  const q = get(queue);
  if (index >= 0 && index < q.length) {
    queueIndex.set(index);
    if (isThisDeviceActive()) {
      playTrack(q[index]);
      schedulePushQueue(get(localDeviceId));
    } else {
      currentTrack.set(q[index]);
      schedulePushQueue(activeOrMe());
    }
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
