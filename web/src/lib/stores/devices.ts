import { writable, get } from 'svelte/store';
import { api, type DeviceSession } from '$lib/api';
import { currentTrack, isPlaying, currentTime, playTrack, seek, localDeviceId, activeDeviceId, applyServerQueueState, type Track } from './player';
import { artModeActive } from './ui';
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

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  const platform = navigator.platform || '';
  if (/Mac/.test(platform)) return 'Mac';
  if (/Win/.test(platform)) return 'Windows';
  if (/Linux/.test(platform)) return 'Linux';
  return 'Browser';
}

export const otherDevices = writable<DeviceSession[]>([]);

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let queuePollTimer: ReturnType<typeof setInterval> | null = null;
let artModeUnsubscribe: (() => void) | null = null;
let myDeviceId = '';

async function sendHeartbeat() {
  const track = get(currentTrack);
  try {
    await api.deviceHeartbeat({
      device_id: myDeviceId,
      device_name: getDeviceName(),
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
        const extrapolated = activeDev.current_time + elapsed;
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
    );
  } catch {}
}

function restartTimers(slow: boolean) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (queuePollTimer) clearInterval(queuePollTimer);
  const ms = slow ? 5_000 : 1_000;
  heartbeatTimer = setInterval(sendHeartbeat, ms);
  pollTimer = setInterval(pollDevices, ms);
  queuePollTimer = setInterval(pollQueue, ms);
}

export function startDeviceSync() {
  myDeviceId = getOrCreateDeviceId();
  localDeviceId.set(myDeviceId);
  sendHeartbeat();
  pollDevices();
  pollQueue();
  restartTimers(false);
  artModeUnsubscribe = artModeActive.subscribe((active) => restartTimers(active));
}

export function stopDeviceSync() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (queuePollTimer) clearInterval(queuePollTimer);
  artModeUnsubscribe?.();
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
