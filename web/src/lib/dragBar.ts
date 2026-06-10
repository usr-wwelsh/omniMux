import type { Action } from 'svelte/action';

export interface DragBarOptions {
  // Fires on pointerdown and every move while dragging, with position as 0–1
  onDrag?: (pct: number) => void;
  // Fires on release with the final position
  onCommit: (pct: number) => void;
  // Fires if the gesture is cancelled (e.g. pointer capture lost)
  onCancel?: () => void;
}

// Pointer-drag handling for horizontal seek/volume bars. Click still works
// (down + up with no movement commits at the click position).
export const dragBar: Action<HTMLElement, DragBarOptions> = (el, opts) => {
  let options = opts;
  let dragging = false;

  function pct(e: PointerEvent) {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function down(e: PointerEvent) {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    options.onDrag?.(pct(e));
  }

  function move(e: PointerEvent) {
    if (dragging) options.onDrag?.(pct(e));
  }

  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    options.onCommit(pct(e));
  }

  function cancel() {
    if (!dragging) return;
    dragging = false;
    options.onCancel?.();
  }

  // Keep ancestor touch gestures (e.g. fullscreen swipe-to-close) out of a bar
  // drag. The full lifecycle must be swallowed: letting touchend through while
  // hiding touchstart makes the ancestor measure the swipe against a stale
  // start position from a previous touch.
  function swallowTouch(e: TouchEvent) {
    e.stopPropagation();
  }

  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('touchstart', swallowTouch);
  el.addEventListener('touchmove', swallowTouch);
  el.addEventListener('touchend', swallowTouch);

  return {
    update(newOpts: DragBarOptions) {
      options = newOpts;
    },
    destroy() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('touchstart', swallowTouch);
      el.removeEventListener('touchmove', swallowTouch);
      el.removeEventListener('touchend', swallowTouch);
    }
  };
};
