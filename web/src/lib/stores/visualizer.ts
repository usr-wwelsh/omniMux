import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getAudio } from './player';

export type VisMode = 'off' | 'pan' | 'pulse' | 'warp' | 'ripple';

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
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize = 256; // 128 frequency bins
    _analyser.smoothingTimeConstant = 0.8;
    // Must route back to destination or audio goes silent
    source.connect(_analyser);
    _analyser.connect(_ctx.destination);
    _connected = true;
  }

  return _analyser;
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
