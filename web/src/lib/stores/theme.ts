import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'spotify' | 'waybar' | 'win98' | 'bubblegum' | 'amber';

const stored = browser ? (localStorage.getItem('theme') as Theme | null) : null;

export const theme = writable<Theme>(stored ?? 'spotify');

if (browser) {
  theme.subscribe((t) => {
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  });
}
