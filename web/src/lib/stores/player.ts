import { writable, derived, get } from 'svelte/store';
import { streamUrl, coverArtUrl, type Song } from '../subsonic';

export interface Track {
  id: string;
  title: string;
  artist: string;
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

let audio: HTMLAudioElement | null = null;

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
    return;
  }

  if (shuffleOn && q.length > 1) {
    let next;
    do { next = Math.floor(Math.random() * q.length); } while (next === idx);
    queueIndex.set(next);
    playTrack(q[next]);
    return;
  }

  if (idx < q.length - 1) {
    const next = idx + 1;
    queueIndex.set(next);
    playTrack(q[next]);
  } else if (loopMode === 'all') {
    queueIndex.set(0);
    playTrack(q[0]);
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
  }
}

export function addToQueue(track: Track) {
  queue.update((q) => [...q, track]);
}

export async function addSongToQueue(song: Song) {
  const track = await songToTrack(song);
  queue.update((q) => [...q, track]);
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
}

export function jumpToQueue(index: number) {
  const q = get(queue);
  if (index >= 0 && index < q.length) {
    queueIndex.set(index);
    playTrack(q[index]);
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
