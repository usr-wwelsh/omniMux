<script lang="ts">
  import { theme, type Theme } from '$lib/stores/theme';
  import {
    crossfadeDuration, beatmatchEnabled, bpmTolerance,
    visCycleInterval, ambientIdleMinutes,
  } from '$lib/stores/autodj';

  const themes: { value: Theme; label: string; description: string }[] = [
    { value: 'spotify', label: 'Spotify', description: 'Dark green — the default look' },
    { value: 'waybar', label: 'Waybar', description: 'Flat grey — matches Waybar / desktop themes' },
    { value: 'win98', label: 'Win98', description: 'Silver & navy — classic Windows 98 vibes' },
    { value: 'bubblegum', label: 'Bubblegum', description: 'Flat light pink mono — sweet and simple' },
    { value: 'amber', label: 'Amber', description: 'Warm amber glow — old IBM monitor' },
    { value: 'init-launcher', label: 'Init Launcher', description: 'Solaris CDE blue-gray with pink accent' },
  ];

  const visCycleOptions: { value: 'track' | '15' | '30' | '60'; label: string }[] = [
    { value: 'track', label: 'Per track' },
    { value: '15', label: '15s' },
    { value: '30', label: '30s' },
    { value: '60', label: '60s' },
  ];
</script>

<div class="settings">
  <h1 class="page-title">Settings</h1>

  <section class="settings-section">
    <h2 class="section-title">Appearance</h2>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Theme</span>
        <span class="setting-desc">Choose the color scheme for the app</span>
      </div>
      <div class="theme-options">
        {#each themes as t}
          <button
            class="theme-btn"
            class:active={$theme === t.value}
            onclick={() => theme.set(t.value)}
          >
            <span class="theme-swatch" data-theme={t.value}></span>
            <span class="theme-btn-label">{t.label}</span>
            <span class="theme-btn-desc">{t.description}</span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section-title">Auto DJ</h2>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Crossfade</span>
        <span class="setting-desc">Fade between tracks when Auto DJ is active</span>
      </div>
      <div class="slider-row">
        <input
          type="range" min="0" max="10" step="0.5"
          bind:value={$crossfadeDuration}
          class="slider"
        />
        <span class="slider-val">{$crossfadeDuration === 0 ? 'Off' : `${$crossfadeDuration}s`}</span>
      </div>
    </div>

    <div class="setting-row" class:dimmed={$crossfadeDuration === 0}>
      <div class="setting-info">
        <span class="setting-name">Beatmatch on crossfade</span>
        <span class="setting-desc">Pitch-shift incoming track to match tempo, then release</span>
      </div>
      <button
        class="toggle-btn"
        class:active={$beatmatchEnabled}
        disabled={$crossfadeDuration === 0}
        onclick={() => beatmatchEnabled.update((v) => !v)}
      >{$beatmatchEnabled ? 'On' : 'Off'}</button>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">BPM match tolerance</span>
        <span class="setting-desc">How close song BPMs need to be when auto-queuing</span>
      </div>
      <div class="slider-row">
        <input
          type="range" min="5" max="20" step="1"
          bind:value={$bpmTolerance}
          class="slider"
        />
        <span class="slider-val">±{$bpmTolerance}%</span>
      </div>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section-title">Visualizer</h2>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Cycle interval</span>
        <span class="setting-desc">How often to switch visualizers in Auto DJ mode</span>
      </div>
      <div class="segment-group">
        {#each visCycleOptions as opt}
          <button
            class="segment-btn"
            class:active={$visCycleInterval === opt.value}
            onclick={() => visCycleInterval.set(opt.value)}
          >{opt.label}</button>
        {/each}
      </div>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section-title">Ambient Mode</h2>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Screen saver delay</span>
        <span class="setting-desc">Auto-enter fullscreen art view after this long with no interaction</span>
      </div>
      <div class="slider-row">
        <input
          type="range" min="0" max="30" step="5"
          bind:value={$ambientIdleMinutes}
          class="slider"
        />
        <span class="slider-val">{$ambientIdleMinutes === 0 ? 'Disabled' : `${$ambientIdleMinutes} min`}</span>
      </div>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section-title">About</h2>

    <div class="setting-row about-row">
      <div class="setting-info">
        <span class="setting-name">omniMux</span>
        <span class="setting-desc">Multi-device music player with VJ visualizers</span>
      </div>
      <a
        class="github-link"
        href="https://git.wwel.sh/omnimux"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
        View on GitHub
      </a>
    </div>
  </section>
</div>

<style>
  .settings {
    max-width: 640px;
  }

  .page-title {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 32px;
  }

  .settings-section {
    margin-bottom: 40px;
  }

  .section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-subdued);
    margin-bottom: 16px;
  }

  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .theme-options {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .theme-btn {
    flex: 1 1 160px;
    max-width: 200px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px;
    border-radius: 8px;
    border: 2px solid transparent;
    background: var(--bg-elevated);
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
  }

  .theme-btn:hover {
    border-color: var(--text-subdued);
  }

  .theme-btn.active {
    border-color: var(--accent);
  }

  .theme-swatch {
    width: 100%;
    height: 32px;
    border-radius: 4px;
    display: block;
  }

  [data-theme="spotify"] {
    background: #121212;
    border: 1px solid #1DB954;
  }

  [data-theme="waybar"] {
    background: #3B3E47;
    border: 1px solid #B8B8B8;
  }

  [data-theme="win98"] {
    background: linear-gradient(135deg, #C0C0C0 60%, #008080 100%);
    border: 2px solid #000080;
  }

  [data-theme="bubblegum"] {
    background: linear-gradient(135deg, #FDF0F4 0%, #F2D6E4 100%);
    border: 1px solid #C03860;
  }

  [data-theme="amber"] {
    background: #0A0700;
    border: 1px solid #FFB000;
    box-shadow: 0 0 6px #FFB00044;
  }

  [data-theme="init-launcher"] {
    background: #6E7E8E;
    border: 1px solid #C05870;
  }

  .theme-btn-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .theme-btn-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider {
    flex: 1;
    accent-color: var(--accent);
    height: 4px;
    cursor: pointer;
  }

  .slider-val {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 56px;
    text-align: right;
  }

  .toggle-btn {
    padding: 6px 18px;
    border-radius: 20px;
    border: 2px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .toggle-btn.active {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .toggle-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .dimmed {
    opacity: 0.45;
  }

  .segment-group {
    display: flex;
    gap: 0;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid var(--border);
  }

  .segment-btn {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .segment-btn:last-child {
    border-right: none;
  }

  .segment-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .about-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 2px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    transition: border-color 0.15s;
    white-space: nowrap;
  }

  .github-link:hover {
    border-color: var(--accent);
  }
</style>
