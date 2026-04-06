import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getAudio } from './player';

export type VisMode = 'off' | 'pan' | 'pulse' | 'warp' | 'ripple' | 'tunnel' | 'fractal' | 'kaleidoscope' | 'droste' | 'vortex' | 'glitch' | 'crystal' | 'aurora' | 'plasma' | 'sphere';

const stored = browser ? (localStorage.getItem('omnimux-vis-mode') as VisMode | null) : null;
export const visMode = writable<VisMode>(stored ?? 'pan');

if (browser) {
  visMode.subscribe((m) => localStorage.setItem('omnimux-vis-mode', m));
}

// ── Web Audio API singleton ──────────────────────────────────────────────────
// createMediaElementSource can only be called once per HTMLAudioElement,
// so these must be module-level singletons that survive art-mode open/close.

let _ctx: AudioContext | null = null;
let _analyser: AnalyserNode | null = null;
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
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize = 256; // 128 frequency bins
    _analyser.smoothingTimeConstant = 0.8;
    // Must route back to destination or audio goes silent
    source.connect(_gainNode);
    _gainNode.connect(_analyser);
    _analyser.connect(_ctx.destination);
    _connected = true;
  }

  return _analyser;
}

// ── Auto gain normalization ──────────────────────────────────────────────────

let _autoGainTimer: ReturnType<typeof setInterval> | null = null;
let _gainSmoothed = 1.0;
const _AUTO_GAIN_TARGET = 0.09; // target normalized overall RMS

export function startAutoGain(): void {
  if (_autoGainTimer) return;
  getAnalyser(); // ensure audio chain is initialized
  _autoGainTimer = setInterval(() => {
    if (!_gainNode || !_analyser || !_ctx) return;
    const buf = new Uint8Array(_analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    _analyser.getByteFrequencyData(buf);
    const overall = overallFromBuf(buf);
    if (overall < 0.01) return; // silence — don't adjust
    const target = Math.min(Math.max(_AUTO_GAIN_TARGET / overall, 0.15), 4.0);
    _gainSmoothed += (target - _gainSmoothed) * 0.03; // slow smoothing ~3s
    _gainNode.gain.setTargetAtTime(_gainSmoothed, _ctx.currentTime, 0.8);
  }, 150);
}

export function stopAutoGain(): void {
  if (_autoGainTimer) { clearInterval(_autoGainTimer); _autoGainTimer = null; }
  if (_gainNode && _ctx) _gainNode.gain.setTargetAtTime(1.0, _ctx.currentTime, 1.0);
  _gainSmoothed = 1.0;
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
