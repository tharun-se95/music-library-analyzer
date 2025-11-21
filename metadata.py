import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

class MetadataFetcher:
    def __init__(self, client_id, client_secret):
        if not client_id or not client_secret:
            self.sp = None
            print("Warning: Spotify credentials not provided. Metadata fetching will be disabled.")
        else:
            try:
                self.sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(client_id=client_id, client_secret=client_secret))
            except Exception as e:
                self.sp = None
                print(f"Error initializing Spotify client: {e}")

    def get_track_info(self, artist, title):
        """
        Fetches track metadata from Spotify.
        Returns a dictionary with popularity, genre, and spotify features.
        """
        if not self.sp:
            return None

        try:
            # Search for the track
            query = f"artist:{artist} track:{title}"
            results = self.sp.search(q=query, type='track', limit=1)
            
            if not results['tracks']['items']:
                return None
            
            track = results['tracks']['items'][0]
            track_id = track['id']
            
            # Get artist info for genres (Prioritize this as it works)
            artist_id = track['artists'][0]['id']
            artist_info = self.sp.artist(artist_id)
            genres = artist_info['genres']
            
            result = {
                "popularity": track['popularity'],
                "genres": genres,
            }

            # Get audio features (danceability, valence, etc.)
            # Note: This endpoint returns 403 for new apps (post-Nov 2024)
            try:
                audio_features_list = self.sp.audio_features([track_id])
                if audio_features_list and audio_features_list[0]:
                    features = audio_features_list[0]
                    result.update({
                        "danceability": features.get('danceability'),
                        "valence": features.get('valence'),
                        "energy_spotify": features.get('energy')
                    })
            except Exception as e:
                # Silently ignore or print debug if needed
                # print(f"Debug: Audio features fetch failed: {e}")
                pass
                
            return result
        except Exception as e:
            print(f"Error fetching metadata for {artist} - {title}: {e}")
            return None
