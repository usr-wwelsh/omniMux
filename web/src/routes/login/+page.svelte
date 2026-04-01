<script lang="ts">
  import { api } from '$lib/api';
  import { login } from '$lib/auth';
  import { goto } from '$app/navigation';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const result = await api.login(username, password);
      login(result.token, username, password);
      goto('/');
    } catch (err: any) {
      error = err.message || 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1 class="login-logo">omniMux</h1>
    <p class="login-subtitle">Sign in with your Navidrome account</p>

    <form onsubmit={handleLogin}>
      {#if error}
        <div class="login-error">{error}</div>
      {/if}

      <input
        type="text"
        placeholder="Username"
        bind:value={username}
        class="login-input"
        autocomplete="username"
        required
      />
      <input
        type="password"
        placeholder="Password"
        bind:value={password}
        class="login-input"
        autocomplete="current-password"
        required
      />
      <button type="submit" class="login-btn" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    padding: 16px;
  }

  .login-card {
    width: 100%;
    max-width: 400px;
    background: var(--bg-secondary);
    border-radius: 12px;
    padding: 48px 40px;
    text-align: center;
  }

  .login-logo {
    font-size: 36px;
    font-weight: 800;
    margin-bottom: 8px;
    letter-spacing: -1px;
  }

  .login-subtitle {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 32px;
  }

  .login-error {
    background: rgba(231, 76, 60, 0.15);
    color: var(--danger);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .login-input {
    width: 100%;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 15px;
    margin-bottom: 12px;
    outline: none;
    transition: border-color 0.2s;
  }

  .login-input:focus {
    border-color: var(--accent);
  }

  .login-btn {
    width: 100%;
    padding: 14px;
    background: var(--accent);
    color: #000;
    font-size: 15px;
    font-weight: 700;
    border-radius: 24px;
    margin-top: 8px;
    transition: background 0.15s, transform 0.1s;
  }

  .login-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: scale(1.02);
  }

  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
