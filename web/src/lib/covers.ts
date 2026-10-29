import { api } from './api';

let albums = new Set<string>();
let version = 0;
let settle: () => void = () => {};
let ready = new Promise<void>((resolve) => (settle = resolve));

export function applyCoverOverrides(state: { albums: string[]; version: number }): void {
  albums = new Set(state.albums);
  version = state.version;
  settle();
}

export function hasCoverOverride(albumId: string | undefined): boolean {
  return !!albumId && albums.has(albumId);
}

export function coverVersion(): number {
  return version;
}

export function coverOverridesReady(): Promise<void> {
  return ready;
}

export function resetCoverOverrides(): void {
  albums = new Set();
  version = 0;
  ready = new Promise<void>((resolve) => (settle = resolve));
}

export async function loadCoverOverrides(): Promise<void> {
  try {
    applyCoverOverrides(await api.getCoverOverrides());
  } catch {
    // covers still render, just without cache-busting
  } finally {
    settle();
  }
}

const MAX_EDGE = 1000;

export async function downscaleToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read image'))), 'image/jpeg', 0.9),
  );
}
