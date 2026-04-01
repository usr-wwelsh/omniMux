import hashlib
import os
import secrets

import httpx

NAVIDROME_URL = os.environ.get("NAVIDROME_URL", "http://localhost:4533")


def _subsonic_params(username: str, password: str) -> dict:
    salt = secrets.token_hex(8)
    token = hashlib.md5((password + salt).encode()).hexdigest()
    return {
        "u": username,
        "t": token,
        "s": salt,
        "v": "1.16.1",
        "c": "omniMux",
        "f": "json",
    }


async def validate_credentials(username: str, password: str) -> bool:
    params = _subsonic_params(username, password)
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{NAVIDROME_URL}/rest/ping.view", params=params)
        if resp.status_code != 200:
            return False
        data = resp.json()
        sr = data.get("subsonic-response", {})
        return sr.get("status") == "ok"


async def trigger_scan(username: str, password: str) -> None:
    params = _subsonic_params(username, password)
    async with httpx.AsyncClient() as client:
        await client.get(f"{NAVIDROME_URL}/rest/startScan.view", params=params)


async def search_song(title: str, artist: str, username: str, password: str) -> str | None:
    params = _subsonic_params(username, password)
    params["query"] = title
    params["songCount"] = "10"
    params["artistCount"] = "0"
    params["albumCount"] = "0"
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{NAVIDROME_URL}/rest/search3.view", params=params)
        if resp.status_code != 200:
            return None
        sr = resp.json().get("subsonic-response", {})
        if sr.get("status") != "ok":
            return None
        songs = sr.get("searchResult3", {}).get("song", [])
        artist_lower = artist.lower()
        for song in songs:
            if song.get("artist", "").lower() == artist_lower:
                return song["id"]
        return songs[0]["id"] if songs else None


async def get_or_create_playlist(name: str, username: str, password: str) -> str | None:
    async with httpx.AsyncClient() as client:
        params = _subsonic_params(username, password)
        resp = await client.get(f"{NAVIDROME_URL}/rest/getPlaylists.view", params=params)
        if resp.status_code == 200:
            sr = resp.json().get("subsonic-response", {})
            if sr.get("status") == "ok":
                for pl in sr.get("playlists", {}).get("playlist", []):
                    if pl.get("name") == name:
                        return pl["id"]
        # Create new playlist
        params = _subsonic_params(username, password)
        params["name"] = name
        resp = await client.get(f"{NAVIDROME_URL}/rest/createPlaylist.view", params=params)
        if resp.status_code == 200:
            sr = resp.json().get("subsonic-response", {})
            if sr.get("status") == "ok":
                return sr.get("playlist", {}).get("id")
    return None


async def add_song_to_playlist(playlist_id: str, song_id: str, username: str, password: str) -> None:
    params = _subsonic_params(username, password)
    params["playlistId"] = playlist_id
    params["songIdToAdd"] = song_id
    async with httpx.AsyncClient() as client:
        await client.get(f"{NAVIDROME_URL}/rest/updatePlaylist.view", params=params)
