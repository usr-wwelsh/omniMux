import { writable } from 'svelte/store';
import type { Song } from '$lib/subsonic';

export const showFullscreenPlayer = writable(false);
// Set to a song to open the "Add to playlist" modal for it, null to close.
export const addToPlaylistTarget = writable<Song | null>(null);
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
