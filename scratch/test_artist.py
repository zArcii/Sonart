from ytmusicapi import YTMusic
import json
import sys

ytmusic = YTMusic()
artist_id = "UCiY3z8HAGD6BlSNKvn2kSvQ" # Martin Solveig or similar
print(f"Fetching artist: {artist_id}...")
try:
    artist = ytmusic.get_artist(artist_id)
    print("Artist keys:")
    print(list(artist.keys()))
    
    # Check if there are songs or tracks
    songs = artist.get('songs', {})
    print("\nSongs info:")
    print(songs.keys())
    results = songs.get('results', [])
    print(f"Number of songs: {len(results)}")
    if results:
        print("First song:")
        print(json.dumps(results[0], indent=2))
        
except Exception as e:
    print(f"Error: {e}")
