import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { subsonic, type Song, type Playlist } from '../subsonic';
import {
  queue, queueIndex, currentTrack, loop,
  songToTrack, addToQueue,
  startCrossfade, stopCrossfade, registerCrossfadeChecker, preloadCrossfadeTrack,
} from './player';
import { visMode, type VisMode, startAutoGain, stopAutoGain, getAnalyser, fillFrequencyData, overallFromBuf } from './visualizer';
import { showFullscreenPlayer, artExpandRequested } from './ui';

// ── Persisted settings ────────────────────────────────────────────────────────

function persistedWritable<T>(key: string, defaultVal: T, parse: (v: string) => T) {
  const stored = browser ? localStorage.getItem(key) : null;
  const store = writable<T>(stored !== null ? parse(stored) : defaultVal);
  if (browser) {
    store.subscribe((v) => localStorage.setItem(key, String(v)));
  }
  return store;
}

export const crossfadeDuration  = persistedWritable('omnimux-cf-dur',   5,       Number);
export const beatmatchEnabled   = persistedWritable('omnimux-cf-beat',  true,    (v) => v === 'true');
export const bpmTolerance       = persistedWritable('omnimux-bpm-tol',  10,      Number);
export const visCycleInterval   = persistedWritable<'track'|'15'|'30'|'60'>('omnimux-vis-cycle', 'track', (v) => v as 'track'|'15'|'30'|'60');
export const ambientIdleMinutes = persistedWritable('omnimux-ambient',  0,       Number);

// ── DJ Personality ────────────────────────────────────────────────────────────

export type DJPersonality = 'none' | 'club' | 'relaxing' | 'chill' | 'workout';

export interface PersonalityConfig {
  label: string;
  description: string;
  bpmMin: number | null;       // exclude songs below this BPM
  bpmMax: number | null;       // exclude songs above this BPM
  skipIntroSeconds: number;    // seek incoming track forward by this many seconds
  moodKeywords: string[];      // match against "Mood: X" Navidrome playlists
  genreKeywords: string[];     // prefer songs whose genre contains one of these (substring match, case-insensitive)
  pitchSlop: number;           // ±N fraction random variance on beatmatch rate
  energyDropThreshold: number | null; // exit song early when energy stays below this (0-1), null=disabled
  maxPlaySeconds: number | null; // force crossfade out after this many seconds, null=disabled
}

export const PERSONALITY_CONFIGS: Record<DJPersonality, PersonalityConfig> = {
  none:     { label: 'None',     description: 'Standard Auto DJ',                bpmMin: null, bpmMax: null, skipIntroSeconds: 0,  moodKeywords: [],                                genreKeywords: [],                                                                                    pitchSlop: 0.012, energyDropThreshold: null, maxPlaySeconds: null },
  club:     { label: 'Club',     description: 'Dance/EDM — skip to the drop',    bpmMin: 120,  bpmMax: null, skipIntroSeconds: 45, moodKeywords: ['energetic', 'upbeat', 'dance'],   genreKeywords: ['dance', 'edm', 'electronic', 'house', 'techno', 'trance', 'electro', 'club'],   pitchSlop: 0.010, energyDropThreshold: 0.15, maxPlaySeconds: 150 },
  relaxing: { label: 'Relaxing', description: 'Ambient & calm — full songs',     bpmMin: null, bpmMax: 100,  skipIntroSeconds: 0,  moodKeywords: ['relaxing', 'ambient', 'calm'],    genreKeywords: [],                                                                                    pitchSlop: 0.000, energyDropThreshold: null, maxPlaySeconds: null },
  chill:    { label: 'Chill',    description: 'Lo-fi & mellow mid-tempo vibes',  bpmMin: 75,   bpmMax: 115,  skipIntroSeconds: 0,  moodKeywords: ['chill', 'mellow', 'lofi'],        genreKeywords: [],                                                                                    pitchSlop: 0.015, energyDropThreshold: null, maxPlaySeconds: null },
  workout:  { label: 'Workout',  description: 'High-energy — push through it',   bpmMin: 130,  bpmMax: null, skipIntroSeconds: 20, moodKeywords: ['energetic', 'intense', 'upbeat'], genreKeywords: [],                                                                                    pitchSlop: 0.008, energyDropThreshold: null, maxPlaySeconds: 150 },
};

export const djPersonality = persistedWritable<DJPersonality>('omnimux-dj-personality', 'none', (v) => v as DJPersonality);

// ── Runtime state ─────────────────────────────────────────────────────────────

export const autoDJActive = writable<boolean>(false);

// ── Crossfade checker (registered with player.ts) ─────────────────────────────

const PRELOAD_AHEAD = 10; // seconds before crossfade window to start buffering
let _crossfadeCheckActive = false;
let _preloadTriggered = false;

// Energy-drop detection for Club/Workout personalities
const ENERGY_HISTORY_MAX = 4;        // seconds of sustained low energy needed
const ENERGY_SAMPLE_INTERVAL = 1000; // ms between samples
let _energyHistory: number[] = [];
let _lastEnergySample = 0;
let _energyDropFired = false;

function _sampleEnergy(ct: number): void {
  const now = Date.now();
  if (now - _lastEnergySample < ENERGY_SAMPLE_INTERVAL) return;
  _lastEnergySample = now;

  const analyser = getAnalyser();
  if (!analyser) return;
  const buf = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
  fillFrequencyData(analyser, buf);
  const energy = overallFromBuf(buf);
  _energyHistory.push(energy);
  if (_energyHistory.length > ENERGY_HISTORY_MAX) _energyHistory.shift();

  // Need full history before we start judging
  if (_energyHistory.length < ENERGY_HISTORY_MAX) return;
  // Must be at least 60s in to avoid reacting to the intro
  if (ct < 60) return;

  const config = PERSONALITY_CONFIGS[get(djPersonality)];
  const threshold = config.energyDropThreshold;
  if (threshold === null) return;

  const avgEnergy = _energyHistory.reduce((a, b) => a + b, 0) / _energyHistory.length;
  if (avgEnergy < threshold && !_energyDropFired && !_crossfadeCheckActive) {
    _energyDropFired = true;
    _crossfadeCheckActive = true;
    const q = get(queue);
    const idx = get(queueIndex);
    if (idx < q.length - 1) {
      const cfSecs = Math.min(get(crossfadeDuration), 4); // quick exit on energy drop
      startCrossfade(idx + 1, cfSecs, get(beatmatchEnabled), config.skipIntroSeconds, config.pitchSlop);
    }
  }
}

function crossfadeCheck(ct: number, dur: number) {
  if (!get(autoDJActive)) return;
  const cfSecs = get(crossfadeDuration);
  if (cfSecs === 0) return;
  if (!dur || ct <= 0) return;

  // Energy-drop early exit (Club/Workout personalities)
  _sampleEnergy(ct);

  const remaining = dur - ct;
  const q = get(queue);
  const idx = get(queueIndex);
  if (idx >= q.length - 1) return;

  const config = PERSONALITY_CONFIGS[get(djPersonality)];
  const nextTrack = q[idx + 1];

  // Max-play-time early exit (Club/Workout personalities)
  // Trigger crossfade once we've played maxPlaySeconds, but only if there's still
  // more song left than the crossfade duration (so we don't double-fire near the end).
  const maxPlay = config.maxPlaySeconds;
  if (maxPlay !== null && ct >= maxPlay && remaining > cfSecs && !_crossfadeCheckActive) {
    _crossfadeCheckActive = true;
    const quickCf = Math.min(cfSecs, 4);
    preloadCrossfadeTrack(nextTrack, config.skipIntroSeconds);
    startCrossfade(idx + 1, quickCf, get(beatmatchEnabled), config.skipIntroSeconds, config.pitchSlop);
    return;
  }

  // Preload next track early so it's buffered when the crossfade window opens
  if (!_preloadTriggered && remaining <= cfSecs + PRELOAD_AHEAD) {
    _preloadTriggered = true;
    preloadCrossfadeTrack(nextTrack, config.skipIntroSeconds);
  }

  if (!_crossfadeCheckActive && remaining <= cfSecs) {
    _crossfadeCheckActive = true;
    startCrossfade(idx + 1, cfSecs, get(beatmatchEnabled), config.skipIntroSeconds, config.pitchSlop);
  }
}

// ── Queue monitor ─────────────────────────────────────────────────────────────

let _queueMonitorUnsub: (() => void) | null = null;
let _filling = false;

// Ring buffer of recently-played song IDs — never re-queue these
const RECENT_HISTORY = 15;
const _recentIds: string[] = [];

// Mood playlist cache: { playlists, fetchedAt }
let _moodPlaylistCache: Playlist[] | null = null;
let _moodPlaylistCacheAt = 0;
const MOOD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getMoodPlaylistSongs(keywords: string[]): Promise<Song[]> {
  const now = Date.now();
  if (!_moodPlaylistCache || now - _moodPlaylistCacheAt > MOOD_CACHE_TTL) {
    try {
      _moodPlaylistCache = await subsonic.getPlaylists();
      _moodPlaylistCacheAt = now;
    } catch {
      return [];
    }
  }

  // Collect songs from ALL matching playlists, not just the first
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const matches = _moodPlaylistCache.filter((p) =>
    lowerKeywords.some((kw) => p.name.toLowerCase().includes(kw))
  );
  if (matches.length === 0) return [];

  const results = await Promise.allSettled(matches.map((p) => subsonic.getPlaylist(p.id)));
  const allSongs: Song[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const s of r.value.songs) {
        if (!seen.has(s.id)) { seen.add(s.id); allSongs.push(s); }
      }
    }
  }
  return allSongs;
}

async function fillQueue() {
  if (_filling) return;
  if (get(loop) === 'one') return;
  _filling = true;
  try {
    const personality = get(djPersonality);
    const config = PERSONALITY_CONFIGS[personality];
    const track = get(currentTrack);
    const currentBpm = track?.bpm;
    const tolerance = get(bpmTolerance) / 100;

    // Build the exclusion set: recently played + songs already in the upcoming queue
    const q = get(queue);
    const idx = get(queueIndex);
    const upcomingIds = new Set(q.slice(idx + 1).map((t) => t.id));
    const excludeIds = new Set([..._recentIds, ...upcomingIds]);

    // Fetch a larger pool when personality filtering is active
    const poolSize = personality !== 'none' ? 80 : 50;
    let pool: Song[] = (await subsonic.getRandomSongs(poolSize))
      .filter((s) => !excludeIds.has(s.id));

    // Merge in mood-playlist songs if personality has keywords
    if (config.moodKeywords.length > 0) {
      try {
        const moodSongs = await getMoodPlaylistSongs(config.moodKeywords);
        if (moodSongs.length > 0) {
          const shuffled = moodSongs.sort(() => Math.random() - 0.5).slice(0, 30);
          const seen = new Set(pool.map((s) => s.id));
          pool = pool.concat(
            shuffled.filter((s) => !seen.has(s.id) && !excludeIds.has(s.id))
          );
        }
      } catch {
        // Mood playlist lookup failed — use random pool as-is
      }
    }

    // Filter by personality BPM range — songs with no BPM stay in as fallbacks
    // so a small library doesn't get stuck on the same few tagged tracks.
    let filtered = pool;
    if (config.bpmMin !== null || config.bpmMax !== null) {
      const inRange = pool.filter((s) => {
        if (!s.bpm) return false;
        if (config.bpmMin !== null && s.bpm < config.bpmMin) return false;
        if (config.bpmMax !== null && s.bpm > config.bpmMax) return false;
        return true;
      });
      const noBpm = pool.filter((s) => !s.bpm);
      filtered = inRange.length >= 5 ? inRange : [...inRange, ...noBpm];
      if (filtered.length === 0) filtered = pool;
    }

    // For personalities with genreKeywords, strongly prefer genre-matching tracks.
    // Fall back to the full filtered pool only if fewer than 5 genre matches exist.
    if (config.genreKeywords.length > 0) {
      const lowerGenres = config.genreKeywords.map((g) => g.toLowerCase());
      const genreMatches = filtered.filter((s) =>
        s.genre && lowerGenres.some((kw) => s.genre!.toLowerCase().includes(kw))
      );
      if (genreMatches.length >= 5) filtered = genreMatches;
    }

    // Prefer songs close to the current BPM
    let candidate: Song | undefined;
    if (currentBpm) {
      const bpmMatches = filtered.filter(
        (s) => s.bpm && s.bpm >= currentBpm * (1 - tolerance) && s.bpm <= currentBpm * (1 + tolerance)
      );
      if (bpmMatches.length > 0) {
        candidate = bpmMatches[Math.floor(Math.random() * bpmMatches.length)];
      }
    }
    if (!candidate) {
      candidate = filtered[Math.floor(Math.random() * filtered.length)];
    }
    // Last resort: drop recent-history exclusion entirely (tiny library edge case)
    if (!candidate) {
      const anyPool = await subsonic.getRandomSongs(20);
      candidate = anyPool[Math.floor(Math.random() * anyPool.length)];
    }

    if (candidate) {
      const newTrack = await songToTrack(candidate);
      addToQueue(newTrack);
    }
  } catch {
    // Network failure — will retry on next queue check
  } finally {
    _filling = false;
  }
}

function startQueueMonitor() {
  stopQueueMonitor();
  const remaining = derived([queue, queueIndex], ([q, i]) => q.length - i - 1);
  _queueMonitorUnsub = remaining.subscribe((r) => {
    if (!get(autoDJActive)) return;
    if (r <= 2) fillQueue();
  });
}

function stopQueueMonitor() {
  _queueMonitorUnsub?.();
  _queueMonitorUnsub = null;
  _filling = false;
}

// ── Visualizer cycling ────────────────────────────────────────────────────────

const VIS_CYCLE: VisMode[] = ['pan', 'pulse', 'warp', 'ripple', 'tunnel', 'fractal', 'kaleidoscope', 'droste', 'vortex', 'glitch', 'crystal', 'aurora', 'plasma', 'sphere'];
let _visCycleTimer: ReturnType<typeof setInterval> | null = null;
let _visCycleTrackUnsub: (() => void) | null = null;
let _visCycleFirstFire = true;

// Whether auto-cycling is paused by the user (toggle in fullscreen player)
export const visCyclingPaused = writable<boolean>(false);

// Advance to the next visualizer. Skips if vis is 'off' or cycling is paused.
export function advanceVis() {
  const current = get(visMode);
  if (current === 'off') return;
  if (get(visCyclingPaused)) return;
  const idx = VIS_CYCLE.indexOf(current);
  visMode.set(VIS_CYCLE[(idx === -1 ? 0 : idx + 1) % VIS_CYCLE.length]);
}

function startVisCycler() {
  stopVisCycler();
  if (get(visMode) === 'off') return; // don't start cycler when vis is disabled
  if (get(visCyclingPaused)) return;  // don't start when user paused cycling
  const interval = get(visCycleInterval);
  if (interval === 'track') {
    _visCycleFirstFire = true;
    _visCycleTrackUnsub = currentTrack.subscribe(() => {
      if (_visCycleFirstFire) { _visCycleFirstFire = false; return; }
      advanceVis();
    });
  } else {
    _visCycleTimer = setInterval(advanceVis, parseInt(interval) * 1000);
  }
}

function stopVisCycler() {
  if (_visCycleTimer) { clearInterval(_visCycleTimer); _visCycleTimer = null; }
  _visCycleTrackUnsub?.();
  _visCycleTrackUnsub = null;
}

// Restart cycler when setting changes while Auto DJ is active
visCycleInterval.subscribe(() => {
  if (get(autoDJActive)) {
    startVisCycler();
  }
});

// Stop/restart cycler when visMode is toggled to/from 'off' while Auto DJ is active
visMode.subscribe((mode) => {
  if (!get(autoDJActive)) return;
  if (mode === 'off') {
    stopVisCycler();
  } else if (!_visCycleTimer && !_visCycleTrackUnsub) {
    startVisCycler();
  }
});

// Stop/restart cycler when user pauses/resumes cycling
visCyclingPaused.subscribe((paused) => {
  if (!get(autoDJActive)) return;
  if (paused) {
    stopVisCycler();
  } else {
    startVisCycler();
  }
});

// ── Ambient mode ──────────────────────────────────────────────────────────────

let _ambientTimer: ReturnType<typeof setInterval> | null = null;
let _lastActivity = Date.now();

function _resetActivity() { _lastActivity = Date.now(); }

function startAmbient(minutes: number) {
  stopAmbient();
  if (!minutes || !browser) return;
  document.addEventListener('mousemove', _resetActivity, { passive: true });
  document.addEventListener('touchstart', _resetActivity, { passive: true });
  document.addEventListener('keydown', _resetActivity, { passive: true });
  _ambientTimer = setInterval(() => {
    const idleMs = Date.now() - _lastActivity;
    if (idleMs >= minutes * 60 * 1000) {
      showFullscreenPlayer.set(true);
      artExpandRequested.update((n) => n + 1);
    }
  }, 30_000);
}

function stopAmbient() {
  if (_ambientTimer) { clearInterval(_ambientTimer); _ambientTimer = null; }
  if (browser) {
    document.removeEventListener('mousemove', _resetActivity);
    document.removeEventListener('touchstart', _resetActivity);
    document.removeEventListener('keydown', _resetActivity);
  }
}

ambientIdleMinutes.subscribe((minutes) => {
  stopAmbient();
  if (minutes > 0) startAmbient(minutes);
});

// ── Toggle ────────────────────────────────────────────────────────────────────

export function toggleAutoDJ() {
  const next = !get(autoDJActive);
  autoDJActive.set(next);

  if (next) {
    showFullscreenPlayer.set(true);
    artExpandRequested.update((n) => n + 1);
    _crossfadeCheckActive = false;
    registerCrossfadeChecker(crossfadeCheck);
    startQueueMonitor();
    startVisCycler();
    startAutoGain();
    fillQueue();
  } else {
    registerCrossfadeChecker(null);
    stopCrossfade();
    _crossfadeCheckActive = false;
    _preloadTriggered = false;
    stopQueueMonitor();
    stopVisCycler();
    stopAutoGain();
  }
}

// Reset flags when the track changes so the next track can preload and fade.
// Also push the new track into the recently-played ring buffer.
currentTrack.subscribe((t) => {
  _crossfadeCheckActive = false;
  _preloadTriggered = false;
  _energyDropFired = false;
  _energyHistory = [];
  _lastEnergySample = 0;

  if (t?.id) {
    if (!_recentIds.includes(t.id)) {
      _recentIds.push(t.id);
      if (_recentIds.length > RECENT_HISTORY) _recentIds.shift();
    }
  }
});
