import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, TXXX
from mutagen.mp3 import MP3
from mutagen.wave import WAVE

def tag_file(path, metadata):
    """
    Writes metadata tags to the audio file.
    Supports MP3/ID3 and WAV/ID3.
    """
    try:
        audio = mutagen.File(path)
        
        if audio is None:
            print(f"Could not load tags for {path}")
            return

        # Handle MP3 and WAV (both can use ID3)
        if isinstance(audio, MP3) or isinstance(audio, WAVE):
            if audio.tags is None:
                try:
                    audio.add_tags()
                except Exception:
                    pass # Tags might already exist or not support adding
            
            # Standard tags
            # Note: EasyID3 maps common keys, but for custom ones we need ID3 directly or TXXX
            
            # Write BPM
            if 'bpm' in metadata:
                # TBPM frame
                audio.tags.add(mutagen.id3.TBPM(encoding=3, text=str(metadata['bpm'])))
            
            # Write Key (TKEY)
            if 'key' in metadata:
                audio.tags.add(mutagen.id3.TKEY(encoding=3, text=str(metadata['key'])))
                
            # Custom tags for others using TXXX
            custom_fields = ['energy', 'popularity', 'danceability', 'valence', 'genres']
            for field in custom_fields:
                if field in metadata:
                    val = str(metadata[field])
                    audio.tags.add(TXXX(encoding=3, desc=field.upper(), text=val))
            
            # REKORDBOX COMPATIBILITY: Write rich data to Comments
            # Rekordbox doesn't show TXXX tags, so we put them in the Comment field for searchability
            comment_parts = []
            if 'energy' in metadata:
                comment_parts.append(f"Energy: {metadata['energy']}")
            if 'popularity' in metadata:
                comment_parts.append(f"Pop: {metadata['popularity']}")
            if 'genres' in metadata and metadata['genres']:
                # Clean up genre list string if it looks like "['a', 'b']"
                g_str = str(metadata['genres']).replace("['", "").replace("']", "").replace("', '", ", ")
                comment_parts.append(f"Genres: {g_str}")
            if 'mood' in metadata:
                # Store mood in TXXX frame
                audio.tags.add(mutagen.id3.TXXX(encoding=3, desc='Mood', text=metadata['mood']))
                comment_parts.append(f"Mood: {metadata['mood']}")
            
            if comment_parts:
                comment_text = " | ".join(comment_parts)
                # Add to existing comment if possible, or overwrite
                audio.tags.add(mutagen.id3.COMM(encoding=3, lang='eng', desc='Analysis', text=comment_text))

            audio.save()
            print(f"Tagged {path}")
            
        else:
            # For other formats (FLAC, OGG, WAV), mutagen.File returns a dict-like object
            # Values should typically be lists of strings
            if 'bpm' in metadata:
                audio['bpm'] = [str(metadata['bpm'])]
            
            # Also write to COMMENT for compatibility
            comment_parts = []
            
            for k, v in metadata.items():
                if k not in ['bpm']: # BPM already handled or standard
                    audio[k] = [str(v)]
                    if k in ['energy', 'popularity', 'genres', 'mood']:
                         comment_parts.append(f"{k.capitalize()}: {v}")
            
            if comment_parts:
                audio['comment'] = [" | ".join(comment_parts)]
            
            audio.save()
            print(f"Tagged {path}")

    except Exception as e:
        print(f"Error tagging {path}: {e}")

def has_analysis_tags(path):
    """
    Checks if the file already has analysis tags (BPM, Key).
    Returns True if analyzed, False otherwise.
    """
    try:
        audio = mutagen.File(path)
        if audio is None:
            return False

        if isinstance(audio, MP3) or isinstance(audio, WAVE):
            if audio.tags:
                # Check for TBPM (BPM) and TKEY (Key)
                has_bpm = 'TBPM' in audio.tags
                has_key = 'TKEY' in audio.tags
                return has_bpm and has_key
        else:
            # FLAC, OGG, etc.
            has_bpm = 'bpm' in audio
            has_key = 'key' in audio
            return has_bpm and has_key
            
    except Exception:
        return False
    return False

def clear_analysis_tags(path):
    """
    Clears analysis tags (BPM, Key, Energy, etc.) from a file.
    Used when force re-analyzing.
    """
    try:
        audio = mutagen.File(path)
        if audio is None:
            return
        
        if isinstance(audio, MP3) or isinstance(audio, WAVE):
            if audio.tags:
                # Remove analysis tags
                tags_to_remove = ['TBPM', 'TKEY']
                for tag in tags_to_remove:
                    if tag in audio.tags:
                        del audio.tags[tag]
                
                # Remove custom TXXX tags
                txxx_to_remove = []
                for frame in audio.tags.values():
                    if isinstance(frame, TXXX):
                        desc = frame.desc.upper()
                        if desc in ['ENERGY', 'MOOD', 'POPULARITY', 'DANCEABILITY', 'VALENCE', 'GENRES']:
                            txxx_to_remove.append(frame)
                
                for frame in txxx_to_remove:
                    audio.tags.remove(frame)
                
                audio.save()
                print(f"Cleared analysis tags from {path}")
        else:
            # FLAC, OGG, etc.
            tags_to_remove = ['bpm', 'key', 'energy', 'mood', 'popularity', 'danceability', 'valence', 'genres']
            for tag in tags_to_remove:
                if tag in audio:
                    del audio[tag]
            audio.save()
            print(f"Cleared analysis tags from {path}")
    except Exception as e:
        print(f"Error clearing tags from {path}: {e}")
