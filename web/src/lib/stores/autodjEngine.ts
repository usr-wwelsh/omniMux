// Pure, side-effect-free Auto DJ track-selection logic — no Svelte stores, no DOM, no network.
// Shared by the live store (`autodj.ts`, which supplies pool/config from real stores + API
// calls) and by scripts/simulate-autodj.ts (which supplies pool/config from a snapshotted
// library, so it can Monte Carlo thousands of sessions offline).
import type { Song } from '../subsonic';
import type { DJMeta } from './player';

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
    pitchSlop: 0.005, energyDropThreshold: null, maxPlaySeconds: null,
    prioritizeHighBpm: false, minEnergy: null, maxEnergy: null,
    allowedMoods: null, harmonicMix: false,
  },
  club: {
    label: 'Club', description: 'Dance/EDM — skip to the drop',
    bpmMin: 120, bpmMax: null, skipIntroSeconds: 45,
    moodKeywords: ['energetic', 'upbeat', 'dance'],
    genreKeywords: ['dance', 'edm', 'electronic', 'house', 'techno', 'trance', 'electro', 'club'],
    excludeGenreKeywords: ['ambient', 'classical', 'new age', 'acoustic', 'folk', 'country', 'blues', 'jazz', 'sleep', 'meditation'],
    pitchSlop: 0.004, energyDropThreshold: 0.15, maxPlaySeconds: 150,
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
    pitchSlop: 0.006, energyDropThreshold: null, maxPlaySeconds: null,
    prioritizeHighBpm: false, minEnergy: null, maxEnergy: 0.60,
    allowedMoods: ['chill', 'mellow', 'happy', 'peaceful', 'calm'],
    harmonicMix: true,
  },
  workout: {
    label: 'Workout', description: 'High-energy — ~1 min per track',
    bpmMin: 130, bpmMax: null, skipIntroSeconds: 20,
    moodKeywords: ['energetic', 'intense', 'upbeat'],
    genreKeywords: [], excludeGenreKeywords: ['ambient', 'classical', 'new age', 'acoustic', 'folk', 'sleep'],
    pitchSlop: 0.003, energyDropThreshold: null, maxPlaySeconds: 60,
    prioritizeHighBpm: true, minEnergy: 0.70, maxEnergy: null,
    allowedMoods: ['energetic', 'intense', 'upbeat', 'excited', 'angry'],
    harmonicMix: false,
  },
};

// For club/workout: if the incoming track is longer than 4 minutes, skip to the
// halfway point (right before a likely peak) instead of the fixed intro offset.
export function resolveSkipIntro(config: PersonalityConfig, track: { duration: number }): number {
  if (config.skipIntroSeconds > 0 && track.duration > 240) {
    return Math.floor(track.duration * 0.5);
  }
  return config.skipIntroSeconds;
}

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

export function toCamelot(rawKey: string): string | null {
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

export function isCompatibleKey(a: string, b: string): boolean {
  if (a === b) return true;
  const numA = parseInt(a), numB = parseInt(b);
  const modeA = a.slice(-1), modeB = b.slice(-1);
  if (modeA === modeB) {
    const diff = Math.abs(numA - numB);
    return diff === 1 || diff === 11; // adjacent on the wheel (wraps 12→1)
  }
  return numA === numB; // same number, relative major/minor
}

// ── Candidate selection pipeline ──────────────────────────────────────────────

export type Enrichment = { mood?: string; energy?: number; key?: string };

export interface SelectionContext {
  config: PersonalityConfig;
  currentBpm?: number;
  bpmTolerance: number;                    // fraction, e.g. 0.10
  enrichCache: Map<string, Enrichment>;    // navidrome song id → enrichment
  currentEnrichment: Enrichment | null;
  songsPlayedThisSession: number;          // drives the energy-arc ramp
}

export interface SelectionDiagnostics {
  poolSize: number;
  afterGenreExclude: number;
  usedGenreExcludeFallback: boolean;
  afterBpmFilter: number;
  afterGenreInclude: number;
  afterEnergyFilter: number;
  usedEnergyFallback: boolean;
  afterMoodFilter: number;
  afterHighBpmPriority: number;
}

export interface SelectionResult {
  candidate?: Song;
  meta?: DJMeta;
  diagnostics: SelectionDiagnostics;
}

// Compute energy arc target: ramp from minEnergy to minEnergy+0.2 over first 8 songs.
export function computeArcTarget(config: PersonalityConfig, songsPlayedThisSession: number): number | null {
  if (config.minEnergy === null) return null;
  const rampSongs = 8;
  const t = Math.min(songsPlayedThisSession / rampSongs, 1);
  return config.minEnergy + t * 0.20;
}

export function scoreCandidate(s: Song, ctx: SelectionContext, arcTarget: number | null): { total: number; meta: DJMeta } {
  const { config, currentBpm, bpmTolerance, enrichCache, currentEnrichment } = ctx;
  let bpm = 0, energy = 0;
  let harmonic = false;
  if (currentBpm && s.bpm) {
    const bpmDiff = Math.abs(s.bpm - currentBpm) / currentBpm;
    bpm = Math.max(0, 1 - bpmDiff / (bpmTolerance * 2)) * 3;
  }
  const enrich = enrichCache.get(s.id);
  if (enrich?.energy !== undefined && arcTarget !== null) {
    const eDiff = Math.abs(enrich.energy - arcTarget);
    energy = Math.max(0, 1 - eDiff / 0.3) * 2;
  }
  if (config.harmonicMix && currentEnrichment?.key && enrich?.key) {
    const ca = toCamelot(currentEnrichment.key);
    const cb = toCamelot(enrich.key);
    if (ca && cb && isCompatibleKey(ca, cb)) harmonic = true;
  }
  const total = bpm + energy + (harmonic ? 4 : 0) + Math.random() * 0.5;
  return { total, meta: { bpm, energy, harmonic } };
}

// Runs the full personality filter/score pipeline against an already-sourced pool
// (random songs + mood-playlist merge — that part stays I/O-bound in the caller).
// Pure and deterministic apart from Math.random() jitter in scoring/top-5 pick.
export function selectNextTrack(rawPool: Song[], ctx: SelectionContext): SelectionResult {
  const { config, enrichCache } = ctx;
  const poolSize = rawPool.length;

  // ── Hard-exclude genres that don't fit this personality ───────────────────
  let pool = rawPool;
  let usedGenreExcludeFallback = false;
  if (config.excludeGenreKeywords.length > 0) {
    const lowerExcludes = config.excludeGenreKeywords.map((g) => g.toLowerCase());
    const isExcluded = (s: Song) => !!s.genre && lowerExcludes.some((kw) => s.genre!.toLowerCase().includes(kw));
    // Personalities with a positive genreKeywords list know what they want — don't let
    // untagged tracks (e.g. genre-less YouTube rips) sneak past exclusion via "benefit of
    // the doubt". Personalities with only an exclude-list (no positive list) keep the
    // permissive behavior, since they have no other way to admit untagged tracks at all.
    const requireGenre = config.genreKeywords.length > 0;
    let strictPool = rawPool.filter((s) => !isExcluded(s) && (!requireGenre || !!s.genre));
    if (strictPool.length < 5) {
      strictPool = rawPool.filter((s) => !isExcluded(s)); // fall back: allow untagged
      usedGenreExcludeFallback = true;
    }
    // Tiny-library edge case: if exclusion wiped everything, give up on genre exclusion
    // entirely rather than reaching back out over the network for a fresh pool.
    pool = strictPool.length > 0 ? strictPool : rawPool;
  }
  const afterGenreExclude = pool.length;

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
    filtered = inRange.length > 0 ? inRange : pool;
  }
  const afterBpmFilter = filtered.length;

  // ── Genre include filter ──────────────────────────────────────────────────
  if (config.genreKeywords.length > 0) {
    const lowerGenres = config.genreKeywords.map((g) => g.toLowerCase());
    const genreMatches = filtered.filter(
      (s) => s.genre && lowerGenres.some((kw) => s.genre!.toLowerCase().includes(kw))
    );
    if (genreMatches.length >= 5) filtered = genreMatches;
    // If < 5 genre matches, keep BPM-filtered pool (don't expand back to full pool)
  }
  const afterGenreInclude = filtered.length;

  // ── Energy filter (from enrichment data) ─────────────────────────────────
  let usedEnergyFallback = false;
  if (config.minEnergy !== null || config.maxEnergy !== null) {
    const matchesEnergy = (e: Enrichment | undefined) => {
      if (!e?.energy) return false;
      if (config.minEnergy !== null && e.energy < config.minEnergy) return false;
      if (config.maxEnergy !== null && e.energy > config.maxEnergy) return false;
      return true;
    };
    // Strict pass first: a hard energy floor/ceiling shouldn't be waved through for
    // untagged tracks — that's how a low-energy track ends up next to a floor-stomper.
    // Only fall back to admitting untagged tracks if strict filtering starves the pool.
    const strict = filtered.filter((s) => matchesEnergy(enrichCache.get(s.id)));
    if (strict.length >= 3) {
      filtered = strict;
    } else {
      const permissive = filtered.filter((s) => {
        const e = enrichCache.get(s.id);
        return !e?.energy || matchesEnergy(e); // no data — keep as fallback
      });
      if (permissive.length >= 3) { filtered = permissive; usedEnergyFallback = true; }
    }
  }
  const afterEnergyFilter = filtered.length;

  // ── Mood filter (from enrichment data) ───────────────────────────────────
  if (config.allowedMoods && config.allowedMoods.length > 0) {
    const lowerMoods = config.allowedMoods.map((m) => m.toLowerCase());
    const moodFiltered = filtered.filter((s) => {
      const e = enrichCache.get(s.id);
      if (!e?.mood) return true; // no mood data — give benefit of the doubt
      return lowerMoods.some((m) => e.mood!.toLowerCase().includes(m));
    });
    if (moodFiltered.length >= 3) filtered = moodFiltered;
  }
  const afterMoodFilter = filtered.length;

  // ── High-BPM priority (Workout) ───────────────────────────────────────────
  if (config.prioritizeHighBpm) {
    const withBpm = filtered.filter((s) => s.bpm).sort((a, b) => (b.bpm ?? 0) - (a.bpm ?? 0));
    if (withBpm.length > 0) {
      filtered = withBpm.slice(0, Math.max(1, Math.ceil(withBpm.length * 0.25)));
    }
  }
  const afterHighBpmPriority = filtered.length;

  const diagnostics: SelectionDiagnostics = {
    poolSize, afterGenreExclude, usedGenreExcludeFallback, afterBpmFilter,
    afterGenreInclude, afterEnergyFilter, usedEnergyFallback, afterMoodFilter,
    afterHighBpmPriority,
  };

  // ── Candidate selection: BPM + harmonic + energy arc ─────────────────────
  if (filtered.length === 0) return { diagnostics };

  const arcTarget = computeArcTarget(config, ctx.songsPlayedThisSession);
  const scored = filtered
    .map((s) => ({ s, ...scoreCandidate(s, ctx, arcTarget) }))
    .sort((a, b) => b.total - a.total);
  // Sort by score and pick from the top 5 (preserves some randomness)
  const pick = scored[Math.floor(Math.random() * Math.min(5, scored.length))];
  return { candidate: pick.s, meta: pick.meta, diagnostics };
}
