import type { Action } from 'svelte/action';

// Focus an input the moment it appears. Used in place of the `autofocus`
// attribute, which steals focus on page load; these inputs only exist after a
// deliberate click, so focusing them is what the user asked for.
export const focusOnMount: Action<HTMLInputElement, boolean | undefined> = (el, enabled = true) => {
  if (enabled === false) return;
  el.focus();
  el.select();
};
