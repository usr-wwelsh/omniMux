import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { subsonic } from '../subsonic';
import {
  queue, queueIndex, currentTrack, loop,
  songToTrack, addToQueue,
  startCrossfade, stopCrossfade, registerCrossfadeChecker, preloadCrossfadeTrack,
} from './player';
import { visMode, type VisMode } from './visualizer';
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

// ── Runtime state ─────────────────────────────────────────────────────────────

export const autoDJActive = writable<boolean>(false);

// ── Crossfade checker (registered with player.ts) ─────────────────────────────

const PRELOAD_AHEAD = 10; // seconds before crossfade window to start buffering
let _crossfadeCheckActive = false;
let _preloadTriggered = false;

function crossfadeCheck(ct: number, dur: number) {
  if (!get(autoDJActive)) return;
  const cfSecs = get(crossfadeDuration);
  if (cfSecs === 0) return;
  if (!dur || ct <= 0) return;

  const remaining = dur - ct;
  const q = get(queue);
  const idx = get(queueIndex);
  if (idx >= q.length - 1) return;

  const nextTrack = q[idx + 1];

  // Preload next track early so it's buffered when the crossfade window opens
  if (!_preloadTriggered && remaining <= cfSecs + PRELOAD_AHEAD) {
    _preloadTriggered = true;
    preloadCrossfadeTrack(nextTrack);
  }

  if (!_crossfadeCheckActive && remaining <= cfSecs) {
    _crossfadeCheckActive = true;
    startCrossfade(idx + 1, cfSecs, get(beatmatchEnabled));
  }
}

// ── Queue monitor ─────────────────────────────────────────────────────────────

let _queueMonitorUnsub: (() => void) | null = null;
let _filling = false;

async function fillQueue() {
  if (_filling) return;
  if (get(loop) === 'one') return;
  _filling = true;
  try {
    const songs = await subsonic.getRandomSongs(50);
    const track = get(currentTrack);
    const currentBpm = track?.bpm;
    const tolerance = get(bpmTolerance) / 100;

    let candidate = undefined;
    if (currentBpm) {
      const matches = songs.filter(
        (s) => s.bpm && s.bpm >= currentBpm * (1 - tolerance) && s.bpm <= currentBpm * (1 + tolerance)
      );
      if (matches.length > 0) {
        candidate = matches[Math.floor(Math.random() * matches.length)];
      }
    }
    if (!candidate) {
      candidate = songs[Math.floor(Math.random() * songs.length)];
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

const VIS_CYCLE: VisMode[] = ['pan', 'pulse', 'warp', 'ripple'];
let _visCycleTimer: ReturnType<typeof setInterval> | null = null;
let _visCycleTrackUnsub: (() => void) | null = null;
let _visCycleFirstFire = true;

function advanceVis() {
  const current = get(visMode);
  const idx = VIS_CYCLE.indexOf(current);
  visMode.set(VIS_CYCLE[(idx === -1 ? 0 : idx + 1) % VIS_CYCLE.length]);
}

function startVisCycler() {
  stopVisCycler();
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
    fillQueue();
  } else {
    registerCrossfadeChecker(null);
    stopCrossfade();
    _crossfadeCheckActive = false;
    _preloadTriggered = false;
    stopQueueMonitor();
    stopVisCycler();
  }
}

// Reset flags when the track changes so the next track can preload and fade
currentTrack.subscribe(() => {
  _crossfadeCheckActive = false;
  _preloadTriggered = false;
});
