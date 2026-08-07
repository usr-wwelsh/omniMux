import { describe, it, expect, beforeEach } from 'vitest';
import { scrollKey, rememberScroll, recallScroll, clearScrollMemory, restoreScroll, SCROLL_MEMORY_LIMIT } from './scrollMemory';

beforeEach(clearScrollMemory);

describe('scroll memory', () => {
  it('has nothing to recall for a page never visited', () => {
    expect(recallScroll('/library')).toBeUndefined();
  });

  it('recalls where a page was left', () => {
    rememberScroll('/library', 1840);
    expect(recallScroll('/library')).toBe(1840);
  });

  it('tracks searches separately from the bare page', () => {
    rememberScroll(scrollKey(new URL('https://x/search')), 0);
    rememberScroll(scrollKey(new URL('https://x/search?q=miles')), 620);
    expect(recallScroll('/search?q=miles')).toBe(620);
    expect(recallScroll('/search')).toBe(0);
  });

  it('forgets the oldest pages once the history grows past the limit', () => {
    rememberScroll('/oldest', 10);
    for (let i = 0; i < SCROLL_MEMORY_LIMIT; i++) rememberScroll(`/page-${i}`, i);
    expect(recallScroll('/oldest')).toBeUndefined();
    expect(recallScroll(`/page-${SCROLL_MEMORY_LIMIT - 1}`)).toBe(SCROLL_MEMORY_LIMIT - 1);
  });

  it('keeps a page fresh in the history when it is revisited', () => {
    rememberScroll('/library', 10);
    for (let i = 0; i < SCROLL_MEMORY_LIMIT - 1; i++) rememberScroll(`/page-${i}`, i);
    rememberScroll('/library', 20);
    rememberScroll('/one-more', 0);
    expect(recallScroll('/library')).toBe(20);
  });
});

// A scroll container that only accepts positions its content is tall enough for,
// the way a real element clamps scrollTop while its rows are still rendering.
function growingContainer(finalHeight: number, growAfter: number) {
  let top = 0;
  let frames = 0;
  return {
    get scrollTop() { return top; },
    set scrollTop(v: number) {
      const max = frames++ < growAfter ? 0 : finalHeight;
      top = Math.min(v, max);
    },
  } as HTMLElement;
}

describe('restoreScroll', () => {
  it('restores the position immediately when the content is already there', () => {
    const el = growingContainer(2000, 0);
    restoreScroll(el, 1840);
    expect(el.scrollTop).toBe(1840);
  });

  it('retries until the content is tall enough to hold the position', async () => {
    const el = growingContainer(2000, 2);
    restoreScroll(el, 1840);
    expect(el.scrollTop).toBe(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(el.scrollTop).toBe(1840);
  });

  it('keeps trying while a slow list is still filling in', async () => {
    const el = growingContainer(2000, 20);
    restoreScroll(el, 1840);
    await new Promise((r) => setTimeout(r, 500));
    expect(el.scrollTop).toBe(1840);
  });

  it('gives up rather than fighting a page that never grows', async () => {
    const el = growingContainer(0, Infinity);
    restoreScroll(el, 1840, 100);
    await new Promise((r) => setTimeout(r, 200));
    expect(el.scrollTop).toBe(0);
  });

  it('stops the moment the user scrolls for themselves', async () => {
    // Never grows tall enough for 1840, so the retry is still running when the
    // user takes over.
    const el = growingContainer(500, 0);
    restoreScroll(el, 1840);
    expect(el.scrollTop).toBe(500);
    el.scrollTop = 300;
    await new Promise((r) => setTimeout(r, 300));
    expect(el.scrollTop).toBe(300);
  });
});
