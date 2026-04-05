<script lang="ts">
  import { page } from '$app/state';
</script>

<nav class="bottom-nav">
  <a href="/" class="nav-tab" class:active={page.url.pathname === '/'}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
    <span>Home</span>
  </a>
  <a href="/search" class="nav-tab" class:active={page.url.pathname === '/search'}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
    <span>Search</span>
  </a>
  <a href="/library" class="nav-tab" class:active={page.url.pathname.startsWith('/library')}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/></svg>
    <span>Library</span>
  </a>
  <a href="/playlists" class="nav-tab" class:active={page.url.pathname.startsWith('/playlists')}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
    <span>Playlists</span>
  </a>
  <a href="/tagger" class="nav-tab" class:active={page.url.pathname === '/tagger'}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/></svg>
    <span>Tagger</span>
  </a>
  <a href="/downloads" class="nav-tab" class:active={page.url.pathname === '/downloads'}>
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
    <span>Downloads</span>
  </a>
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 200;
    display: flex;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    height: var(--bottom-nav-height);
  }

  .nav-tab {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-subdued);
    font-size: 10px;
    font-weight: 600;
    transition: color 0.15s;
    overflow: hidden;
    padding: 0 2px;
  }

  .nav-tab span {
    display: none;
  }

  .nav-tab:hover, .nav-tab.active {
    color: var(--text-primary);
  }
</style>
