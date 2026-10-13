import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { writable } from 'svelte/store';

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const impl = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  vi.stubGlobal('localStorage', impl);
  return impl;
});

vi.mock('$app/state', () => ({ page: { url: new URL('http://x/') } }));
vi.mock('$app/navigation', () => ({ goto: () => {} }));
vi.mock('$lib/auth', () => ({ logout: () => {}, isGuest: writable(false) }));

import Sidebar from './Sidebar.svelte';
import { sidebarCollapsed } from '$lib/stores/ui';

beforeEach(() => sidebarCollapsed.set(false));
afterEach(cleanup);

describe('sidebar collapse', () => {
  it('starts expanded', () => {
    render(Sidebar);
    expect(screen.getByRole('navigation').classList.contains('collapsed')).toBe(false);
  });

  it('collapses when the toggle is pressed', async () => {
    render(Sidebar);
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('navigation').classList.contains('collapsed')).toBe(true);
  });

  it('expands again from the collapsed state', async () => {
    sidebarCollapsed.set(true);
    render(Sidebar);
    await fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('navigation').classList.contains('collapsed')).toBe(false);
  });

  it('keeps nav items reachable by name while collapsed', () => {
    sidebarCollapsed.set(true);
    render(Sidebar);
    expect(screen.getByRole('link', { name: 'Library' }).getAttribute('title')).toBe('Library');
  });

  it('remembers the choice across reloads', async () => {
    render(Sidebar);
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(storage.getItem('omnimux_sidebar_collapsed')).toBe('true');
  });
});
