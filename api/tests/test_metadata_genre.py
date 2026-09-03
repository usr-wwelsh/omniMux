"""mood_result is a tempo/energy heuristic, not a genre classifier — it mislabels
anything with no clear beat (jazz, chant, bluegrass) as house/techno/club. Genre
must only ever come from the real source (YouTube/MusicBrainz), never from mood."""
from services.metadata import _build_metadata


def test_missing_genre_stays_empty_even_with_mood_result():
    info = {"title": "Kyrie of the Mass of Our Lady", "artist": "Guillaume de Machaut"}
    mood_result = {"mood": "Club/Groovy", "tempo": 123.4, "energy": 0.42, "key": "C"}

    meta = _build_metadata(info, mood_result)

    assert meta["genre"] == ""
    assert meta["mood"] == "Club/Groovy"


def test_real_source_genre_is_preserved():
    info = {"title": "Song", "artist": "Artist", "genre": "Jazz"}
    mood_result = {"mood": "Club/Groovy", "tempo": 123.4, "energy": 0.42, "key": "C"}

    meta = _build_metadata(info, mood_result)

    assert meta["genre"] == "Jazz"
