<script lang="ts">
  import { onDestroy } from 'svelte';
  import { queue, queueIndex, jumpToQueue, removeFromQueue, reorderQueue, clearQueue, formatTime } from '$lib/stores/player';

  // Mouse drag state
  let dragging = $state(-1);
  let dragOver = $state(-1);

  function onDragStart(e: DragEvent, i: number) {
    dragging = i;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOver = i;
  }

  function onDrop(e: DragEvent, i: number) {
    e.preventDefault();
    if (dragging !== -1 && dragging !== i) {
      reorderQueue(dragging, i);
    }
    dragging = -1;
    dragOver = -1;
  }

  function onDragEnd() {
    dragging = -1;
    dragOver = -1;
  }

  // Touch drag state
  let touchDragging = $state(-1);
  let touchDragOver = $state(-1);
  let touchStartY = 0;
  let touchStartX = 0;
  let touchActive = false;

  function onHandleTouchStart(e: TouchEvent, i: number) {
    e.stopPropagation(); // prevent fullscreen swipe-to-close
    touchDragging = i;
    touchDragOver = i;
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    touchActive = false;
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  function onTouchMove(e: TouchEvent) {
    if (touchDragging === -1) return;
    const touch = e.touches[0];
    if (!touchActive) {
      const dy = Math.abs(touch.clientY - touchStartY);
      const dx = Math.abs(touch.clientX - touchStartX);
      if (dy > 6 || dx > 6) touchActive = true;
    }
    if (touchActive) {
      e.preventDefault(); // block scroll while dragging
      e.stopPropagation();
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const item = el?.closest('[data-qi]');
      if (item) {
        const idx = parseInt((item as HTMLElement).dataset.qi ?? '-1');
        if (idx !== -1) touchDragOver = idx;
      }
    }
  }

  function onTouchEnd(e: TouchEvent) {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    if (touchActive && touchDragging !== -1 && touchDragOver !== -1 && touchDragging !== touchDragOver) {
      reorderQueue(touchDragging, touchDragOver);
    }
    touchDragging = -1;
    touchDragOver = -1;
    touchActive = false;
  }

  // Clean up any in-progress touch drag if the component unmounts mid-gesture
  onDestroy(() => {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
  });
</script>

<div class="queue-panel">
  {#if $queue.length === 0}
    <p class="queue-empty">Queue is empty</p>
  {:else}
    <div class="queue-header">
      <span class="queue-count">{$queue.length} tracks</span>
      <button class="queue-clear-btn" onclick={clearQueue} title="Clear queue">Clear</button>
    </div>
    <div class="queue-list">
      {#each $queue as track, i}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="queue-item"
          class:is-playing={i === $queueIndex}
          class:is-past={i < $queueIndex}
          class:is-dragging={dragging === i || touchDragging === i}
          class:is-drag-over={(dragOver === i && dragging !== i) || (touchDragOver === i && touchDragging !== i && touchActive)}
          data-qi={i}
          draggable="true"
          ondragstart={(e) => onDragStart(e, i)}
          ondragover={(e) => onDragOver(e, i)}
          ondrop={(e) => onDrop(e, i)}
          ondragend={onDragEnd}
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="drag-handle"
            title="Drag to reorder"
            ontouchstart={(e) => onHandleTouchStart(e, i)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </div>

          <button class="queue-track" onclick={() => jumpToQueue(i)}>
            {#if i === $queueIndex}
              <svg class="playing-icon" viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            {/if}
            <div class="queue-text">
              <div class="queue-title" class:accent={i === $queueIndex}>{track.title}</div>
              <div class="queue-meta">{track.artist} · {formatTime(track.duration)}</div>
            </div>
          </button>

          <button class="queue-remove" onclick={() => removeFromQueue(i)} title="Remove">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .queue-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .queue-empty {
    font-size: 14px;
    color: var(--text-subdued);
    text-align: center;
    padding: 40px 0;
  }

  .queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 8px;
  }

  .queue-count {
    font-size: 12px;
    color: var(--text-subdued);
  }

  .queue-clear-btn {
    font-size: 12px;
    color: var(--text-subdued);
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .queue-clear-btn:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 16px;
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
    border-radius: 6px;
    transition: background 0.1s;
    border: 2px solid transparent;
  }

  .queue-item:hover {
    background: var(--bg-elevated);
  }

  .queue-item.is-dragging {
    opacity: 0.4;
  }

  .queue-item.is-drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .queue-item.is-past {
    opacity: 0.45;
  }

  .drag-handle {
    padding: 8px 4px;
    color: var(--text-subdued);
    cursor: grab;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .queue-track {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    padding: 4px 0;
  }

  .playing-icon {
    flex-shrink: 0;
  }

  .queue-text {
    min-width: 0;
  }

  .queue-title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .queue-title.accent {
    color: var(--accent);
    font-weight: 600;
  }

  .queue-meta {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .queue-remove {
    padding: 8px;
    color: var(--text-subdued);
    flex-shrink: 0;
    display: flex;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .queue-item:hover .queue-remove {
    opacity: 1;
  }

  .queue-remove:hover {
    color: var(--danger);
  }

  @media (max-width: 768px) {
    .queue-remove {
      opacity: 1;
    }
  }
</style>
