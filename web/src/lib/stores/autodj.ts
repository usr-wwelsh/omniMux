import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { subsonic, type Song, type Playlist } from '../subsonic';
import { api } from '../api';
import {
  queue, queueIndex, currentTrack, loop,
  songToTrack, addToQueue,
  startCrossfade, stopCrossfade, registerCrossfadeChecker, preloadCrossfadeTrack,
} from './player';
import { visMode, type VisMode, startAutoGain, stopAutoGain, getAnalyser, fillFrequencyData, overallFromBuf } from './visualizer';
import { showFullscreenPlayer, artExpandRequested, autoDJToast } from './ui';

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
  bpmMin: number | null;            // exclude songs below this BPM
  bpmMax: number | null;            // exclude songs above this BPM
  skipIntroSeconds: number;         // seek incoming track forward by this many seconds
  moodKeywords: string[];           // match against "Mood: X" Navidrome playlists
  genreKeywords: string[];          // prefer songs whose genre contains one of these
  excludeGenreKeywords: string[];   // hard-exclude songs whose genre contains any of these
  pitchSlop: number;                // ±N fraction random variance on beatmatch rate
  energyDropThreshold: number | null;
  maxPlaySeconds: number | null;
  prioritizeHighBpm: boolean;
  minEnergy: number | null;         // hard floor on energy score (0–1, from mood analysis)
  maxEnergy: number | null;         // hard ceiling on energy score
  allowedMoods: string[] | null;    // if set, prefer songs with these mood labels
  harmonicMix: boolean;             // prefer next track in a harmonically compatible key
}

export const PERSONALITY_CONFIGS: Record<DJPersonality, PersonalityConfig> = {
  none: {
    label: 'None', description: 'Standard Auto DJ',
    bpmMin: null, bpmMax: null, skipIntroSeconds: 0,
    moodKeywords: [], genreKeywords: [], excludeGenreKeywords: [],
    pitchSlop: 0.012, energyDropThreshold: null, maxPlaySeconds: null,
    prioritizeHighBpm: false, minEnergy: null, maxEnergy: null,
    allowedMoods: null, harmonicMix: false,
  },
  club: {
    label: 'Club', description: 'Dance/EDM — skip to the drop',
    bpmMin: 120, bpmMax: null, skipIntroSeconds: 45,
    moodKeywords: ['energetic', 'upbeat', 'dance'],
    genreKeywords: ['dance', 'edm', 'electronic', 'house', 'techno', 'trance', 'electro', 'club'],
    excludeGenreKeywords: ['ambient', 'classical', 'new age', 'acoustic', 'folk', 'country', 'blues', 'jazz', 'sleep', 'meditation'],
    pitchSlop: 0.010, energyDropThreshold: 0.15, maxPlaySeconds: 150,
    prioritizeHighBpm: false, minEnergy: 0.65, maxEnergy: null,
    allowedMoods: ['energetic', 'happy', 'upbeat', 'excited'],
    harmonicMix: true,
  },
  relaxing: {
    label: 'Relaxing', description: 'Ambient & calm — full songs',
    bpmMin: null, bpmMax: 100, skipIntroSeconds: 0,
    moodKeywords: ['relaxing', 'ambient', 'calm'],
    genreKeywords: [], excludeGenreKeywords: ['metal', 'punk', 'hardcore', 'drum and bass', 'dnb', 'edm', 'dance', 'techno'],
    pitchSlop: 0.000, energyDropThreshold: null, maxPlaySeconds: null,
    prioritizeHighBpm: false, minEnergy: null, maxEnergy: 0.45,
    allowedMoods: ['relaxing', 'calm', 'peaceful', 'ambient', 'sad', 'melancholic'],
    harmonicMix: false,
  },
  chill: {
    label: 'Chill', description: 'Lo-fi & mellow mid-tempo vibes',
    bpmMin: 75, bpmMax: 115, skipIntroSeconds: 0,
    moodKeywords: ['chill', 'mellow', 'lofi'],
    genreKeywords: [], excludeGenreKeywords: ['metal', 'punk', 'hardcore', 'edm'],
    pitchSlop: 0.015, energyDropThreshold: null, maxPlaySeconds: null,
    prioritizeHighBpm: false, minEnergy: null, maxEnergy: 0.60,
    allowedMoods: ['chill', 'mellow', 'happy', 'peaceful', 'calm'],
    harmonicMix: true,
  },
  workout: {
    label: 'Workout', description: 'High-energy — ~1 min per track',
    bpmMin: 130, bpmMax: null, skipIntroSeconds: 20,
    moodKeywords: ['energetic', 'intense', 'upbeat'],
    genreKeywords: [], excludeGenreKeywords: ['ambient', 'classical', 'new age', 'acoustic', 'folk', 'sleep'],
    pitchSlop: 0.008, energyDropThreshold: null, maxPlaySeconds: 60,
    prioritizeHighBpm: true, minEnergy: 0.70, maxEnergy: null,
    allowedMoods: ['energetic', 'intense', 'upbeat', 'excited', 'angry'],
    harmonicMix: false,
  },
};

export const djPersonality = persistedWritable<DJPersonality>('omnimux-dj-personality', 'none', (v) => v as DJPersonality);

// ── Runtime state ─────────────────────────────────────────────────────────────

export const autoDJActive = writable<boolean>(false);

// ── Camelot wheel (harmonic mixing) ──────────────────────────────────────────

const _CAMELOT: Record<string, string> = {
  'c major': '8B',  'g major': '9B',  'd major': '10B', 'a major': '11B',
  'e major': '12B', 'b major': '1B',  'f# major': '2B', 'gb major': '2B',
  'db major': '3B', 'c# major': '3B', 'ab major': '4B', 'g# major': '4B',
  'eb major': '5B', 'd# major': '5B', 'bb major': '6B', 'a# major': '6B',
  'f major': '7B',
  'a minor': '8A',  'e minor': '9A',  'b minor': '10A', 'f# minor': '11A',
  'gb minor': '11A','c# minor': '12A','db minor': '12A','g# minor': '1A',
  'ab minor': '1A', 'd# minor': '2A', 'eb minor': '2A', 'a# minor': '3A',
  'bb minor': '3A', 'f minor': '4A',  'c minor': '5A',  'g minor': '6A',
  'd minor': '7A',
};

function toCamelot(rawKey: string): string | null {
  if (!rawKey) return null;
  const k = rawKey.trim().toLowerCase();
  if (_CAMELOT[k]) return _CAMELOT[k];
  // "Am", "C#m", "F#m" shorthand
  const shortMinor = k.match(/^([a-g][b#]?)m$/);
  if (shortMinor) return _CAMELOT[shortMinor[1] + ' minor'] ?? null;
  // "C", "F#", "Bb" — assume major
  const plain = k.match(/^([a-g][b#]?)$/);
  if (plain) return _CAMELOT[plain[1] + ' major'] ?? null;
  // "C maj" / "A min" abbreviations
  const abbrev = k.replace(/\bmaj\b/, 'major').replace(/\bmin\b/, 'minor');
  return _CAMELOT[abbrev] ?? null;
}

function isCompatibleKey(a: string, b: string): boolean {
  if (a === b) return true;
  const numA = parseInt(a), numB = parseInt(b);
  const modeA = a.slice(-1), modeB = b.slice(-1);
  if (modeA === modeB) {
    const diff = Math.abs(numA - numB);
    return diff === 1 || diff === 11; // adjacent on the wheel (wraps 12→1)
  }
  return numA === numB; // same number, relative major/minor
}

// ── Enrichment cache and energy arc ──────────────────────────────────────────

type Enrichment = { mood?: string; energy?: number; key?: string };

// Persists between fillQueue calls — built up as we enrich song pools
const _enrichCache = new Map<string, Enrichment>(); // navidrome song id → data

// Ignored tracks cache: Set of "title\0artist" (lowercased) for fast lookup
let _ignoredSet = new Set<string>();
let _ignoredFetchedAt = 0;
const IGNORED_TTL_MS = 60_000; // re-fetch at most once per minute

async function _refreshIgnoredTracks(): Promise<void> {
  if (Date.now() - _ignoredFetchedAt < IGNORED_TTL_MS) return;
  try {
    const ignored = await api.getIgnoredTracks();
    _ignoredSet = new Set(ignored.map((t) => `${t.title.toLowerCase().trim()}\0${t.artist.toLowerCase().trim()}`));
    _ignoredFetchedAt = Date.now();
    if (ignored.length > 0) {
      console.log(`[omniMux] Auto DJ: ${ignored.length} ignored track(s) loaded`, ignored.map((t) => `"${t.title}" by "${t.artist}"`));
    }
  } catch (e) {
    console.warn('[omniMux] Auto DJ: failed to fetch ignored tracks:', e);
  }
}

// Enrichment for the currently playing track
let _currentEnrichment: Enrichment | null = null;

// Energy history of songs played in this Auto DJ session (for arc tracking)
const _setEnergyHistory: number[] = [];
const SET_ENERGY_WINDOW = 6;

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

  const config = PERSONALITY_CONFIGS[get(djPersonality)];

  // Need full history before we start judging
  if (_energyHistory.length < ENERGY_HISTORY_MAX) return;
  // Must be past the personality's intro window to avoid reacting to song intros
  if (ct < config.skipIntroSeconds) return;
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
  if (idx >= q.length - 1) {
    // No next track — kick off a fill and wait; don't let the song end without one
    fillQueue();
    return;
  }

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
    const previousCache = _moodPlaylistCache; // hold onto stale data in case fetch fails
    try {
      _moodPlaylistCache = await subsonic.getPlaylists();
      _moodPlaylistCacheAt = now;
    } catch {
      // Issue 11: Invalidate so next call retries rather than serving stale error-state
      _moodPlaylistCache = null;
      _moodPlaylistCacheAt = 0;
      if (previousCache) {
        // Serve stale data for this call rather than returning empty
        _moodPlaylistCache = previousCache;
      } else {
        return [];
      }
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

let _fillFailures = 0; // consecutive fill failure counter for toast suppression

function _showFillFailureToast() {
  autoDJToast.set('Auto DJ: Could not fetch new tracks. Check Navidrome connection.');
  setTimeout(() => autoDJToast.set(null), 5000);
}

async function fillQueue() {
  if (_filling) return;
  if (get(loop) === 'one') return;
  _filling = true;

  // Snapshot upcoming IDs at fill start (unused directly — the actual diff happens at append time)

  try {
    const personality = get(djPersonality);
    const config = PERSONALITY_CONFIGS[personality];
    const track = get(currentTrack);
    const currentBpm = track?.bpm;
    const tolerance = get(bpmTolerance) / 100;

    // Build exclusion set: recently played + songs already in the upcoming queue
    const q = get(queue);
    const idx = get(queueIndex);
    const upcomingIds = new Set(q.slice(idx + 1).map((t) => t.id));
    const excludeIds = new Set([..._recentIds, ...upcomingIds]);

    // Refresh ignored-tracks list (cached, re-fetched at most once per minute)
    await _refreshIgnoredTracks();

    // Fetch a larger pool when personality filtering is active
    const poolSize = personality !== 'none' ? 80 : 50;
    let pool: Song[] = (await subsonic.getRandomSongs(poolSize))
      .filter((s) => !excludeIds.has(s.id))
      .filter((s) => {
        const key = `${s.title.toLowerCase().trim()}\0${s.artist.toLowerCase().trim()}`;
        const ignored = _ignoredSet.has(key);
        if (ignored) console.log(`[omniMux] Auto DJ: skipping ignored track "${s.title}" by "${s.artist}"`);
        return !ignored;
      });

    // Merge in mood-playlist songs if personality has keywords
    if (config.moodKeywords.length > 0) {
      try {
        const moodSongs = await getMoodPlaylistSongs(config.moodKeywords);
        if (moodSongs.length > 0) {
          const shuffled = moodSongs.sort(() => Math.random() - 0.5).slice(0, 30);
          const seen = new Set(pool.map((s) => s.id));
          pool = pool.concat(shuffled.filter((s) =>
            !seen.has(s.id) &&
            !excludeIds.has(s.id) &&
            !_ignoredSet.has(`${s.title.toLowerCase().trim()}\0${s.artist.toLowerCase().trim()}`)
          ));
        }
      } catch {
        // Mood playlist lookup failed — use random pool as-is
      }
    }

    // ── Hard-exclude genres that don't fit this personality ───────────────────
    if (config.excludeGenreKeywords.length > 0) {
      const lowerExcludes = config.excludeGenreKeywords.map((g) => g.toLowerCase());
      pool = pool.filter((s) => {
        if (!s.genre) return true; // unknown genre — give benefit of the doubt
        return !lowerExcludes.some((kw) => s.genre!.toLowerCase().includes(kw));
      });
      // If exclusion wiped the entire pool (tiny library edge case), restore pre-exclusion pool
      if (pool.length === 0) pool = (await subsonic.getRandomSongs(poolSize)).filter((s) => !excludeIds.has(s.id));
    }

    // ── Enrich the pool with mood/energy/key from our analysis DB ────────────
    try {
      const refs = pool.map((s) => ({ title: s.title, artist: s.artist }));
      const enriched = await api.enrichSongs(refs);
      for (const e of enriched) {
        const match = pool.find(
          (s) => s.title.toLowerCase() === e.title.toLowerCase() &&
                 s.artist.toLowerCase() === e.artist.toLowerCase()
        );
        if (match) {
          _enrichCache.set(match.id, { mood: e.mood ?? undefined, energy: e.energy ?? undefined, key: e.key ?? undefined });
        }
      }
    } catch {
      // Enrichment unavailable — continue with genre/BPM filtering only
    }

    // ── BPM range filter ─────────────────────────────────────────────────────
    let filtered = pool;
    if (config.bpmMin !== null || config.bpmMax !== null) {
      const inRange = pool.filter((s) => {
        if (!s.bpm) return false;
        if (config.bpmMin !== null && s.bpm < config.bpmMin) return false;
        if (config.bpmMax !== null && s.bpm > config.bpmMax) return false;
        return true;
      });
      // Songs with no BPM data are fallbacks only — don't include them if we have enough in-range
      filtered = inRange.length >= 5 ? inRange : inRange.length > 0 ? inRange : pool;
    }

    // ── Genre include filter ──────────────────────────────────────────────────
    if (config.genreKeywords.length > 0) {
      const lowerGenres = config.genreKeywords.map((g) => g.toLowerCase());
      const genreMatches = filtered.filter(
        (s) => s.genre && lowerGenres.some((kw) => s.genre!.toLowerCase().includes(kw))
      );
      if (genreMatches.length >= 5) filtered = genreMatches;
      // If < 5 genre matches, keep BPM-filtered pool (don't expand back to full pool)
    }

    // ── Energy filter (from enrichment data) ─────────────────────────────────
    if (config.minEnergy !== null || config.maxEnergy !== null) {
      const energyFiltered = filtered.filter((s) => {
        const e = _enrichCache.get(s.id);
        if (!e?.energy) return true; // no data — keep as fallback
        if (config.minEnergy !== null && e.energy < config.minEnergy) return false;
        if (config.maxEnergy !== null && e.energy > config.maxEnergy) return false;
        return true;
      });
      if (energyFiltered.length >= 3) filtered = energyFiltered;
    }

    // ── Mood filter (from enrichment data) ───────────────────────────────────
    if (config.allowedMoods && config.allowedMoods.length > 0) {
      const lowerMoods = config.allowedMoods.map((m) => m.toLowerCase());
      const moodFiltered = filtered.filter((s) => {
        const e = _enrichCache.get(s.id);
        if (!e?.mood) return true; // no mood data — give benefit of the doubt
        return lowerMoods.some((m) => e.mood!.toLowerCase().includes(m));
      });
      if (moodFiltered.length >= 3) filtered = moodFiltered;
    }

    // ── High-BPM priority (Workout) ───────────────────────────────────────────
    if (config.prioritizeHighBpm) {
      const withBpm = filtered.filter((s) => s.bpm).sort((a, b) => (b.bpm ?? 0) - (a.bpm ?? 0));
      if (withBpm.length > 0) {
        filtered = withBpm.slice(0, Math.max(1, Math.ceil(withBpm.length * 0.25)));
      }
    }

    // ── Candidate selection: BPM + harmonic + energy arc ─────────────────────
    let candidate: Song | undefined;

    // Compute energy arc target: ramp from minEnergy to minEnergy+0.2 over first 8 songs
    const arcTarget = (() => {
      if (config.minEnergy === null) return null;
      const rampSongs = 8;
      const songsPlayed = _setEnergyHistory.length;
      const t = Math.min(songsPlayed / rampSongs, 1);
      return config.minEnergy + t * 0.20;
    })();

    // Score each candidate: weighted sum of BPM match, energy arc proximity, harmonic compatibility
    function score(s: Song): number {
      let sc = 0;
      // BPM match
      if (currentBpm && s.bpm) {
        const bpmDiff = Math.abs(s.bpm - currentBpm) / currentBpm;
        sc += Math.max(0, 1 - bpmDiff / (tolerance * 2)) * 3;
      }
      const enrich = _enrichCache.get(s.id);
      // Energy arc
      if (enrich?.energy !== undefined && arcTarget !== null) {
        const eDiff = Math.abs(enrich.energy - arcTarget);
        sc += Math.max(0, 1 - eDiff / 0.3) * 2;
      }
      // Harmonic mixing
      if (config.harmonicMix && _currentEnrichment?.key && enrich?.key) {
        const ca = toCamelot(_currentEnrichment.key);
        const cb = toCamelot(enrich.key);
        if (ca && cb && isCompatibleKey(ca, cb)) sc += 4;
      }
      // Small random factor so identical scores shuffle nicely
      sc += Math.random() * 0.5;
      return sc;
    }

    if (filtered.length > 0) {
      // Sort by score and pick from the top 5 (preserves some randomness)
      const scored = filtered.slice().sort((a, b) => score(b) - score(a));
      candidate = scored[Math.floor(Math.random() * Math.min(5, scored.length))];
    }

    // Last resort: drop exclusions entirely (tiny library edge case), but still respect ignore flag
    if (!candidate) {
      const anyPool = (await subsonic.getRandomSongs(20))
        .filter((s) => !_ignoredSet.has(`${s.title.toLowerCase().trim()}\0${s.artist.toLowerCase().trim()}`));
      candidate = anyPool[Math.floor(Math.random() * anyPool.length)];
    }

    if (candidate) {
      const newTrack = await songToTrack(candidate);
      // Re-read upcoming queue at append time to handle concurrent edits
      const currentQ = get(queue);
      const currentIdx = get(queueIndex);
      const nowUpcoming = new Set(currentQ.slice(currentIdx + 1).map((t) => t.id));
      if (!nowUpcoming.has(newTrack.id)) {
        addToQueue(newTrack);
      }
      _fillFailures = 0;
    }
  } catch (e) {
    console.warn('[omniMux] Auto DJ fillQueue failed:', e);
    _fillFailures++;
    if (_fillFailures >= 3) {
      _fillFailures = 0;
      _showFillFailureToast();
    }
  } finally {
    _filling = false;
  }
}

function startQueueMonitor() {
  stopQueueMonitor();
  const remaining = derived([queue, queueIndex], ([q, i]) => q.length - i - 1);
  _queueMonitorUnsub = remaining.subscribe((r) => {
    if (!get(autoDJActive)) return;
    if (r <= 3) fillQueue();
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
    // Reset session state
    _setEnergyHistory.length = 0;
    _currentEnrichment = null;
  }
}

// Reset flags when the track changes so the next track can preload and fade.
// Also push the new track into the recently-played ring buffer and update
// the energy arc + current enrichment for harmonic mixing.
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
    // Update enrichment for the now-playing track
    _currentEnrichment = _enrichCache.get(t.id) ?? null;
    // Track energy arc (only when Auto DJ is active)
    if (get(autoDJActive) && _currentEnrichment?.energy !== undefined) {
      _setEnergyHistory.push(_currentEnrichment.energy);
      if (_setEnergyHistory.length > SET_ENERGY_WINDOW) _setEnergyHistory.shift();
    }
  }
});
