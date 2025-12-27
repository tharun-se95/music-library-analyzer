import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from mood_classifier import classify_mood, get_mood_string

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

    def get_track_info(self, artist, title, key=None, audio_energy=None):
        """
        Fetches track metadata from Spotify.
        Returns a dictionary with popularity, genre, mood, and spotify features.
        
        Args:
            artist: Artist name
            title: Track title
            key: Optional musical key (e.g., "C Major") for mood enhancement
            audio_energy: Optional energy from audio analysis (0-1000 scale)
        """
        if not self.sp:
            # Fallback if no Spotify client: use audio analysis for mood
            if audio_energy is not None:
                # Normalize energy (0-100 range -> 0-1)
                norm_energy = min(audio_energy / 100.0, 1.0)
                mood_data = classify_mood(energy=norm_energy, key=key)
                return {"mood": get_mood_string(mood_data)}
            return None

        try:
            # Search for the track
            query = f"artist:{artist} track:{title}"
            results = self.sp.search(q=query, type='track', limit=1)
            
            if not results['tracks']['items']:
                # Fallback if track not found
                if audio_energy is not None:
                    norm_energy = min(audio_energy / 100.0, 1.0)
                    mood_data = classify_mood(energy=norm_energy, key=key)
                    return {"mood": get_mood_string(mood_data)}
                return None
            
            track = results['tracks']['items'][0]
            track_id = track['id']
            
            # Get artist info for genres (Prioritize this as it works)
            artist_id = track['artists'][0]['id']
            artist_info = self.sp.artist(artist_id)
            genres = artist_info['genres']
            
            # Get album art URL (use largest available image)
            album_art_url = None
            if track.get('album') and track['album'].get('images'):
                images = track['album']['images']
                if images:
                    # Get the largest image (first one is usually the largest)
                    album_art_url = images[0].get('url')
            
            result = {
                "popularity": track['popularity'],
                "genres": genres,
                "album_art": album_art_url,
                "album_art_url": album_art_url,  # Alias for compatibility
            }

            # Get audio features (danceability, valence, etc.)
            # Note: This endpoint returns 403 for new apps (post-Nov 2024)
            try:
                audio_features_list = self.sp.audio_features([track_id])
                if audio_features_list and audio_features_list[0]:
                    features = audio_features_list[0]
                    valence = features.get('valence', 0.5)
                    danceability = features.get('danceability', 0.5)
                    acousticness = features.get('acousticness', 0.5)
                    energy_spotify = features.get('energy', 0.5)
                    
                    result.update({
                        "danceability": danceability,
                        "valence": valence,
                        "acousticness": acousticness,
                        "energy_spotify": energy_spotify
                    })
                    
                    # Classify mood based on audio features AND key (music theory)
                    mood_data = classify_mood(
                        valence, 
                        energy_spotify, 
                        danceability, 
                        acousticness,
                        key=key  # Pass key for music theory enhancement
                    )
                    result['mood'] = get_mood_string(mood_data)
                else:
                    raise Exception("No audio features returned")
                    
            except Exception as e:
                # Fallback: Use audio analysis energy if available
                if audio_energy is not None:
                    norm_energy = min(audio_energy / 100.0, 1.0)
                    mood_data = classify_mood(energy=norm_energy, key=key)
                    result['mood'] = get_mood_string(mood_data)
                
            return result
        except Exception as e:
            print(f"Error fetching metadata for {artist} - {title}: {e}")
            # Fallback on error
            if audio_energy is not None:
                norm_energy = min(audio_energy / 100.0, 1.0)
                mood_data = classify_mood(energy=norm_energy, key=key)
                return {"mood": get_mood_string(mood_data)}
            return None

