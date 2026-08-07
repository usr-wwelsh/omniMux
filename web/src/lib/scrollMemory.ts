// Scrolling happens inside .content-scroll, not the window, so SvelteKit's own
// scroll restoration never sees it. We remember each page's position ourselves
// and put it back when the user navigates history.

export const SCROLL_MEMORY_LIMIT = 30;

const positions = new Map<string, number>();

export function scrollKey(url: URL): string {
  return url.pathname + url.search;
}

export function rememberScroll(key: string, top: number): void {
  // Re-insert so the map stays in least-recently-visited order.
  positions.delete(key);
  positions.set(key, top);
  while (positions.size > SCROLL_MEMORY_LIMIT) {
    positions.delete(positions.keys().next().value!);
  }
}

export function recallScroll(key: string): number | undefined {
  return positions.get(key);
}

export function clearScrollMemory(): void {
  positions.clear();
}

const RESTORE_BUDGET_MS = 1500;

// The list is usually still filling in when we get here, and a container clamps
// scrollTop to the height it has so far — so keep reapplying until it sticks.
// Two things end the attempt: the position is reached, or the user scrolls, in
// which case they now own the scroll and we must not yank it back.
export function restoreScroll(el: HTMLElement, top: number, budgetMs = RESTORE_BUDGET_MS): void {
  if (top <= 0) {
    el.scrollTop = 0;
    return;
  }
  const deadline = Date.now() + budgetMs;
  let applied = -1;
  const step = () => {
    if (applied >= 0 && el.scrollTop !== applied) return;
    el.scrollTop = top;
    applied = el.scrollTop;
    if (applied < top - 1 && Date.now() < deadline) requestAnimationFrame(step);
  };
  step();
}
