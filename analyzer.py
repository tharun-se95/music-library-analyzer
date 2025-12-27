import librosa
import numpy as np
import scipy.stats
import mutagen
from mutagen.mp3 import MP3
from mutagen.wave import WAVE

def get_mixed_in_key_data(path):
    """
    Check if file has Mixed in Key tags and extract them.
    Returns dict with 'key' (standard notation) and 'bpm' if found, None otherwise.
    """
    try:
        from camelot_wheel import is_camelot_code, camelot_to_key
        
        audio = mutagen.File(path)
        if not audio:
            return None
        
        mixed_key = None
        mixed_bpm = None
        
        if isinstance(audio, MP3) or isinstance(audio, WAVE):
            if audio.tags:
                if 'TKEY' in audio.tags:
                    key_value = audio.tags['TKEY'].text[0]
                    if is_camelot_code(key_value):
                        mixed_key = camelot_to_key(key_value)
                if 'TBPM' in audio.tags:
                    mixed_bpm = float(audio.tags['TBPM'].text[0])
        else:
            # FLAC, OGG, etc.
            if 'key' in audio:
                key_value = audio['key'][0]
                if is_camelot_code(key_value):
                    mixed_key = camelot_to_key(key_value)
            if 'bpm' in audio:
                mixed_bpm = float(audio['bpm'][0])
        
        if mixed_key and mixed_bpm:
            return {"key": mixed_key, "bpm": mixed_bpm}
        return None
    except Exception:
        return None

def analyze_track(path):
    """
    Analyzes an audio file to extract BPM, Key, and Energy.
    Checks for Mixed in Key tags first and uses them if available.
    Returns a dictionary with the analysis results.
    """
    try:
        # Check for Mixed in Key data first
        mixed_data = get_mixed_in_key_data(path)
        
        # Get full duration first
        duration = librosa.get_duration(path=path)
        
        # Load audio (only first 2 minutes to save time, or full if needed)
        # Using a duration limit helps with performance on large libraries
        y, sr = librosa.load(path, duration=120)
        
        # Use Mixed in Key BPM/Key if available, otherwise analyze
        if mixed_data:
            bpm = mixed_data['bpm']
            key = mixed_data['key']
            print(f"Using Mixed in Key data: BPM={bpm}, Key={key}")
        else:
            bpm = estimate_bpm(y, sr)
            key = estimate_key(y, sr)
        
        # Always analyze energy (Mixed in Key doesn't provide this)
        energy = estimate_energy(y)
        
        result = {
            "bpm": int(round(bpm)),
            "key": key,
            "energy": int(energy),  # Return as integer
            "duration": float(round(duration, 2))  # Duration in seconds
        }
        
        if mixed_data:
            result["source"] = "Mixed in Key"
        
        return result
    except Exception as e:
        print(f"Error analyzing {path}: {e}")
        return None

def estimate_bpm(y, sr):
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
    # tempo can be a float or an array, ensure it's a scalar
    if isinstance(tempo, np.ndarray):
        tempo = tempo[0]
    return tempo

def estimate_key(y, sr):
    # Harmonic component extraction
    y_harmonic, _ = librosa.effects.hpss(y)
    
    # Chroma feature extraction
    chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
    
    # Sum chroma over time
    chroma_sum = np.sum(chroma, axis=1)
    
    # Major and Minor profiles (Krumhansl-Schmuckler)
    # C C# D D# E F F# G G# A A# B
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    
    # Normalize profiles
    major_profile /= np.linalg.norm(major_profile)
    minor_profile /= np.linalg.norm(minor_profile)
    
    # Normalize chroma
    chroma_sum /= np.linalg.norm(chroma_sum)
    
    # Calculate correlations
    major_corrs = []
    minor_corrs = []
    
    for i in range(12):
        # Rotate chroma to match profile starting at index i
        shifted_chroma = np.roll(chroma_sum, -i)
        major_corrs.append(np.dot(shifted_chroma, major_profile))
        minor_corrs.append(np.dot(shifted_chroma, minor_profile))
        
    # Find best match
    best_major_idx = np.argmax(major_corrs)
    best_minor_idx = np.argmax(minor_corrs)
    
    max_major = major_corrs[best_major_idx]
    max_minor = minor_corrs[best_minor_idx]
    
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    
    if max_major > max_minor:
        return f"{notes[best_major_idx]} Major"
    else:
        return f"{notes[best_minor_idx]} Minor"

def estimate_energy(y):
    # RMS energy
    rms = librosa.feature.rms(y=y)
    mean_rms = np.mean(rms)
    
    # Convert to dB (logarithmic scale is better for human perception of loudness)
    # Add epsilon to avoid log(0)
    db = 20 * np.log10(mean_rms + 1e-9)
    
    # Map dB to 0-100 range
    # -50 dB is very quiet (background noise/silence) -> 0
    # -5 dB is very loud (commercial master) -> 95-100
    # -2 dB is extremely loud -> 100
    
    min_db = -50.0
    max_db = -5.0
    
    # Linear interpolation within the dB range
    if db < min_db:
        energy = 0
    elif db > max_db:
        energy = 100
    else:
        energy = (db - min_db) / (max_db - min_db) * 100
    
    return int(round(energy))
