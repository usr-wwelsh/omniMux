<script lang="ts">
  import { api } from '$lib/api';
  import { pendingCommits, phaseLabel, type UpdateCommit } from '$lib/updateBanner';
  import { autoUpdateEnabled } from '$lib/stores/updates';

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const PROGRESS_POLL_MS = 1000;

  let commits = $state<UpdateCommit[]>([]);
  let showChangelog = $state(false);
  let applying = $state(false);
  let phase = $state('starting');
  let percent = $state(0);
  let errorMsg = $state('');

  let progressTimer: ReturnType<typeof setInterval> | null = null;

  async function checkStatus() {
    if (applying) return;
    try {
      const status = await api.getUpdateStatus();
      commits = pendingCommits(status);
    } catch {
      commits = [];
    }
  }

  $effect(() => {
    if (!$autoUpdateEnabled) {
      commits = [];
      return;
    }
    checkStatus();
    const timer = setInterval(checkStatus, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  $effect(() => () => {
    if (progressTimer) clearInterval(progressTimer);
  });

  async function startUpdate() {
    errorMsg = '';
    const result = await api.applyUpdate();
    if (!result.accepted) {
      errorMsg = result.reason ?? 'Could not start update';
      return;
    }
    applying = true;
    phase = 'starting';
    percent = 0;
    progressTimer = setInterval(pollProgress, PROGRESS_POLL_MS);
  }

  async function pollProgress() {
    try {
      const progress = await api.getUpdateProgress();
      // Unavailable mid-poll almost always means the api container is
      // being recreated by the update it triggered — keep waiting.
      if (!progress.available) return;

      phase = progress.phase ?? phase;
      percent = progress.percent ?? percent;

      if (phase === 'error') {
        errorMsg = progress.error ?? 'Update failed';
        stopPolling();
      } else if (phase === 'done') {
        percent = 100;
        stopPolling();
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch {
      // Same as above: transient during the container restart.
    }
  }

  function stopPolling() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }
</script>

{#if applying}
  <div class="update-banner">
    <div class="banner-bar">
      <span class="banner-text">{phaseLabel(phase)}</span>
      <div class="progress-track">
        <div class="progress-fill" style={`width: ${percent}%`}></div>
      </div>
    </div>
    {#if errorMsg}
      <div class="banner-error">{errorMsg}</div>
    {/if}
  </div>
{:else if commits.length > 0}
  <div class="update-banner">
    <div class="banner-bar">
      <span class="banner-text">Update available</span>
      <span class="banner-divider">·</span>
      <button class="changelog-btn" onclick={() => (showChangelog = !showChangelog)}>
        {commits.length} commit{commits.length === 1 ? '' : 's'} {showChangelog ? '▲' : '▼'}
      </button>
      <button class="update-btn" onclick={startUpdate}>Update now</button>
    </div>
    {#if showChangelog}
      <ul class="changelog">
        {#each commits as commit (commit.hash)}
          <li><code>{commit.hash}</code> {commit.subject}</li>
        {/each}
      </ul>
    {/if}
    {#if errorMsg}
      <div class="banner-error">{errorMsg}</div>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    width: 100%;
  }

  .banner-bar {
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .banner-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .banner-divider {
    opacity: 0.5;
    color: var(--text-secondary);
  }

  .changelog-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: color 0.15s;
  }

  .changelog-btn:hover {
    color: var(--text-primary);
  }

  .update-btn {
    background: var(--accent, #1db954);
    border: none;
    color: #000;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .update-btn:hover {
    opacity: 0.85;
  }

  .changelog {
    list-style: none;
    margin: 0;
    padding: 8px 16px 12px;
    max-height: 160px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .changelog li {
    padding: 2px 0;
  }

  .changelog code {
    color: var(--text-subdued);
    margin-right: 6px;
  }

  .progress-track {
    width: 140px;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent, #1db954);
    transition: width 0.3s ease-out;
  }

  .banner-error {
    padding: 6px 16px 10px;
    font-size: 12px;
    color: #ff5c5c;
    text-align: center;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }

  @media (max-width: 600px) {
    .banner-bar {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
