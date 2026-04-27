<script lang="ts">
  import '../app.css';
  import { auth, isGuest } from '$lib/auth';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Sidebar from '../components/Sidebar.svelte';
  import BottomNav from '../components/BottomNav.svelte';
  import Player from '../components/Player.svelte';
  import MiniPlayer from '../components/MiniPlayer.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import GuestBanner from '../components/GuestBanner.svelte';
  import { startDeviceSync, stopDeviceSync } from '$lib/stores/devices';
  import { initSettingsSync, resetSettingsSync } from '$lib/stores/settingsSync';
  import { showFullscreenPlayer } from '$lib/stores/ui';
  import { theme } from '$lib/stores/theme';
  import { get } from 'svelte/store';
  import { togglePlay, seek, setVolume, playNext, playPrev, toggleShuffle, cycleLoop, currentTime, duration, volume } from '$lib/stores/player';

  $effect(() => {
    document.documentElement.setAttribute('data-theme', $theme);
  });
  import FullscreenPlayer from '../components/FullscreenPlayer.svelte';

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

  $effect(() => {
    if ($auth.authenticated) {
      startDeviceSync();
      initSettingsSync();
      return () => {
        stopDeviceSync();
        resetSettingsSync();
      };
    }
  });

  let isLogin = $derived(page.url.pathname === '/login');

  let mutedVolume = $state(0);

  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) playNext();
          else seek(Math.min(get(currentTime) + 10, get(duration)));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) playPrev();
          else seek(Math.max(get(currentTime) - 10, 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(get(volume) + 0.05, 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(get(volume) - 0.05, 0));
          break;
        case 'm':
        case 'M': {
          const v = get(volume);
          if (v > 0) { mutedVolume = v; setVolume(0); }
          else setVolume(mutedVolume || 1);
          break;
        }
        case 's':
        case 'S':
          toggleShuffle();
          break;
        case 'r':
        case 'R':
          cycleLoop();
          break;
        case 'f':
        case 'F':
          showFullscreenPlayer.update(v => !v);
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
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
        {#if $isGuest}
          <GuestBanner />
        {/if}
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

  {#if $showFullscreenPlayer}
    <FullscreenPlayer />
  {/if}
{/if}

<style>
  .app-shell {
    display: flex;
    height: calc(100vh - var(--player-height));
    overflow: hidden;
  }

  .app-shell.mobile {
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    flex-direction: column;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .content-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    padding: 24px;
    padding-bottom: calc(24px + var(--bottom-nav-height) + var(--mini-player-height));
  }

  @media (max-width: 768px) {
    .content-scroll {
      padding: 16px;
      padding-bottom: calc(16px + var(--bottom-nav-height) + var(--mini-player-height));
    }
  }
</style>
