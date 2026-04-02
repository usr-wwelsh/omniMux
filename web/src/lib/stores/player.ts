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

let audio: HTMLAudioElement | null = null;

let _pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePushQueue() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const myId = get(localDeviceId);
    if (!myId) return;
    const tracks = get(queue);
    const index = get(queueIndex);
    try {
      await api.setQueue(tracks, index, myId);
    } catch {}
  }, 150);
}

// Called by devices.ts when polling the server queue
export function applyServerQueueState(
  tracks: Track[],
  index: number,
  serverActiveDevice: string | null,
) {
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
    // Apply remote index change (another device skipped)
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
  if (index !== localIdx) {
    queueIndex.set(index);
    if (index >= 0 && index < tracks.length) {
      currentTrack.set(tracks[index]);
    }
  }
}

function getAudio(): HTMLAudioElement {
  if (!audio && typeof window !== 'undefined') {
    audio = new Audio();
    audio.addEventListener('timeupdate', () => currentTime.set(audio!.currentTime));
    audio.addEventListener('durationchange', () => duration.set(audio!.duration || 0));
    audio.addEventListener('ended', () => playNext());
    audio.addEventListener('pause', () => isPlaying.set(false));
    audio.addEventListener('play', () => isPlaying.set(true));
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

export function playTrack(track: Track) {
  const a = getAudio();
  const myId = get(localDeviceId);
  if (myId) activeDeviceId.set(myId);
  currentTrack.set(track);
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
  if (tracks[startIndex]) {
    playTrack(tracks[startIndex]);
  }
  schedulePushQueue();
}

export function togglePlay() {
  const a = getAudio();
  if (a.paused) {
    a.play();
  } else {
    a.pause();
  }
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

  if (loopMode === 'one') {
    playTrack(q[idx]);
    schedulePushQueue();
    return;
  }

  if (shuffleOn && q.length > 1) {
    let next;
    do { next = Math.floor(Math.random() * q.length); } while (next === idx);
    queueIndex.set(next);
    playTrack(q[next]);
    schedulePushQueue();
    return;
  }

  if (idx < q.length - 1) {
    const next = idx + 1;
    queueIndex.set(next);
    playTrack(q[next]);
    schedulePushQueue();
  } else if (loopMode === 'all') {
    queueIndex.set(0);
    playTrack(q[0]);
    schedulePushQueue();
  } else {
    isPlaying.set(false);
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
    queueIndex.set(prev);
    playTrack(get(queue)[prev]);
    schedulePushQueue();
  }
}

export function addToQueue(track: Track) {
  queue.update((q) => [...q, track]);
  schedulePushQueue();
}

export async function addSongToQueue(song: Song) {
  const track = await songToTrack(song);
  queue.update((q) => [...q, track]);
  schedulePushQueue();
}

export function removeFromQueue(index: number) {
  const q = get(queue);
  const idx = get(queueIndex);
  const newQ = [...q];
  newQ.splice(index, 1);
  queue.set(newQ);

  if (newQ.length === 0) {
    queueIndex.set(-1);
    isPlaying.set(false);
  } else if (index === idx) {
    const next = Math.min(idx, newQ.length - 1);
    queueIndex.set(next);
    playTrack(newQ[next]);
  } else if (index < idx) {
    queueIndex.set(idx - 1);
  }
  schedulePushQueue();
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
  schedulePushQueue();
}

export function jumpToQueue(index: number) {
  const q = get(queue);
  if (index >= 0 && index < q.length) {
    queueIndex.set(index);
    playTrack(q[index]);
    schedulePushQueue();
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
