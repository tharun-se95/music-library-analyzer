import librosa
import numpy as np
import scipy.stats

def analyze_track(path):
    """
    Analyzes an audio file to extract BPM, Key, and Energy.
    Returns a dictionary with the analysis results.
    """
    try:
        # Load audio (only first 2 minutes to save time, or full if needed)
        # Using a duration limit helps with performance on large libraries
        y, sr = librosa.load(path, duration=120)
        
        bpm = estimate_bpm(y, sr)
        key = estimate_key(y, sr)
        energy = estimate_energy(y)
        
        return {
            "bpm": int(round(bpm)),
            "key": key,
            "energy": float(round(energy, 2))
        }
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
    # Return mean RMS scaled to 0-100 roughly (experimentally)
    # Typical RMS values are small, let's normalize or just return raw mean for now
    # A simple scaling:
    return np.mean(rms) * 1000 # Arbitrary scaling for display
