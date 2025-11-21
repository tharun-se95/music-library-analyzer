import sys
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, TXXX

def inspect_tags(path):
    print(f"Inspecting: {path}")
    try:
        audio = mutagen.File(path)
        if audio is None:
            print("Could not load file.")
            return

        print("\n--- Standard Tags ---")
        # Try to print common tags
        if hasattr(audio, 'tags'):
            print(audio.tags.pprint())
        else:
            print(audio.pprint())

        print("\n--- Custom/Specific Tags ---")
        # Check for our specific fields
        # For MP3/ID3
        if hasattr(audio, 'tags') and isinstance(audio.tags, ID3):
            for frame in audio.tags.values():
                if isinstance(frame, TXXX):
                    print(f"TXXX ({frame.desc}): {frame.text}")
                elif frame.FrameID == 'TBPM':
                    print(f"BPM: {frame.text}")
                elif frame.FrameID == 'TKEY':
                    print(f"Key: {frame.text}")
        
        # For others (Vorbis/FLAC)
        elif hasattr(audio, 'tags'):
             for k, v in audio.tags.items():
                 if k.upper() in ['BPM', 'KEY', 'ENERGY', 'POPULARITY', 'GENRES', 'DANCEABILITY', 'VALENCE']:
                     print(f"{k.upper()}: {v}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_tags.py <path_to_audio_file>")
    else:
        inspect_tags(sys.argv[1])
