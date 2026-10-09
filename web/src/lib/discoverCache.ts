import type { DiscoverResult } from './api';

export const DISCOVER_TTL_MS = 10 * 60 * 1000;

interface Entry {
  suggestions: DiscoverResult[];
  images: Map<string, string>;
  at: number;
}

let entry: Entry | null = null;

export function rememberDiscover(suggestions: DiscoverResult[], images: Map<string, string>, now = Date.now()): void {
  entry = { suggestions, images, at: now };
}

export function recallDiscover(now = Date.now()): Entry | null {
  return entry && now - entry.at < DISCOVER_TTL_MS ? entry : null;
}

export function clearDiscover(): void {
  entry = null;
}
