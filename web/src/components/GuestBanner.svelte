<script lang="ts">
  let showModal = $state(false);
  let showToast = $state(false);
  let toastMessage = $state('');

  const aiTools = [
    { name: 'Claude', url: 'https://claude.ai', color: '#9d4edd' },
    { name: 'Qwen Studio', url: 'https://chat.qwen.ai/', color: '#ff6b35' },
    { name: 'Kimi', url: 'https://kimi.com', color: '#00d084' },
    { name: 'Gemini', url: 'https://gemini.google.com', color: '#4285f4' },
  ];

  const prompt = 'Summarize this project and explain how to self-host it: https://github.com/usr-wwelsh/omnimux';

  function openAITool(url: string) {
    navigator.clipboard.writeText(prompt);
    toastMessage = 'Prompt copied to clipboard!';
    showToast = true;
    setTimeout(() => (showToast = false), 2000);
    window.open(url, '_blank');
  }

  function closeModal(e: Event) {
    if (e.target === e.currentTarget) {
      showModal = false;
    }
  }
</script>

<div class="guest-banner">
  <div class="banner-bar">
    <div class="banner-content">
      <span class="banner-text">GUEST VIEW</span>
      <span class="banner-divider">·</span>
      <span class="banner-text">limited features</span>
      <button class="learn-more-btn" onclick={() => (showModal = true)}>
        learn more →
      </button>
    </div>
  </div>

  {#if showModal}
    <div class="modal-overlay" onclick={closeModal}>
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <button class="modal-close" onclick={() => (showModal = false)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>

        <div class="modal-body">
          <div class="animated-logo">
            <img src="/logo.svg" alt="omniMux" />
          </div>

          <h2 class="modal-title">omniMux</h2>
          <p class="modal-description">
            De-Google your music. Search YouTube, cache locally, stream offline via Navidrome. Full control, no cloud.
          </p>

          <a href="https://git.wwel.sh/omnimux" target="_blank" rel="noopener" class="repo-link">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            View on git.wwel.sh/omnimux
          </a>

          <div class="ai-section">
            <p class="ai-label">New to self-hosting? Ask an AI:</p>
            <div class="ai-badges">
              {#each aiTools as tool}
                <button
                  class="ai-badge"
                  style={`--ai-color: ${tool.color}`}
                  onclick={() => openAITool(tool.url)}
                  title={tool.name}
                >
                  {tool.name}
                </button>
              {/each}
            </div>
            <p class="ai-hint">Click to copy prompt & open AI tool</p>
          </div>

        </div>
      </div>
    </div>
  {/if}

  {#if showToast}
    <div class="toast">
      {toastMessage}
    </div>
  {/if}
</div>

<style>
  .guest-banner {
    width: 100%;
  }

  .banner-bar {
    background: linear-gradient(135deg, var(--accent, #1db954) 0%, color-mix(in srgb, var(--accent, #1db954) 80%, transparent) 100%);
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .banner-content {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #000;
  }

  .banner-text {
    white-space: nowrap;
  }

  .banner-divider {
    opacity: 0.6;
  }

  .learn-more-btn {
    background: none;
    border: none;
    color: #000;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    margin-left: 4px;
    transition: opacity 0.15s;
    text-decoration: underline;
    text-decoration-color: rgba(0, 0, 0, 0.3);
  }

  .learn-more-btn:hover {
    opacity: 0.8;
  }

  /* ── Modal ── */

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 16px;
    padding: 40px 32px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    animation: slideUp 0.3s ease-out;
  }

  .modal-close {
    position: absolute;
    top: 16px;
    right: 16px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
  }

  .modal-close:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 20px;
  }

  .animated-logo {
    width: 100px;
    height: 100px;
    margin-bottom: 12px;
    animation: float 3s ease-in-out infinite;
  }

  .animated-logo img {
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 4px 12px rgba(29, 185, 84, 0.3));
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0px);
    }
    50% {
      transform: translateY(-12px);
    }
  }

  @keyframes glow {
    0%, 100% {
      filter: drop-shadow(0 4px 12px rgba(29, 185, 84, 0.3));
    }
    50% {
      filter: drop-shadow(0 4px 16px rgba(29, 185, 84, 0.6));
    }
  }

  .modal-title {
    font-size: 32px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .modal-description {
    font-size: 15px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .repo-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--accent, #1db954);
    color: #000;
    border-radius: 24px;
    font-weight: 600;
    font-size: 13px;
    text-decoration: none;
    transition: opacity 0.15s;
  }

  .repo-link:hover {
    opacity: 0.9;
  }

  /* ── AI Section ── */

  .ai-section {
    width: 100%;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .ai-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .ai-badges {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }

  .ai-badge {
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1.5px solid var(--ai-color);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .ai-badge:hover {
    background: var(--ai-color);
    color: #000;
    transform: scale(1.05);
  }

  .ai-hint {
    font-size: 11px;
    color: var(--text-subdued);
    margin: 0;
    font-style: italic;
  }


  /* ── Toast ── */

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent, #1db954);
    color: #000;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    z-index: 350;
    animation: slideUp 0.2s ease-out;
    box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 600px) {
    .modal-content {
      padding: 28px 20px;
      max-width: 95%;
    }

    .animated-logo {
      width: 80px;
      height: 80px;
    }

    .modal-title {
      font-size: 24px;
    }

    .banner-content {
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
    }

    .ai-badges {
      grid-template-columns: 1fr;
    }
  }
</style>
