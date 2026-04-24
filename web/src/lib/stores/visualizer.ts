import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getAudio } from './player';

export type VisMode = 'off' | 'pan' | 'pulse' | 'warp' | 'ripple' | 'tunnel' | 'fractal' | 'kaleidoscope' | 'droste' | 'vortex' | 'glitch' | 'crystal' | 'aurora' | 'plasma' | 'sphere' | 'beatcut';

const stored = browser ? (localStorage.getItem('omnimux-vis-mode') as VisMode | null) : null;
export const visMode = writable<VisMode>(stored ?? 'pan');

if (browser) {
  visMode.subscribe((m) => localStorage.setItem('omnimux-vis-mode', m));
}

// ── Web Audio API singleton ──────────────────────────────────────────────────
// createMediaElementSource can only be called once per HTMLAudioElement,
// so these must be module-level singletons that survive art-mode open/close.

let _ctx: AudioContext | null = null;
let _analyser: AnalyserNode | null = null;      // vis + energy detection (fftSize=256, freq domain)
let _loudnessNode: AnalyserNode | null = null;  // RMS/LUFS measurement (fftSize=4096, time domain)
let _gainNode: GainNode | null = null;
let _connected = false;

export function getAnalyser(): AnalyserNode | null {
  if (typeof window === 'undefined') return null;

  if (!_ctx) {
    _ctx = new AudioContext();

    // Resume context when tab becomes visible again (browsers suspend on hide)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && _ctx?.state === 'suspended') _ctx.resume();
    });
  }

  if (_ctx.state === 'suspended') {
    _ctx.resume();
  }

  if (!_connected) {
    const audio = getAudio();
    const source = _ctx.createMediaElementSource(audio);
    _gainNode = _ctx.createGain();
    _gainNode.gain.value = 1.0;
    // Loudness analyser: large buffer (~93ms at 44.1kHz) for stable true-RMS measurement
    _loudnessNode = _ctx.createAnalyser();
    _loudnessNode.fftSize = 4096;
    // Vis analyser: small buffer for responsive frequency data
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize = 256; // 128 frequency bins
    _analyser.smoothingTimeConstant = 0.8;
    // Chain: source → gain → loudness tap → vis tap → speakers
    source.connect(_gainNode);
    _gainNode.connect(_loudnessNode);
    _loudnessNode.connect(_analyser);
    _analyser.connect(_ctx.destination);
    _connected = true;
  }

  return _analyser;
}

// ── Real-time loudness normalization ─────────────────────────────────────────
// Targets a consistent LUFS level across all tracks using true RMS on time-domain
// samples. Simplified ITU-R BS.1770 (no K-weighting — close enough for music).
//
// TARGET_LUFS: raise toward 0 for louder, lower toward -23 for quieter.
// -14 is the streaming standard (Spotify/YouTube); a safe loud target.
const TARGET_LUFS = -14;
const GAIN_MAX    = 4.0;    // max boost: 4× = +12 dB
const GAIN_MIN    = 0.05;   // max cut:  20× = -26 dB
const SILENCE_RMS = 0.0005; // ~-66 dBFS — skip adjustments below this

const RMS_WINDOW_SIZE = 6;  // sliding window: 6 × 150ms ≈ 900ms short-term average
let _rmsHistory: number[] = [];
let _autoGainTimer: ReturnType<typeof setInterval> | null = null;
let _gainSmoothed = 1.0;
let _gainFrozen = false; // true during crossfades so we don't fight the volume ramp

export function startAutoGain(): void {
  if (_autoGainTimer) return;
  getAnalyser(); // ensure audio chain is initialized
  _autoGainTimer = setInterval(() => {
    if (_gainFrozen) return;
    if (!_gainNode || !_loudnessNode || !_ctx) return;

    // True RMS from PCM samples (not frequency magnitudes)
    const buf = new Float32Array(_loudnessNode.fftSize);
    _loudnessNode.getFloatTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / buf.length);
    if (rms < SILENCE_RMS) return; // silence or pause — don't adjust

    // Sliding window smooths over transient peaks so we track program loudness
    _rmsHistory.push(rms);
    if (_rmsHistory.length > RMS_WINDOW_SIZE) _rmsHistory.shift();
    const avgRms = _rmsHistory.reduce((a, b) => a + b, 0) / _rmsHistory.length;

    // LUFS estimate: simplified BS.1770 (no K-weighting; within ~1 dB for music)
    const lufs = 20 * Math.log10(avgRms) - 0.691;
    const gainDb = TARGET_LUFS - lufs;
    const targetGain = Math.min(Math.max(10 ** (gainDb / 20), GAIN_MIN), GAIN_MAX);

    // Asymmetric smoothing: cut fast (prevents clipping), boost slowly (no pumping)
    const alpha = targetGain < _gainSmoothed ? 0.25 : 0.04;
    _gainSmoothed += (targetGain - _gainSmoothed) * alpha;

    _gainNode.gain.setTargetAtTime(_gainSmoothed, _ctx.currentTime, 0.05);
  }, 150);
}

export function stopAutoGain(): void {
  if (_autoGainTimer) { clearInterval(_autoGainTimer); _autoGainTimer = null; }
  if (_gainNode && _ctx) _gainNode.gain.setTargetAtTime(1.0, _ctx.currentTime, 1.0);
  _gainSmoothed = 1.0;
  _rmsHistory = [];
  _gainFrozen = false;
}

/** Freeze gain during a crossfade so the normalizer doesn't fight the volume ramp. */
export function freezeAutoGain(): void { _gainFrozen = true; }

/** Unfreeze and clear history so the new track calibrates from scratch. */
export function thawAutoGain(): void {
  _gainFrozen = false;
  _rmsHistory = [];
}

export function resumeContext(): void {
  if (_ctx?.state === 'suspended') _ctx.resume();
}

// ── Per-frame frequency helpers ──────────────────────────────────────────────
// Call fillFrequencyData once per frame, then pass the buffer to the other helpers.

export function fillFrequencyData(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): void {
  analyser.getByteFrequencyData(buf);
}

/** Bass energy: bins 0-3 (~0–688 Hz), returns 0..1 */
export function bassFromBuf(buf: Uint8Array<ArrayBuffer>): number {
  return (buf[0] + buf[1] + buf[2] + buf[3]) / 4 / 255;
}

/** Mid energy: bins 4-16 (~688 Hz–2.75 kHz), returns 0..1 */
export function midFromBuf(buf: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 4; i <= 16; i++) sum += buf[i];
  return (sum / 13) / 255;
}

/** Overall energy: average of all bins, returns 0..1 */
export function overallFromBuf(buf: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  return (sum / buf.length) / 255;
}

// ── Beat Detection (Spectral Flux) ──────────────────────────────────────────
// Detects onset (beat) by tracking positive energy delta in frequency spectrum.
// Spectral flux = sum of positive magnitude differences between consecutive frames.

let _prevFluxBuf: Float32Array | null = null;
let _lastBeatMs = 0;
const BEAT_COOLDOWN_MS = 200;   // max ~5 beats/s (~300 bpm)
const FLUX_THRESHOLD = 0.08;    // tune: higher = fewer false positives

export function detectBeat(buf: Uint8Array<ArrayBuffer>): boolean {
  const n = buf.length;
  if (!_prevFluxBuf || _prevFluxBuf.length !== n) {
    _prevFluxBuf = new Float32Array(n);
    for (let i = 0; i < n; i++) _prevFluxBuf[i] = buf[i] / 255;
    return false;
  }
  let flux = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[i] / 255;
    const diff = cur - _prevFluxBuf[i];
    if (diff > 0) flux += diff;
    _prevFluxBuf[i] = cur;
  }
  flux /= n;
  const now = performance.now();
  if (flux > FLUX_THRESHOLD && now - _lastBeatMs > BEAT_COOLDOWN_MS) {
    _lastBeatMs = now;
    return true;
  }
  return false;
}

export function resetBeatDetector(): void {
  _prevFluxBuf = null;
  _lastBeatMs = 0;
}
