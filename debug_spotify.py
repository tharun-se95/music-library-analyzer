import os
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from dotenv import load_dotenv

load_dotenv()

client_id = os.getenv("SPOTIPY_CLIENT_ID")
client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")

print(f"Testing with Client ID: {client_id[:5]}...{client_id[-5:]}")

try:
    auth_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
    sp = spotipy.Spotify(auth_manager=auth_manager)

    # Try a simple search
    print("Searching for 'Seven Nation Army'...")
    results = sp.search(q='Seven Nation Army', limit=1)
    track = results['tracks']['items'][0]
    print(f"Found track: {track['name']} by {track['artists'][0]['name']} (ID: {track['id']})")

    # Try fetching audio features
    try:
        print("Fetching audio features...")
        features = sp.audio_features([track['id']])
        print(f"Audio Features: {features}")
    except Exception as e:
        print(f"Audio Features failed: {e}")

    # Try fetching artist info
    print("Fetching artist info...")
    artist_id = track['artists'][0]['id']
    artist = sp.artist(artist_id)
    print(f"Artist Genres: {artist['genres']}")
    print(f"Track Popularity: {track['popularity']}")

except spotipy.exceptions.SpotifyException as e:
    print(f"\nSpotify API Error: {e}")
except Exception as e:
    print(f"\nGeneral Error: {e}")
