"""
Mood classification system for music tracks.
Uses audio features and music theory to categorize tracks into moods.
"""

# Key-based mood bias from music theory research
KEY_MOOD_WEIGHTS = {
    # Major keys - generally happy, bright, uplifting
    'C Major': {'Happy': 0.25, 'Uplifting': 0.15},
    'G Major': {'Happy': 0.20, 'Chill': 0.10},
    'D Major': {'Uplifting': 0.25, 'Energetic': 0.20, 'Happy': 0.15},
    'A Major': {'Energetic': 0.20, 'Happy': 0.15},
    'E Major': {'Energetic': 0.25, 'Happy': 0.15},
    'F Major': {'Chill': 0.20, 'Happy': 0.10},
    'Bb Major': {'Happy': 0.20, 'Uplifting': 0.15},
    'B Major': {'Uplifting': 0.20, 'Happy': 0.15},
    'Eb Major': {'Uplifting': 0.25, 'Energetic': 0.15},
    'Ab Major': {'Happy': 0.15, 'Uplifting': 0.10},
    'Db Major': {'Happy': 0.15, 'Uplifting': 0.10},
    'F# Major': {'Energetic': 0.15, 'Happy': 0.10},
    'Gb Major': {'Happy': 0.15, 'Uplifting': 0.10},
    'C# Major': {'Energetic': 0.15, 'Happy': 0.10},
    
    # Minor keys - generally sad, melancholic, introspective
    'A Minor': {'Sad': 0.25, 'Melancholic': 0.20},
    'E Minor': {'Sad': 0.20, 'Melancholic': 0.15},
    'D Minor': {'Melancholic': 0.25, 'Sad': 0.15},
    'B Minor': {'Sad': 0.25, 'Melancholic': 0.20},
    'F# Minor': {'Melancholic': 0.25, 'Sad': 0.15},
    'C# Minor': {'Sad': 0.30, 'Melancholic': 0.20},
    'G# Minor': {'Sad': 0.25, 'Melancholic': 0.20},
    'G Minor': {'Melancholic': 0.20, 'Sad': 0.15},
    'C Minor': {'Sad': 0.25, 'Melancholic': 0.20},
    'F Minor': {'Melancholic': 0.20, 'Sad': 0.15},
    'Bb Minor': {'Sad': 0.20, 'Melancholic': 0.15},
    'Eb Minor': {'Sad': 0.20, 'Melancholic': 0.15},
    'Ab Minor': {'Sad': 0.20, 'Melancholic': 0.15},
    'Db Minor': {'Sad': 0.20, 'Melancholic': 0.15},
}

def classify_mood(valence=None, energy=None, danceability=None, acousticness=None, key=None):
    """
    Classify track mood based on audio features and optional key.
    
    Args:
        valence: Musical positiveness (0-1)
        energy: Intensity and activity (0-1)
        danceability: How suitable for dancing (0-1)
        acousticness: Acoustic vs electronic (0-1)
        key: Optional musical key (e.g., "C Major", "A Minor")
    
    Returns:
        dict: Mood classification results
    """
    mood_scores = {}
    
    # Full feature classification
    if valence is not None and energy is not None and danceability is not None and acousticness is not None:
        # Happy: High valence, moderate-high energy
        if valence > 0.6 and energy > 0.5:
            mood_scores['Happy'] = valence * energy
        
        # Sad: Low valence, low-moderate energy
        if valence < 0.4 and energy < 0.6:
            mood_scores['Sad'] = (1 - valence) * (1 - energy)
        
        # Energetic: High energy, high danceability
        if energy > 0.7 and danceability > 0.6:
            mood_scores['Energetic'] = energy * danceability
        
        # Chill: Low energy, acoustic or low danceability
        if energy < 0.5 and (acousticness > 0.5 or danceability < 0.5):
            mood_scores['Chill'] = (1 - energy) * max(acousticness, 1 - danceability)
        
        # Uplifting: High valence + high energy
        if valence > 0.7 and energy > 0.7:
            mood_scores['Uplifting'] = valence * energy
        
        # Melancholic: Low valence + moderate energy
        if valence < 0.4 and 0.4 < energy < 0.7:
            mood_scores['Melancholic'] = (1 - valence) * energy
        
        # Party: High danceability + high energy
        if danceability > 0.7 and energy > 0.7:
            mood_scores['Party'] = danceability * energy

    # Fallback: Energy + Key only
    elif energy is not None:
        # Normalize energy if needed (assuming 0-1 input here)
        
        if key:
            is_major = 'Major' in key
            is_minor = 'Minor' in key
            
            if energy > 0.6:
                if is_major:
                    mood_scores['Happy'] = 0.6
                    mood_scores['Energetic'] = 0.7
                elif is_minor:
                    mood_scores['Energetic'] = 0.6
                    mood_scores['Melancholic'] = 0.4
            elif energy < 0.4:
                if is_major:
                    mood_scores['Chill'] = 0.7
                    mood_scores['Happy'] = 0.3
                elif is_minor:
                    mood_scores['Sad'] = 0.7
                    mood_scores['Melancholic'] = 0.6
            else: # Mid energy
                if is_major:
                    mood_scores['Happy'] = 0.5
                    mood_scores['Chill'] = 0.4
                elif is_minor:
                    mood_scores['Melancholic'] = 0.5
                    mood_scores['Sad'] = 0.3
        else:
            # Energy only
            if energy > 0.7:
                mood_scores['Energetic'] = 0.8
            elif energy < 0.3:
                mood_scores['Chill'] = 0.8
            else:
                mood_scores['Happy'] = 0.4 # Default assumption
    
    # Apply key-based bias if key is provided
    if key and key in KEY_MOOD_WEIGHTS:
        key_bias = KEY_MOOD_WEIGHTS[key]
        for mood, weight in key_bias.items():
            if mood in mood_scores:
                mood_scores[mood] += weight
            else:
                mood_scores[mood] = weight
    
    # Convert to sorted list
    moods = [(mood, score) for mood, score in mood_scores.items()]
    moods.sort(key=lambda x: x[1], reverse=True)
    
    if len(moods) >= 2:
        return {
            'primary': moods[0][0],
            'secondary': moods[1][0],
            'score': moods[0][1],
            'all_moods': [m[0] for m in moods[:3]]
        }
    elif len(moods) == 1:
        return {
            'primary': moods[0][0],
            'secondary': None,
            'score': moods[0][1],
            'all_moods': [moods[0][0]]
        }
    else:
        return {
            'primary': 'Neutral',
            'secondary': None,
            'score': 0.5,
            'all_moods': ['Neutral']
        }

def get_mood_string(mood_data):
    """
    Convert mood data to a string for storage.
    
    Args:
        mood_data: dict from classify_mood()
    
    Returns:
        str: "Happy, Energetic" or "Sad"
    """
    if mood_data['secondary']:
        return f"{mood_data['primary']}, {mood_data['secondary']}"
    return mood_data['primary']

def parse_mood_string(mood_str):
    """
    Parse stored mood string back to list.
    
    Args:
        mood_str: "Happy, Energetic" or "Sad"
    
    Returns:
        list: ['Happy', 'Energetic'] or ['Sad']
    """
    if not mood_str:
        return []
    return [m.strip() for m in mood_str.split(',')]

def normalize_key(key_str):
    """
    Normalize key string to standard format.
    
    Args:
        key_str: Key string (e.g., "C", "Am", "C Major", "A Minor")
    
    Returns:
        str: Normalized key (e.g., "C Major", "A Minor") or None
    """
    if not key_str:
        return None
    
    key_str = key_str.strip()
    
    # Already in standard format
    if 'Major' in key_str or 'Minor' in key_str:
        return key_str
    
    # Handle short format (e.g., "C", "Am")
    if key_str.endswith('m'):
        # Minor key
        root = key_str[:-1]
        return f"{root} Minor"
    else:
        # Major key
        return f"{key_str} Major"

