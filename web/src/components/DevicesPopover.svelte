<script lang="ts">
  import { otherDevices, listenHere, type DeviceSession } from '$lib/stores/devices';

  let { onclose }: { onclose: () => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="popover-backdrop" onclick={onclose}></div>
<div class="devices-popover">
  <div class="popover-header">
    <span>Other Devices</span>
    <button class="close-btn" onclick={onclose}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  </div>

  {#if $otherDevices.length === 0}
    <p class="empty-text">No other active devices</p>
  {:else}
    <ul class="device-list">
      {#each $otherDevices as device}
        <li class="device-item">
          <div class="device-info">
            <div class="device-name">{device.device_name}</div>
            {#if device.track}
              <div class="device-track">{device.track.title} — {device.track.artist}</div>
            {:else}
              <div class="device-track idle">Idle</div>
            {/if}
          </div>
          {#if device.track}
            <button class="listen-btn" onclick={() => { listenHere(device); onclose(); }}>
              Listen here
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
  }

  .devices-popover {
    position: fixed;
    right: 16px;
    bottom: calc(var(--player-height) + 8px);
    width: 280px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    z-index: 301;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  @media (max-width: 768px) {
    .devices-popover {
      right: 8px;
      left: 8px;
      width: auto;
      bottom: calc(var(--bottom-nav-height) + var(--mini-player-height) + 8px);
    }
  }

  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
  }

  .close-btn {
    color: var(--text-subdued);
    display: flex;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .empty-text {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
    padding: 8px 0;
  }

  .device-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    background: var(--bg-secondary);
  }

  .device-info {
    flex: 1;
    min-width: 0;
  }

  .device-name {
    font-size: 13px;
    font-weight: 500;
  }

  .device-track {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .device-track.idle {
    color: var(--text-subdued);
  }

  .listen-btn {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--accent);
    transition: background 0.15s;
  }

  .listen-btn:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
</style>
