"""
Camelot Wheel key conversion and harmonic mixing compatibility system.
Based on the Circle of Fifths, optimized for DJ mixing.
"""

# Standard key to Camelot code mapping
KEY_TO_CAMELOT = {
    # Major keys (outer wheel - B)
    "C Major": "8B",
    "G Major": "9B",
    "D Major": "10B",
    "A Major": "11B",
    "E Major": "12B",
    "B Major": "1B",
    "F# Major": "2B",
    "Gb Major": "2B",  # Enharmonic equivalent
    "Db Major": "3B",
    "C# Major": "3B",  # Enharmonic equivalent
    "Ab Major": "4B",
    "Eb Major": "5B",
    "Bb Major": "6B",
    "F Major": "7B",
    
    # Minor keys (inner wheel - A)
    "A Minor": "8A",
    "E Minor": "9A",
    "B Minor": "10A",
    "F# Minor": "11A",
    "C# Minor": "12A",
    "G# Minor": "1A",
    "Ab Minor": "1A",  # Enharmonic equivalent
    "D# Minor": "2A",
    "Eb Minor": "2A",  # Enharmonic equivalent
    "Bb Minor": "3A",
    "A# Minor": "3A",  # Enharmonic equivalent
    "F Minor": "4A",
    "C Minor": "5A",
    "G Minor": "6A",
    "D Minor": "7A",
}

# Reverse mapping for display
CAMELOT_TO_KEY = {v: k for k, v in KEY_TO_CAMELOT.items() if "b" not in k.lower() or k.endswith("Major")}

def normalize_key(key_string):
    """Normalize key string to match our mapping."""
    if not key_string:
        return None
    
    # Handle various formats: "C", "C Major", "Cmaj", etc.
    key_string = key_string.strip()
    
    # If it's already in our mapping, return it
    if key_string in KEY_TO_CAMELOT:
        return key_string
    
    # Try to parse and normalize
    # Remove common suffixes
    for suffix in [" major", " minor", "maj", "min", "m"]:
        if key_string.lower().endswith(suffix):
            base = key_string[:-len(suffix)].strip()
            if suffix.lower() in ["major", "maj"]:
                normalized = f"{base} Major"
            else:
                normalized = f"{base} Minor"
            
            if normalized in KEY_TO_CAMELOT:
                return normalized
    
    # If just a note name, assume major
    if len(key_string) <= 2:
        normalized = f"{key_string} Major"
        if normalized in KEY_TO_CAMELOT:
            return normalized
    
    return None

def key_to_camelot(key_string):
    """Convert standard key notation to Camelot code."""
    normalized = normalize_key(key_string)
    return KEY_TO_CAMELOT.get(normalized)

def camelot_to_key(camelot_code):
    """Convert Camelot code to standard key notation."""
    return CAMELOT_TO_KEY.get(camelot_code)

def get_compatible_keys(camelot_code, compatibility_level="strict"):
    """
    Get list of compatible Camelot codes for harmonic mixing.
    
    Args:
        camelot_code: Starting Camelot code (e.g., "8A")
        compatibility_level: "strict", "moderate", or "loose"
    
    Returns:
        List of (camelot_code, compatibility_score, transition_type) tuples
    """
    if not camelot_code or len(camelot_code) < 2:
        return []
    
    try:
        number = int(camelot_code[:-1])
        letter = camelot_code[-1]
    except (ValueError, IndexError):
        return []
    
    compatible = []
    
    # Perfect match - same key
    compatible.append((camelot_code, 10, "Same Key"))
    
    # Relative major/minor - same number, different letter
    relative = f"{number}{'A' if letter == 'B' else 'B'}"
    compatible.append((relative, 9, "Relative"))
    
    # Adjacent keys - ±1 step on wheel
    next_num = (number % 12) + 1
    prev_num = ((number - 2) % 12) + 1
    
    compatible.append((f"{next_num}{letter}", 8, "+1 Step"))
    compatible.append((f"{prev_num}{letter}", 8, "-1 Step"))
    
    if compatibility_level in ["moderate", "loose"]:
        # Energy boost/drop - ±2 steps
        boost_num = ((number + 1) % 12) + 1
        drop_num = ((number - 3) % 12) + 1
        
        compatible.append((f"{boost_num}{letter}", 6, "+2 Energy Boost"))
        compatible.append((f"{drop_num}{letter}", 6, "-2 Energy Drop"))
    
    if compatibility_level == "loose":
        # Diagonal mixing - adjacent number, opposite letter
        compatible.append((f"{next_num}{'A' if letter == 'B' else 'B'}", 5, "Diagonal +1"))
        compatible.append((f"{prev_num}{'A' if letter == 'B' else 'B'}", 5, "Diagonal -1"))
    
    return compatible

def is_compatible(key1, key2, min_score=6):
    """
    Check if two Camelot codes are compatible for mixing.
    
    Args:
        key1, key2: Camelot codes to compare
        min_score: Minimum compatibility score (default 6)
    
    Returns:
        Boolean indicating compatibility
    """
    if not key1 or not key2:
        return False
    
    compatible_keys = get_compatible_keys(key1, compatibility_level="loose")
    
    for code, score, _ in compatible_keys:
        if code == key2 and score >= min_score:
            return True
    
    return False

def get_transition_score(from_key, to_key):
    """
    Get a score (0-10) for transitioning between two keys.
    Higher is better.
    """
    if not from_key or not to_key:
        return 0
    
    compatible_keys = get_compatible_keys(from_key, compatibility_level="loose")
    
    for code, score, _ in compatible_keys:
        if code == to_key:
            return score
    
    return 0  # Not compatible
