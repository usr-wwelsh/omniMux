import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Two separate opt-ins, deliberately: this is the in-app switch a user
// flips in Settings. It does nothing on its own — the host still needs
// deploy/omnimux_updater.py installed, or getUpdateStatus() just reports
// unavailable and the banner never appears either way.
const STORAGE_KEY = 'omnimux-autoupdate';

const stored = browser ? localStorage.getItem(STORAGE_KEY) : null;

export const autoUpdateEnabled = writable<boolean>(stored === 'true');

if (browser) {
  autoUpdateEnabled.subscribe((v) => localStorage.setItem(STORAGE_KEY, String(v)));
}
