import { get } from 'svelte/store';
import { auth, logout } from './auth';

const API_BASE = '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { token } = get(auth);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface YouTubeResult {
  youtube_id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail_url: string;
  url: string;
}

export interface DownloadStatus {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  status: string;
  progress: number;
  mood: string | null;
  bpm: number | null;
  energy: number | null;
  key: string | null;
  genre: string | null;
  error: string | null;
}

export interface DownloadResponse {
  download_id: number;
  status: string;
  already_cached: boolean;
}

export interface YouTubeAlbumResult {
  playlist_id: string;
  title: string;
  artist: string;
  track_count: number;
  thumbnail_url: string;
  url: string;
}

export interface PlaylistImportResponse {
  queued: number;
  download_ids: number[];
  playlist_name: string | null;
}

export interface DeviceTrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string | null;
  duration: number;
}

export interface DeviceSession {
  device_id: string;
  device_name: string;
  track: DeviceTrackInfo | null;
  is_playing: boolean;
  current_time: number;
  updated_at: string;
  is_reconnecting: boolean;
  // Set client-side when the poll response was received, for position extrapolation
  received_at_ms?: number;
}

export interface DeviceHeartbeat {
  device_id: string;
  device_name: string;
  track: DeviceTrackInfo | null;
  is_playing: boolean;
  current_time: number;
}

export interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  coverArt?: string;
  duration: number;
  streamUrl?: string;
  coverUrl?: string;
}

export interface QueueState {
  tracks: QueueTrack[];
  index: number;
  active_device_id: string | null;
  seek_to: number | null;
  seek_issued_at: number | null;
  queue_version: number;
}

export interface TaggerTrack {
  file_path: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  duration: number;
}

export const api = {
  async login(username: string, password: string): Promise<{ token: string; username: string }> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async searchYouTube(query: string, limit = 20): Promise<YouTubeResult[]> {
    return request(`/api/search/youtube?q=${encodeURIComponent(query)}&limit=${limit}`);
  },

  async searchYouTubeAlbums(query: string, limit = 10): Promise<YouTubeAlbumResult[]> {
    return request(`/api/search/youtube/albums?q=${encodeURIComponent(query)}&limit=${limit}`);
  },

  async getYouTubeAlbumTracks(artist: string, album: string): Promise<YouTubeResult[]> {
    return request(`/api/search/youtube/album-tracks?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`);
  },

  async startDownload(youtube_url: string, youtube_id: string, title: string, artist: string, album?: string): Promise<DownloadResponse> {
    return request('/api/download', {
      method: 'POST',
      body: JSON.stringify({ youtube_url, youtube_id, title, artist, album: album ?? null }),
    });
  },

  async getDownloadStatus(id: number): Promise<DownloadStatus> {
    return request(`/api/download/status/${id}`);
  },

  async cancelDownload(id: number): Promise<void> {
    return request(`/api/download/${id}/cancel`, { method: 'POST' });
  },

  async getDownloads(): Promise<DownloadStatus[]> {
    return request('/api/downloads');
  },

  async getCachedIds(): Promise<string[]> {
    return request('/api/cached');
  },

  async importPlaylist(playlist_url: string, playlist_name?: string): Promise<PlaylistImportResponse> {
    return request('/api/import/playlist', {
      method: 'POST',
      body: JSON.stringify({ playlist_url, playlist_name: playlist_name || null }),
    });
  },

  async deviceHeartbeat(payload: DeviceHeartbeat): Promise<void> {
    return request('/api/devices/heartbeat', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getDevices(): Promise<DeviceSession[]> {
    return request('/api/devices');
  },

  async getQueue(): Promise<QueueState> {
    return request('/api/queue');
  },

  async setQueue(
    tracks: QueueTrack[],
    index: number,
    active_device_id: string,
    seek_to?: number,
    seek_issued_at?: number,
    queue_version?: number,
  ): Promise<{ ok: boolean; queue_version?: number; conflict?: boolean; serverVersion?: number }> {
    const { token } = get(auth);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
    const res = await fetch('/api/queue', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        tracks, index, active_device_id,
        seek_to: seek_to ?? null,
        seek_issued_at: seek_issued_at ?? null,
        queue_version: queue_version ?? null,
      }),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, conflict: true, serverVersion: body.detail?.queue_version };
    }
    if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `HTTP ${res.status}`); }
    const data = await res.json();
    return { ok: true, queue_version: data.queue_version };
  },

  async enrichSongs(
    songs: Array<{ title: string; artist: string }>,
  ): Promise<Array<{ title: string; artist: string; mood?: string; energy?: number; key?: string; bpm?: number }>> {
    return request('/api/songs/enrich', {
      method: 'POST',
      body: JSON.stringify({ songs }),
    });
  },

  async syncMoodPlaylists(): Promise<{ synced: Record<string, number> }> {
    return request('/api/playlists/sync-moods', { method: 'POST' });
  },

  async backfillMoods(): Promise<{ updated: number; total: number }> {
    return request('/api/playlists/backfill-moods', { method: 'POST' });
  },

  async getTaggerTracks(): Promise<TaggerTrack[]> {
    return request('/api/tagger/tracks');
  },

  async writeTags(file_paths: string[], tags: Record<string, string>): Promise<{ updated: number; errors: string[] }> {
    return request('/api/tagger/tags', {
      method: 'POST',
      body: JSON.stringify({ file_paths, tags }),
    });
  },

  async deleteTracks(file_paths: string[]): Promise<{ deleted: number; errors: string[] }> {
    return request('/api/tagger/delete', {
      method: 'POST',
      body: JSON.stringify({ file_paths }),
    });
  },

  async getSettings(): Promise<Record<string, string>> {
    return request('/api/settings');
  },

  async putSettings(data: Record<string, string>): Promise<void> {
    return request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};
