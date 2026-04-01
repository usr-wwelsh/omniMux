import { get } from 'svelte/store';
import { auth, logout } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8800';

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

  async startDownload(youtube_url: string, youtube_id: string, title: string, artist: string): Promise<DownloadResponse> {
    return request('/api/download', {
      method: 'POST',
      body: JSON.stringify({ youtube_url, youtube_id, title, artist }),
    });
  },

  async getDownloadStatus(id: number): Promise<DownloadStatus> {
    return request(`/api/download/status/${id}`);
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
};
