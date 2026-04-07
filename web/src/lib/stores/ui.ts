import { writable } from 'svelte/store';

export const showFullscreenPlayer = writable(false);
export const artModeActive = writable(false);
// Bump this to signal FullscreenPlayer to enter art/expanded mode
export const artExpandRequested = writable<number>(0);
// Auto DJ error toast — set to a message string to show, null to hide
export const autoDJToast = writable<string | null>(null);
