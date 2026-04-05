<script lang="ts">
  import { theme, type Theme } from '$lib/stores/theme';

  const themes: { value: Theme; label: string; description: string }[] = [
    { value: 'spotify', label: 'Spotify', description: 'Dark green — the default look' },
    { value: 'waybar', label: 'Waybar', description: 'Flat grey — matches Waybar / desktop themes' },
    { value: 'win98', label: 'Win98', description: 'Silver & navy — classic Windows 98 vibes' },
    { value: 'bubblegum', label: 'Bubblegum', description: 'Flat light pink mono — sweet and simple' },
    { value: 'amber', label: 'Amber', description: 'Warm amber glow — old IBM monitor' },
    { value: 'init-launcher', label: 'Init Launcher', description: 'Solaris CDE blue-gray with pink accent' },
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
</style>
