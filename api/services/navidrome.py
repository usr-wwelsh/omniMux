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


# Subsonic auth params the client must never be allowed to supply itself —
# the proxy always sets these server-side from the authenticated user's creds.
SUBSONIC_AUTH_KEYS = frozenset({"u", "t", "s", "p", "v", "c", "f"})


def subsonic_auth_params(username: str, password: str) -> dict:
    """Public accessor for server-side Subsonic auth params (proxy use)."""
    return _subsonic_params(username, password)


async def validate_credentials(username: str, password: str) -> bool:
    params = _subsonic_params(username, password)
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{NAVIDROME_URL}/rest/ping.view", params=params)
        if resp.status_code != 200:
            return False
        data = resp.json()
        sr = data.get("subsonic-response", {})
        return sr.get("status") == "ok"


async def create_navidrome_user(admin_username: str, admin_password: str, new_username: str, new_password: str) -> bool:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{NAVIDROME_URL}/auth/login",
            json={"username": admin_username, "password": admin_password},
        )
        if resp.status_code != 200:
            return False
        nd_token = resp.json().get("token")
        if not nd_token:
            return False
        resp = await client.post(
            f"{NAVIDROME_URL}/api/user",
            json={
                "userName": new_username,
                "name": "Guest",
                "password": new_password,
                "isAdmin": False,
                "email": "guest@omnimux.local",
            },
            headers={"X-ND-Authorization": f"Bearer {nd_token}"},
        )
        return resp.status_code in (200, 201)


async def trigger_scan(username: str, password: str) -> None:
    params = _subsonic_params(username, password)
    async with httpx.AsyncClient() as client:
        await client.get(f"{NAVIDROME_URL}/rest/startScan.view", params=params)


async def get_frequent_albums(username: str, password: str, count: int = 20) -> list[tuple[str, str]]:
    """Return the user's most-played albums as (album, artist) tuples, most-played first.

    Driven by Navidrome's local play counts (populated by scrobbles)."""
    params = _subsonic_params(username, password)
    params["type"] = "frequent"
    params["size"] = str(count)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{NAVIDROME_URL}/rest/getAlbumList2.view", params=params)
            if resp.status_code != 200:
                return []
            sr = resp.json().get("subsonic-response", {})
            if sr.get("status") != "ok":
                return []
            albums = sr.get("albumList2", {}).get("album", [])
            return [(a.get("name", ""), a.get("artist", "")) for a in albums if a.get("artist")]
    except Exception:
        return []


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
        if not songs:
            return None
        artist_lower = artist.lower()
        # Prefer exact artist match, fall back to first result
        for song in songs:
            if song.get("artist", "").lower() == artist_lower:
                return song["id"]
        # Fuzzy: artist name contains or is contained by the target
        for song in songs:
            song_artist = song.get("artist", "").lower()
            if artist_lower in song_artist or song_artist in artist_lower:
                return song["id"]
        return songs[0]["id"]


async def delete_playlist(playlist_id: str, username: str, password: str) -> None:
    params = _subsonic_params(username, password)
    params["id"] = playlist_id
    async with httpx.AsyncClient() as client:
        await client.get(f"{NAVIDROME_URL}/rest/deletePlaylist.view", params=params)


async def dedupe_playlists(prefix: str, username: str, password: str) -> int:
    """Delete duplicate playlists sharing a name, keeping one per name.

    Only considers playlists whose name starts with `prefix`. Returns the number
    of playlists deleted."""
    async with httpx.AsyncClient() as client:
        params = _subsonic_params(username, password)
        resp = await client.get(f"{NAVIDROME_URL}/rest/getPlaylists.view", params=params)
        if resp.status_code != 200:
            return 0
        sr = resp.json().get("subsonic-response", {})
        if sr.get("status") != "ok":
            return 0
        by_name: dict[str, list[str]] = {}
        for pl in sr.get("playlists", {}).get("playlist", []):
            name = pl.get("name", "")
            if name.startswith(prefix):
                by_name.setdefault(name, []).append(pl["id"])

    deleted = 0
    for ids in by_name.values():
        for dup_id in ids[1:]:
            await delete_playlist(dup_id, username, password)
            deleted += 1
    return deleted


async def get_or_create_playlist(name: str, username: str, password: str) -> str | None:
    async with httpx.AsyncClient() as client:
        params = _subsonic_params(username, password)
        resp = await client.get(f"{NAVIDROME_URL}/rest/getPlaylists.view", params=params)
        if resp.status_code == 200:
            sr = resp.json().get("subsonic-response", {})
            if sr.get("status") == "ok":
                # createPlaylist never dedupes by name, so races/retries can leave
                # multiple playlists with the same name. Keep the first, delete the rest.
                matches = [
                    pl for pl in sr.get("playlists", {}).get("playlist", [])
                    if pl.get("name") == name
                ]
                if matches:
                    for dup in matches[1:]:
                        await delete_playlist(dup["id"], username, password)
                    return matches[0]["id"]
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


async def replace_playlist_songs(playlist_id: str, song_ids: list[str], username: str, password: str) -> None:
    """Replace all songs in a playlist with the given song IDs."""
    base_params = _subsonic_params(username, password)
    base_params["playlistId"] = playlist_id
    # httpx accepts list values to produce repeated query params (songId=1&songId=2...)
    params: dict = {**base_params, "songId": song_ids}
    async with httpx.AsyncClient() as client:
        await client.get(f"{NAVIDROME_URL}/rest/createPlaylist.view", params=params)
