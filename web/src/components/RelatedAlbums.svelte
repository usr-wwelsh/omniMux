<script lang="ts">
  import type { Album } from '$lib/subsonic';
  import { loadLibrary } from '$lib/stores/libraryCache';
  import { relatedAlbums } from '$lib/relatedAlbums';
  import AlbumCard from './AlbumCard.svelte';

  interface Props {
    album: Album;
  }

  let { album }: Props = $props();

  let albums = $state<Album[]>([]);

  $effect(() => {
    const current = album;
    albums = [];
    let stale = false;
    loadLibrary()
      .then((lib) => {
        if (!stale) albums = relatedAlbums(current, lib.albums);
      })
      .catch(() => {
        if (!stale) albums = [];
      });
    return () => {
      stale = true;
    };
  });
</script>

{#if albums.length > 0}
  <section class="section">
    <h2 class="section-title">Related albums</h2>
    <div class="album-row">
      {#each albums as album (album.id)}
        <div class="album-row-item">
          <AlbumCard {album} />
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .section {
    margin-top: 40px;
  }

  .section-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 16px;
  }

  .album-row {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }

  .album-row-item {
    flex: 0 0 160px;
    min-width: 0;
    scroll-snap-align: start;
  }
</style>
