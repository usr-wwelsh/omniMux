import { writable, get } from 'svelte/store';
import { api, type DeviceSession } from '$lib/api';
import { currentTrack, isPlaying, currentTime, playTrack, seek, localDeviceId, activeDeviceId, applyServerQueueState, recoverPlayback, type Track } from './player';
import { artModeActive } from './ui';
import { autoDJActive } from './autodj';
import { streamUrl } from '$lib/subsonic';

export { type DeviceSession };

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((b, i) =>
    [4, 6, 8, 10].includes(i) ? '-' + b.toString(16).padStart(2, '0') : b.toString(16).padStart(2, '0')
  ).join('');
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('omnimux-device-id');
  if (!id) {
    id = generateId();
    localStorage.setItem('omnimux-device-id', id);
  }
  return id;
}

export type DeviceType = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'unknown';

export interface DeviceInfo {
  name: string;
  type: DeviceType;
  os: string;
  browser: string;
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

// Browsers can't report an exact device model — iOS only ever says "iPhone", and
// laptop-vs-desktop has no reliable API. We classify by OS + form factor heuristics
// and pair it with the browser name for a recognizable label.
function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints || 0;
  const browser = detectBrowser(ua);

  if (/iPhone/.test(ua)) return { name: 'iPhone', type: 'phone', os: 'iOS', browser };
  if (/iPad/.test(ua)) return { name: 'iPad', type: 'tablet', os: 'iPadOS', browser };
  if (/Android/.test(ua)) {
    const phone = /Mobile/.test(ua);
    return { name: phone ? 'Android Phone' : 'Android Tablet', type: phone ? 'phone' : 'tablet', os: 'Android', browser };
  }
  if (/Macintosh/.test(ua)) {
    // iPadOS in desktop mode reports as Macintosh but exposes touch points.
    if (touch > 1) return { name: 'iPad', type: 'tablet', os: 'iPadOS', browser };
    return { name: 'Mac', type: 'laptop', os: 'macOS', browser };
  }
  if (/Windows/.test(ua)) return { name: 'Windows PC', type: 'desktop', os: 'Windows', browser };
  if (/Linux/.test(ua)) return { name: 'Linux PC', type: 'desktop', os: 'Linux', browser };
  return { name: 'Browser', type: 'unknown', os: '', browser };
}

export const otherDevices = writable<DeviceSession[]>([]);

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let queuePollTimer: ReturnType<typeof setInterval> | null = null;
let artModeUnsubscribe: (() => void) | null = null;
let autoDJUnsubscribe: (() => void) | null = null;
let myDeviceId = '';

async function sendHeartbeat() {
  const track = get(currentTrack);
  const info = detectDevice();
  try {
    await api.deviceHeartbeat({
      device_id: myDeviceId,
      device_name: info.name,
      device_type: info.type,
      os: info.os,
      browser: info.browser,
      track: track
        ? { id: track.id, title: track.title, artist: track.artist, album: track.album, cover_url: track.coverUrl ?? null, duration: track.duration }
        : null,
      is_playing: get(isPlaying),
      current_time: get(currentTime),
    });
  } catch {}
}

async function pollDevices() {
  try {
    const receivedAt = Date.now();
    const all = await api.getDevices();
    const others = all
      .filter((d) => d.device_id !== myDeviceId)
      .map((d) => ({ ...d, received_at_ms: receivedAt }));
    otherDevices.set(others);

    // If another device is the active player, extrapolate its position into currentTime
    // so the progress bar stays live without audio running here.
    const activeId = get(activeDeviceId);
    if (activeId && activeId !== myDeviceId) {
      const activeDev = others.find((d) => d.device_id === activeId);
      if (activeDev && activeDev.is_playing) {
        const elapsed = (Date.now() - receivedAt) / 1000; // negligible on LAN
        const extrapolated = Math.min(activeDev.current_time + elapsed, activeDev.track?.duration ?? Infinity);
        currentTime.set(extrapolated);
      }
    }
  } catch {}
}

async function pollQueue() {
  try {
    const state = await api.getQueue();
    if (state.tracks.length === 0) return;
    applyServerQueueState(
      state.tracks as Track[],
      state.index,
      state.active_device_id,
      state.seek_to,
      state.seek_issued_at,
      state.queue_version ?? 0,
    );
  } catch {}
}

function restartTimers(slow: boolean) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (queuePollTimer) clearInterval(queuePollTimer);
  // Issue 6: keep polling at 1s when Auto DJ is active — crossfades complete in ~5s,
  // so 5s polling would cause other devices to miss them entirely in art mode.
  const effectivelySlow = slow && !get(autoDJActive);
  const ms = effectivelySlow ? 5_000 : 1_000;
  heartbeatTimer = setInterval(sendHeartbeat, ms);
  pollTimer = setInterval(pollDevices, ms);
  queuePollTimer = setInterval(pollQueue, ms);
}

// Re-establish audio playback as soon as the network comes back (wifi→cell, etc.).
const onOnline = () => recoverPlayback();

export function startDeviceSync() {
  myDeviceId = getOrCreateDeviceId();
  localDeviceId.set(myDeviceId);
  sendHeartbeat();
  pollDevices();
  pollQueue();
  restartTimers(false);
  artModeUnsubscribe = artModeActive.subscribe((active) => restartTimers(active));
  // Issue 6: also restart timers when Auto DJ toggles so art-mode slowdown is overridden
  autoDJUnsubscribe = autoDJActive.subscribe(() => restartTimers(get(artModeActive)));
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
}

export function stopDeviceSync() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (queuePollTimer) clearInterval(queuePollTimer);
  artModeUnsubscribe?.();
  autoDJUnsubscribe?.();
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
}

export async function listenHere(session: DeviceSession) {
  if (!session.track) return;
  const sUrl = await streamUrl(session.track.id);
  const startAt = session.current_time ?? 0;
  playTrack({
    id: session.track.id,
    title: session.track.title,
    artist: session.track.artist,
    album: session.track.album,
    artistId: '',
    albumId: '',
    duration: session.track.duration,
    streamUrl: sUrl,
    coverUrl: session.track.cover_url ?? undefined,
  });
  if (startAt > 1) {
    seek(startAt);
  }
}
