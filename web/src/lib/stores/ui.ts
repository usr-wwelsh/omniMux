import { writable } from 'svelte/store';

export const showFullscreenPlayer = writable(false);
export const artModeActive = writable(false);
// Bump this to signal FullscreenPlayer to enter art/expanded mode
export const artExpandRequested = writable<number>(0);
// Auto DJ error toast — set to a message string to show, null to hide
export const autoDJToast = writable<string | null>(null);

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('omnimux_nowplaying_collapsed') : null;
export const nowPlayingCollapsed = writable<boolean>(stored ? JSON.parse(stored) : true);

nowPlayingCollapsed.subscribe((value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('omnimux_nowplaying_collapsed', JSON.stringify(value));
  }
});
