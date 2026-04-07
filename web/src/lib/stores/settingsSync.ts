import { get } from 'svelte/store';
import { api } from '../api';
import { crossfadeDuration, beatmatchEnabled, bpmTolerance, visCycleInterval, ambientIdleMinutes, djPersonality } from './autodj';
import { visMode } from './visualizer';
import { theme } from './theme';

let _loading = false;
let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _initialized = false;

function schedulePush() {
  if (_loading) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const data: Record<string, string> = {
      'omnimux-cf-dur': String(get(crossfadeDuration)),
      'omnimux-cf-beat': String(get(beatmatchEnabled)),
      'omnimux-bpm-tol': String(get(bpmTolerance)),
      'omnimux-vis-cycle': String(get(visCycleInterval)),
      'omnimux-ambient': String(get(ambientIdleMinutes)),
      'omnimux-vis-mode': String(get(visMode)),
      'omnimux-dj-personality': String(get(djPersonality)),
      'theme': String(get(theme)),
    };
    try {
      await api.putSettings(data);
    } catch {}
  }, 500);
}

export async function initSettingsSync() {
  if (_initialized) return;
  _initialized = true;

  // Subscribe to all settings stores so changes push to server
  crossfadeDuration.subscribe(() => schedulePush());
  beatmatchEnabled.subscribe(() => schedulePush());
  bpmTolerance.subscribe(() => schedulePush());
  visCycleInterval.subscribe(() => schedulePush());
  ambientIdleMinutes.subscribe(() => schedulePush());
  visMode.subscribe(() => schedulePush());
  djPersonality.subscribe(() => schedulePush());
  theme.subscribe(() => schedulePush());

  // Load server settings and apply them (server wins over localStorage)
  _loading = true;
  try {
    const data = await api.getSettings();
    if ('omnimux-cf-dur' in data) crossfadeDuration.set(Number(data['omnimux-cf-dur']));
    if ('omnimux-cf-beat' in data) beatmatchEnabled.set(data['omnimux-cf-beat'] === 'true');
    if ('omnimux-bpm-tol' in data) bpmTolerance.set(Number(data['omnimux-bpm-tol']));
    if ('omnimux-vis-cycle' in data) visCycleInterval.set(data['omnimux-vis-cycle'] as Parameters<typeof visCycleInterval.set>[0]);
    if ('omnimux-ambient' in data) ambientIdleMinutes.set(Number(data['omnimux-ambient']));
    if ('omnimux-vis-mode' in data) visMode.set(data['omnimux-vis-mode'] as Parameters<typeof visMode.set>[0]);
    if ('omnimux-dj-personality' in data) djPersonality.set(data['omnimux-dj-personality'] as Parameters<typeof djPersonality.set>[0]);
    if ('theme' in data) theme.set(data['theme'] as Parameters<typeof theme.set>[0]);
  } catch {}
  _loading = false;
}

export function resetSettingsSync() {
  _initialized = false;
}
