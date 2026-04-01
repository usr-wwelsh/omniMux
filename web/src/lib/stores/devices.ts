import { writable, get } from 'svelte/store';
import { api, type DeviceSession } from '$lib/api';
import { currentTrack, isPlaying, currentTime, playTrack } from './player';
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
    const all = await api.getDevices();
    otherDevices.set(all.filter((d) => d.device_id !== myDeviceId));
  } catch {}
}

export function startDeviceSync() {
  myDeviceId = getOrCreateDeviceId();
  sendHeartbeat();
  pollDevices();
  heartbeatTimer = setInterval(sendHeartbeat, 10_000);
  pollTimer = setInterval(pollDevices, 10_000);
}

export function stopDeviceSync() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
}

export async function listenHere(session: DeviceSession) {
  if (!session.track) return;
  const sUrl = await streamUrl(session.track.id);
  playTrack({
    id: session.track.id,
    title: session.track.title,
    artist: session.track.artist,
    album: session.track.album,
    albumId: '',
    duration: session.track.duration,
    streamUrl: sUrl,
    coverUrl: session.track.cover_url ?? undefined,
  });
}
