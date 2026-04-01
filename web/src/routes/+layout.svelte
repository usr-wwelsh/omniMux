<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/auth';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Sidebar from '../components/Sidebar.svelte';
  import BottomNav from '../components/BottomNav.svelte';
  import Player from '../components/Player.svelte';
  import MiniPlayer from '../components/MiniPlayer.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';

  let { children } = $props();

  let isMobile = $state(false);

  $effect(() => {
    if (typeof window !== 'undefined') {
      const check = () => (isMobile = window.innerWidth < 768);
      check();
      window.addEventListener('resize', check);
      return () => window.removeEventListener('resize', check);
    }
  });

  $effect(() => {
    if (!$auth.authenticated && page.url.pathname !== '/login') {
      goto('/login');
    }
  });

  let isLogin = $derived(page.url.pathname === '/login');
</script>

{#if isLogin}
  {@render children()}
{:else if $auth.authenticated}
  <div class="app-shell" class:mobile={isMobile}>
    {#if !isMobile}
      <Sidebar />
    {/if}

    <main class="main-content">
      <div class="content-scroll">
        {@render children()}
      </div>
    </main>

    {#if !isMobile}
      <NowPlaying />
    {/if}
  </div>

  {#if isMobile}
    <MiniPlayer />
    <BottomNav />
  {:else}
    <Player />
  {/if}
{/if}

<style>
  .app-shell {
    display: flex;
    height: calc(100vh - var(--player-height));
    overflow: hidden;
  }

  .app-shell.mobile {
    height: calc(100vh - var(--bottom-nav-height) - var(--mini-player-height));
    flex-direction: column;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  @media (max-width: 768px) {
    .content-scroll {
      padding: 16px;
    }
  }
</style>
