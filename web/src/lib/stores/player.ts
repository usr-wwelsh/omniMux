import { writable, derived, get } from 'svelte/store';
import { streamUrl, coverArtUrl, fetchItunesArtwork, type Song } from '../subsonic';
import { api } from '../api';

export interface DJMeta {
  bpm: number;      // score contribution 0–3
  energy: number;   // score contribution 0–2
  harmonic: boolean;
}

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
  hqCoverUrl?: string;
  bpm?: number;
  djMeta?: DJMeta;
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
let crossfadeAudio: HTMLAudioElement | null = null;
let _isCrossfading = false;
let _crossfadeTimerId: ReturnType<typeof setTimeout> | null = null;
let _crossfadeChecker: ((ct: number, dur: number) => void) | null = null;

export function registerCrossfadeChecker(fn: ((ct: number, dur: number) => void) | null) {
  _crossfadeChecker = fn;
}

// Call this inside a user-gesture handler to unlock crossfadeAudio for autoplay.
// Without this, Safari (and strict-autoplay Chrome) may silently reject the first cf.play().
export function warmUpCrossfadeAudio() {
  if (typeof window === 'undefined') return;
  if (!crossfadeAudio) crossfadeAudio = new Audio();
  crossfadeAudio.play().catch(() => {});
  crossfadeAudio.pause();
}

let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _crossfadeSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let _artworkFetchToken = 0; // incremented on each track change to cancel stale artwork fetches
// Tracks the seek_issued_at of the last remote seek we applied, to avoid re-applying
let _lastAppliedSeekIssuedAt = 0;
// Suppress server index changes for this window after a crossfade completes
let _crossfadeBlackoutUntil = 0;
const CROSSFADE_BLACKOUT_MS = 2000;
// Last confirmed server queue version — used for optimistic locking
let _knownQueueVersion = 0;
// Suppress poll-driven queue overwrites while a batch fill is in progress
export const suppressQueuePollApply = writable(false);

// Shared push logic — handles 409 version conflict with one refetch-and-retry
async function _doPushQueue(activeId: string, retryOnConflict = true): Promise<void> {
  const myId = get(localDeviceId);
  if (!myId || get(soloMode)) return;
  const tracks = get(queue);
  const index = get(queueIndex);
  try {
    const result = await api.setQueue(tracks, index, activeId, undefined, undefined, _knownQueueVersion);
    if (result.conflict && result.serverVersion !== undefined) {
      _knownQueueVersion = result.serverVersion;
      if (retryOnConflict) {
        await _doPushQueue(activeId, false); // one retry, no further recursion
      }
      return;
    }
    if (result.queue_version !== undefined) {
      _knownQueueVersion = result.queue_version;
    }
  } catch (e) {
    console.warn('[omniMux] Failed to push queue to server:', e);
  }
}

// activeId: the device that should own playback after this push.
// Pass localDeviceId to claim ownership, or pass the current activeDeviceId to preserve it.
function schedulePushQueue(activeId: string) {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => _doPushQueue(activeId), 150);
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
  seekTo: number | null = null,
  seekIssuedAt: number | null = null,
  queueVersion: number = 0,
) {
  if (get(soloMode)) return;
  if (get(suppressQueuePollApply)) return;
  // Track the latest confirmed server version for optimistic locking
  if (queueVersion > 0) _knownQueueVersion = queueVersion;
  const myId = get(localDeviceId);
  activeDeviceId.set(serverActiveDevice);

  if (serverActiveDevice === myId) {
    // We're active — apply remote track-list changes (e.g. another device added a song)
    const localTracks = get(queue);
    const changed =
      localTracks.length !== tracks.length ||
      localTracks.some((t, i) => t.id !== tracks[i]?.id);
    if (changed) {
      const curIdx = get(queueIndex);
      const prevTrackId = localTracks[curIdx]?.id;
      queue.set(tracks);
      if (curIdx >= tracks.length) queueIndex.set(tracks.length - 1);
      // Same index but different track — another device replaced the queue at this position
      if (index === curIdx && index >= 0 && index < tracks.length &&
          tracks[index].id !== prevTrackId) {
        playTrack(tracks[index]);
        return;
      }
    }
    // Apply remote index change (another device skipped / played a new queue).
    // Skip during a crossfade or within the blackout window after one — the local index
    // is already ahead of the server because the push is debounced; applying stale server
    // state here would revert the crossfade and replay the previous track.
    const localIdx = get(queueIndex);
    const now = Date.now();
    if (!_isCrossfading && now > _crossfadeBlackoutUntil && index !== localIdx && index >= 0 && index < tracks.length) {
      queueIndex.set(index);
      playTrack(tracks[index]);
    }
    // Apply remote seek command from another device
    if (seekTo !== null && seekIssuedAt !== null && seekIssuedAt > _lastAppliedSeekIssuedAt) {
      _lastAppliedSeekIssuedAt = seekIssuedAt;
      seek(seekTo);
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
    artwork.push(
      { src: abs, sizes: '96x96' },
      { src: abs, sizes: '128x128' },
      { src: abs, sizes: '192x192' },
      { src: abs, sizes: '256x256' },
      { src: abs, sizes: '512x512' },
    );
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

export function getAudio(): HTMLAudioElement {
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
      _crossfadeChecker?.(audio!.currentTime, audio!.duration);
    });
    audio.addEventListener('durationchange', () => duration.set(audio!.duration || 0));
    audio.addEventListener('ended', () => { if (!_isCrossfading) playNext(); });
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
  const [sUrl, cUrl] = await Promise.all([
    streamUrl(song.id),
    song.coverArt ? coverArtUrl(song.coverArt) : Promise.resolve(undefined),
  ]);
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
    bpm: song.bpm,
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
  // Fetch HQ art in the background — doesn't block playback.
  // Token prevents a slow response from an earlier track clobbering the current one.
  if (!track.hqCoverUrl) {
    const token = ++_artworkFetchToken;
    fetchItunesArtwork(track.artist, track.album).then((url) => {
      if (!url || token !== _artworkFetchToken) return;
      if (get(currentTrack)?.id === track.id) {
        currentTrack.update((t) => t ? { ...t, hqCoverUrl: url } : t);
      }
    });
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

// Sends a seek command to the active device (when this device is not the player)
export function seekOnActiveDevice(time: number) {
  const activeId = get(activeDeviceId);
  if (!activeId) return;
  const tracks = get(queue);
  const index = get(queueIndex);
  const issuedAt = Date.now(); // millisecond precision to prevent ordering issues within the same second
  // Optimistically update local display
  currentTime.set(time);
  try {
    api.setQueue(tracks, index, activeId, time, issuedAt);
  } catch {}
}

export function setVolume(v: number) {
  volume.set(v);
  if (!_isCrossfading) {
    const a = getAudio();
    a.volume = v;
  }
}

export function playNext() {
  if (_isCrossfading) return;
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

export function clearQueue() {
  queue.set([]);
  queueIndex.set(-1);
  if (isThisDeviceActive()) isPlaying.set(false);
  schedulePushQueue(activeOrMe());
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

// Preload the next track onto crossfadeAudio silently so it's buffered
// before the crossfade window begins. Call this ~10s before the fade.
// seekOffset: start playing from this many seconds into the track (for personality skip-intro).
export function preloadCrossfadeTrack(track: Track, seekOffset = 0) {
  if (!track.streamUrl || typeof window === 'undefined') return;
  if (!crossfadeAudio) crossfadeAudio = new Audio();
  const cf = crossfadeAudio;
  if (cf.src === track.streamUrl) return; // already loaded
  cf.src = track.streamUrl;
  cf.volume = 0;
  cf.playbackRate = 1.0;
  cf.play()
    .then(() => {
      if (seekOffset > 0) cf.currentTime = seekOffset;
    })
    .catch(() => {});
}

// seekOffset: start the incoming track from this many seconds in (personality skip-intro).
// pitchSlop: add ±pitchSlop random variance to beatmatch playback rate for a live DJ feel.
export function startCrossfade(nextIdx: number, durationSecs: number, doBeatmatch: boolean, seekOffset = 0, pitchSlop = 0.012) {
  if (_isCrossfading) return;
  const q = get(queue);
  const nextTrack = q[nextIdx];
  if (!nextTrack?.streamUrl) return;

  _isCrossfading = true;
  // Issue 1: push queue immediately (no debounce) so server index is correct before
  // the first poll fires, preventing other devices from reverting the crossfade.
  {
    const myIdNow = get(localDeviceId);
    if (myIdNow && !get(soloMode)) {
      _doPushQueue(myIdNow).catch((e) => console.warn('[omniMux] Failed crossfade-start push:', e));
    }
  }
  // Safety valve: release the lock if the crossfade takes longer than expected
  // (e.g. canplay never fires on a failed load). Give it the full fade duration + 15s buffer.
  if (_crossfadeSafetyTimer) clearTimeout(_crossfadeSafetyTimer);
  _crossfadeSafetyTimer = setTimeout(() => {
    if (_isCrossfading) {
      console.warn('[omniMux] Crossfade safety timeout — resetting _isCrossfading');
      _isCrossfading = false;
      _crossfadeBlackoutUntil = Date.now() + CROSSFADE_BLACKOUT_MS;

      // Issue 3: attempt audio recovery instead of leaving it dead
      const primary = audio;
      const cf = crossfadeAudio;
      if (primary && primary.src) {
        primary.volume = get(volume);
        primary.play().catch(() => {
          // Primary failed — try to take over from crossfade audio if it's still playing
          if (cf && !cf.paused && cf.src) {
            primary.src = cf.src;
            primary.currentTime = cf.currentTime;
            primary.volume = get(volume);
            primary.play().catch(() => {
              console.error('[omniMux] Crossfade recovery failed — audio is dead');
            });
          }
        });
      } else if (cf && !cf.paused && cf.src) {
        if (primary) {
          primary.src = cf.src;
          primary.currentTime = cf.currentTime;
          primary.volume = get(volume);
          primary.play().catch(() => {});
        }
      }
      // Clean up crossfade audio regardless
      if (cf) {
        cf.pause();
        cf.src = '';
        cf.volume = 0;
      }
      if (_crossfadeTimerId !== null) {
        clearTimeout(_crossfadeTimerId);
        _crossfadeTimerId = null;
      }
    }
    _crossfadeSafetyTimer = null;
  }, (durationSecs + 15) * 1000);

  if (!crossfadeAudio && typeof window !== 'undefined') {
    crossfadeAudio = new Audio();
  }
  if (!crossfadeAudio) return;

  const cf = crossfadeAudio;

  // Pitch-match BPM: lock the incoming track's tempo to the outgoing track.
  // pitchSlop adds a tiny drift so the blend sounds like a human DJ.
  const currentBpm = get(currentTrack)?.bpm;
  const nextBpm = nextTrack.bpm;
  let rawRate = (doBeatmatch && currentBpm && nextBpm && nextBpm > 0)
    ? currentBpm / nextBpm
    : 1.0;
  // Normalize half/double-time BPM tag errors: clamp to ±25% of 1.0.
  // Outside that range the metadata is almost certainly wrong octave.
  if (doBeatmatch && currentBpm && nextBpm) {
    while (rawRate > 1.25) rawRate /= 2;
    while (rawRate < 0.8)  rawRate *= 2;
  }
  let startPlaybackRate = rawRate;
  if (doBeatmatch && pitchSlop > 0) {
    startPlaybackRate *= 1 + (Math.random() - 0.5) * pitchSlop * 2;
  }
  cf.playbackRate = startPlaybackRate;

  function beginFade() {
    // Seek cf to skip-intro offset if not already there
    if (seekOffset > 0 && cf.currentTime < seekOffset - 1) {
      cf.currentTime = seekOffset;
    }

    // Beat phase alignment: snap cf's position so its next beat coincides with
    // primary's next beat. Both tracks now share the same real-time beat period
    // (because cf's rate = currentBpm/nextBpm), so aligning phase once at fade
    // start locks them together. pitchSlop then lets them drift naturally.
    if (doBeatmatch && currentBpm && nextBpm && nextBpm > 0) {
      const primary = getAudio();
      const primaryBeatPeriod = 60 / currentBpm;       // seconds per beat on primary
      const cfBeatPeriod      = 60 / nextBpm;          // seconds per beat in cf's own time
      const primaryPhase      = primary.currentTime % primaryBeatPeriod; // how far into current beat
      // Where in cf's beat cycle we need to be so the next beat lines up in real time:
      // primaryPhase (real-time) → multiply by rate to get cf-time equivalent
      const targetCfPhase = primaryPhase * rawRate;
      const currentCfPhase    = cf.currentTime % cfBeatPeriod;
      const aligned = cf.currentTime - currentCfPhase + targetCfPhase;
      // Don't seek before the skip-intro offset; add one beat period if needed
      cf.currentTime = aligned >= seekOffset ? aligned : aligned + cfBeatPeriod;
    }

    const startTime = performance.now();
    const totalMs = durationSecs * 1000;
    const primary = getAudio();
    const startVol = primary.volume;

    function fade(now: number) {
      const t = Math.min((now - startTime) / totalMs, 1);
      const eased = t * t * (3 - 2 * t); // smoothstep
      const vol = get(volume);
      primary.volume = (1 - eased) * startVol;
      cf.volume = eased * vol;
      // Hold the BPM lock for the first 65% of the fade, then gradually release
      // to 1.0 over the tail — stays tight while both tracks are audible.
      const RELEASE_POINT = 0.65;
      const releaseT = Math.max(0, (t - RELEASE_POINT) / (1 - RELEASE_POINT));
      const releaseEased = releaseT * releaseT * (3 - 2 * releaseT);
      cf.playbackRate = startPlaybackRate + (1.0 - startPlaybackRate) * releaseEased;

      if (t < 1) {
        _crossfadeTimerId = setTimeout(() => fade(performance.now()), 16);
      } else {
        // Transfer playback back to primary (keeps Web Audio analyser chain intact).
        // We load primary with the same URL now so it buffers during the fade. Seek to
        // cf's live position right before switching so there's no gap or time-jump.
        const nextUrl = nextTrack.streamUrl!;
        primary.volume = 0;

        function finishTransfer() {
          // Sync to wherever cf is right now, then hand off
          const syncTime = cf.currentTime;
          primary.currentTime = syncTime;
          primary.playbackRate = 1.0;
          primary.volume = get(volume);
          primary.play()
            .then(() => {
              cf.pause();
              cf.src = '';
              cf.volume = 0;
              cf.playbackRate = 1.0;
              _isCrossfading = false;
              _crossfadeTimerId = null;
              // Issue 10: set blackout window and push immediately so server has the
              // correct index before the next poll, preventing other devices from reverting.
              _crossfadeBlackoutUntil = Date.now() + CROSSFADE_BLACKOUT_MS;
              const myIdFinish = get(localDeviceId);
              if (myIdFinish && !get(soloMode)) {
                _doPushQueue(myIdFinish).catch((e) => console.warn('[omniMux] Failed crossfade-end push:', e));
              }
            })
            .catch(() => {
              _isCrossfading = false;
              _crossfadeBlackoutUntil = Date.now() + CROSSFADE_BLACKOUT_MS;
            });
        }

        if (primary.src !== nextUrl) {
          primary.src = nextUrl;
        }

        if (primary.readyState >= 3) {
          finishTransfer();
        } else {
          primary.addEventListener('canplay', finishTransfer, { once: true });
          primary.play().catch(() => {});
        }

        queueIndex.set(nextIdx);
        currentTrack.set(nextTrack);
        updateMediaSession(nextTrack);
        // Claim ownership — the actual server push happens in finishTransfer once
        // primary.play() succeeds, so we don't push a stale index before transfer.
        const myId = get(localDeviceId);
        if (myId) activeDeviceId.set(myId);

        if (!nextTrack.hqCoverUrl) {
          const token = ++_artworkFetchToken;
          fetchItunesArtwork(nextTrack.artist, nextTrack.album).then((url) => {
            if (!url || token !== _artworkFetchToken) return;
            if (get(currentTrack)?.id === nextTrack.id) {
              currentTrack.update((t) => t ? { ...t, hqCoverUrl: url } : t);
            }
          });
        }
      }
    }
    _crossfadeTimerId = setTimeout(() => fade(performance.now()), 16);
  }

  // If already preloaded and playing, start fade immediately
  if (cf.src === nextTrack.streamUrl && !cf.paused) {
    cf.volume = 0;
    beginFade();
  } else {
    // Load and play, then begin fade
    if (cf.src !== nextTrack.streamUrl) {
      cf.src = nextTrack.streamUrl;
      cf.volume = 0;
      if (seekOffset > 0) {
        cf.addEventListener('canplay', () => { cf.currentTime = seekOffset; }, { once: true });
      }
    }
    cf.play().then(beginFade).catch(() => { _isCrossfading = false; });
  }
}

export function stopCrossfade() {
  if (_crossfadeSafetyTimer) { clearTimeout(_crossfadeSafetyTimer); _crossfadeSafetyTimer = null; }
  if (_crossfadeTimerId !== null) {
    clearTimeout(_crossfadeTimerId);
    _crossfadeTimerId = null;
  }
  if (crossfadeAudio) {
    crossfadeAudio.pause();
    crossfadeAudio.src = '';
    crossfadeAudio.volume = 0;
    crossfadeAudio.playbackRate = 1.0;
  }
  _isCrossfading = false;
  if (audio) {
    audio.volume = get(volume);
    audio.playbackRate = 1.0;
  }
}
