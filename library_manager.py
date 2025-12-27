import os
import json
import sqlite3
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
import xml.etree.ElementTree as ET
from xml.dom import minidom
import random
from datetime import datetime
from camelot_wheel import key_to_camelot, camelot_to_key, is_camelot_code, get_compatible_keys, get_transition_score
from contextlib import contextmanager

DB_FILE = "music_library.db"
LIBRARY_FILE = "library.json"
ANALYZED_FOLDERS_FILE = "analyzed_folders.json"

class LibraryManager:
    def __init__(self, db_path=DB_FILE):
        self._db_path = db_path
        self._conn = None
        self.recent_tracks = []  # Track recently used tracks
        self._loaded = False
        
        # Check if database exists, if not, check for JSON fallback
        if not os.path.exists(db_path):
            if os.path.exists(LIBRARY_FILE):
                print(f"⚠ Database {db_path} not found. Please run migrate_to_sqlite.py first.")
                raise FileNotFoundError(f"Database {db_path} not found. Run migration script first.")
        
        # Initialize database connection
        self._ensure_db_ready()

    def _ensure_db_ready(self):
        """Ensure database is ready and has schema."""
        if not os.path.exists(self._db_path):
            raise FileNotFoundError(f"Database {self._db_path} not found. Run migrate_to_sqlite.py first.")
        
        # Test connection
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")  # Simple test query
        self._loaded = True

    @contextmanager
    def _get_db_connection(self):
        """Get database connection with proper setup."""
        conn = sqlite3.connect(self._db_path, timeout=30.0)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
        finally:
            conn.close()

    def _ensure_loaded(self):
        """Ensure database is loaded (for backward compatibility)."""
        if not self._loaded:
            self._ensure_db_ready()

    def scan_directory(self, path):
        """Recursively scans directory and builds library cache."""
        self._ensure_loaded()
        
        new_tracks = []
        for root, _, files in os.walk(path):
            for file in files:
                if file.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
                    file_path = os.path.join(root, file)
                    metadata = self._extract_metadata(file_path)
                    if metadata:
                        new_tracks.append(metadata)
        
        # Batch insert tracks
        if new_tracks:
            self.batch_update_tracks(new_tracks)
        
        return len(new_tracks)

    def update_track(self, path, metadata, batch_mode=False, source_folder=None):
        """Update or add a track in the library.
        
        Args:
            path: File path
            metadata: Track metadata dict
            batch_mode: Ignored (DB handles transactions automatically)
            source_folder: Optional source folder path for tracking
        """
        self._ensure_loaded()
        
        # Add timestamp if not present
        if 'analyzed_at' not in metadata:
            metadata['analyzed_at'] = datetime.now().isoformat()
        
        # Ensure path is in metadata
        metadata['path'] = path
        if 'filename' not in metadata:
            metadata['filename'] = os.path.basename(path)
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Determine analysis status
            analysis_status = metadata.get('analysis_status', 'analyzed' if metadata.get('analyzed_at') else 'pending')
            
            # Insert or replace track
            cursor.execute("""
                INSERT OR REPLACE INTO tracks (
                    path, filename, title, artist, album,
                    bpm, key, key_camelot, energy, duration,
                    genre, mood, popularity, danceability,
                    valence, acousticness, analyzed_at, source,
                    analysis_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                metadata.get('path'),
                metadata.get('filename', os.path.basename(path)),
                metadata.get('title'),
                metadata.get('artist'),
                metadata.get('album'),
                metadata.get('bpm'),
                metadata.get('key'),
                metadata.get('key_camelot'),
                metadata.get('energy'),
                metadata.get('duration'),
                metadata.get('genre'),
                metadata.get('mood'),
                metadata.get('popularity'),
                metadata.get('danceability'),
                metadata.get('valence'),
                metadata.get('acousticness'),
                metadata.get('analyzed_at'),
                metadata.get('source'),
                analysis_status,
                datetime.now().isoformat()
            ))
            
            track_id = cursor.lastrowid
            
            # Handle source folders
            folders = []
            if source_folder:
                folders.append(source_folder)
            if metadata.get('source_folder'):
                folders.append(metadata['source_folder'])
            if metadata.get('source_folders'):
                folders.extend(metadata['source_folders'])
            
            # Remove duplicates
            folders = list(set(folders))
            
            # Clear existing folder associations
            cursor.execute("DELETE FROM track_folders WHERE track_id = ?", (track_id,))
            
            # Insert folder associations
            for folder_path in folders:
                cursor.execute("""
                    INSERT INTO track_folders (track_id, folder_path)
                    VALUES (?, ?)
                """, (track_id, folder_path))
                
                # Update analyzed_folders table
                cursor.execute("""
                    INSERT OR IGNORE INTO analyzed_folders (folder_path, imported_at)
                    VALUES (?, ?)
                """, (folder_path, datetime.now().isoformat()))
                
                # Update track_count
                cursor.execute("""
                    UPDATE analyzed_folders
                    SET track_count = (
                        SELECT COUNT(*) FROM track_folders WHERE folder_path = ?
                    ),
                    last_analyzed_at = (
                        SELECT MAX(analyzed_at) FROM tracks t
                        JOIN track_folders tf ON t.id = tf.track_id
                        WHERE tf.folder_path = ?
                    )
                    WHERE folder_path = ?
                """, (folder_path, folder_path, folder_path))
            
            # Handle genres
            cursor.execute("DELETE FROM track_genres WHERE track_id = ?", (track_id,))
            genres = metadata.get('genres', [])
            if isinstance(genres, str):
                genres = [genres]
            elif not isinstance(genres, list):
                genres = []
            
            for genre in genres:
                if genre:
                    cursor.execute("""
                        INSERT INTO track_genres (track_id, genre)
                        VALUES (?, ?)
                    """, (track_id, genre))
            
            conn.commit()
    
    def flush_updates(self):
        """No-op for backward compatibility (DB handles transactions automatically)."""
        pass
    
    def batch_update_tracks(self, tracks_metadata):
        """Update multiple tracks efficiently using transactions.
        
        Args:
            tracks_metadata: List of metadata dicts
        """
        self._ensure_loaded()
        
        timestamp = datetime.now().isoformat()
        updated_count = 0
        added_count = 0
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            try:
                conn.execute("BEGIN TRANSACTION")
                
                for metadata in tracks_metadata:
                    path = metadata.get('path')
                    if not path:
                        continue
                    
                    # Add timestamp
                    metadata['analyzed_at'] = metadata.get('analyzed_at', timestamp)
                    
                    # Check if exists
                    cursor.execute("SELECT id FROM tracks WHERE path = ?", (path,))
                    exists = cursor.fetchone()
                    
                    # Determine analysis status
                    analysis_status = metadata.get('analysis_status', 'analyzed' if metadata.get('analyzed_at') else 'pending')
                    
                    # Insert or replace
                    cursor.execute("""
                        INSERT OR REPLACE INTO tracks (
                            path, filename, title, artist, album,
                            bpm, key, key_camelot, energy, duration,
                            genre, mood, popularity, danceability,
                            valence, acousticness, analyzed_at, source,
                            analysis_status, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        path,
                        metadata.get('filename', os.path.basename(path)),
                        metadata.get('title'),
                        metadata.get('artist'),
                        metadata.get('album'),
                        metadata.get('bpm'),
                        metadata.get('key'),
                        metadata.get('key_camelot'),
                        metadata.get('energy'),
                        metadata.get('duration'),
                        metadata.get('genre'),
                        metadata.get('mood'),
                        metadata.get('popularity'),
                        metadata.get('danceability'),
                        metadata.get('valence'),
                        metadata.get('acousticness'),
                        metadata.get('analyzed_at'),
                        metadata.get('source'),
                        analysis_status,
                        datetime.now().isoformat()
                    ))
                    
                    track_id = cursor.lastrowid
                    
                    if exists:
                        updated_count += 1
                    else:
                        added_count += 1
                    
                    # Handle folders
                    folders = []
                    if metadata.get('source_folder'):
                        folders.append(metadata['source_folder'])
                    if metadata.get('source_folders'):
                        folders.extend(metadata['source_folders'])
                    
                    folders = list(set(folders))
                    
                    cursor.execute("DELETE FROM track_folders WHERE track_id = ?", (track_id,))
                    for folder_path in folders:
                        cursor.execute("""
                            INSERT INTO track_folders (track_id, folder_path)
                            VALUES (?, ?)
                        """, (track_id, folder_path))
                        
                        cursor.execute("""
                            INSERT OR IGNORE INTO analyzed_folders (folder_path, imported_at)
                            VALUES (?, ?)
                        """, (folder_path, datetime.now().isoformat()))
                    
                    # Handle genres
                    cursor.execute("DELETE FROM track_genres WHERE track_id = ?", (track_id,))
                    genres = metadata.get('genres', [])
                    if isinstance(genres, str):
                        genres = [genres]
                    elif not isinstance(genres, list):
                        genres = []
                    
                    for genre in genres:
                        if genre:
                            cursor.execute("""
                                INSERT INTO track_genres (track_id, genre)
                                VALUES (?, ?)
                            """, (track_id, genre))
                
                conn.commit()
                
                # Get total count
                cursor.execute("SELECT COUNT(*) FROM tracks")
                total = cursor.fetchone()[0]
                
                return {"updated": updated_count, "added": added_count, "total": total}
                
            except Exception as e:
                conn.rollback()
                raise

    def _extract_metadata(self, file_path):
        try:
            audio = mutagen.File(file_path)
            if not audio:
                return None

            # Basic defaults
            meta = {
                "path": file_path,
                "filename": os.path.basename(file_path),
                "title": os.path.basename(file_path),
                "artist": "Unknown Artist",
                "album": "Unknown Album",
                "bpm": 0,
                "key": "",
                "energy": 0,
                "genre": "",
                "mood": ""
            }

            # Extract based on type
            if isinstance(audio, MP3):
                # ID3 Tags
                if audio.tags:
                    id3 = EasyID3(file_path)
                    meta['title'] = id3.get('title', [meta['title']])[0]
                    meta['artist'] = id3.get('artist', [meta['artist']])[0]
                    meta['album'] = id3.get('album', [meta['album']])[0]
                    meta['genre'] = id3.get('genre', [meta['genre']])[0]
                    
                    # Custom tags often in TXXX or COMM
                    tags = audio.tags
                    if 'TBPM' in tags:
                        meta['bpm'] = float(tags['TBPM'].text[0])
                    if 'TKEY' in tags:
                        key_value = tags['TKEY'].text[0]
                        # Check if it's a Mixed in Key Camelot code (e.g., "8A", "11B")
                        if is_camelot_code(key_value):
                            # Convert Camelot to standard notation for our system
                            standard_key = camelot_to_key(key_value)
                            if standard_key:
                                meta['key'] = standard_key
                                meta['key_camelot'] = key_value.upper()  # Store original Camelot code
                            else:
                                meta['key'] = key_value  # Fallback to original if conversion fails
                        else:
                            meta['key'] = key_value  # Already in standard notation
                    
                    # Check TXXX for Energy and Mood
                    for frame in tags.getall('TXXX'):
                        if frame.desc == 'Energy':
                            meta['energy'] = float(frame.text[0])
                        elif frame.desc == 'Mood':
                            meta['mood'] = frame.text[0]
                            
            elif isinstance(audio, (FLAC, OggVorbis)):
                # Vorbis Comments
                meta['title'] = audio.get('title', [meta['title']])[0]
                meta['artist'] = audio.get('artist', [meta['artist']])[0]
                meta['album'] = audio.get('album', [meta['album']])[0]
                meta['genre'] = audio.get('genre', [meta['genre']])[0]
                
                if 'bpm' in audio:
                    meta['bpm'] = float(audio['bpm'][0])
                if 'key' in audio:
                    key_value = audio['key'][0]
                    # Check if it's a Mixed in Key Camelot code (e.g., "8A", "11B")
                    if is_camelot_code(key_value):
                        # Convert Camelot to standard notation for our system
                        standard_key = camelot_to_key(key_value)
                        if standard_key:
                            meta['key'] = standard_key
                            meta['key_camelot'] = key_value.upper()  # Store original Camelot code
                        else:
                            meta['key'] = key_value  # Fallback to original if conversion fails
                    else:
                        meta['key'] = key_value  # Already in standard notation
                if 'energy' in audio:
                    meta['energy'] = float(audio['energy'][0])
                if 'mood' in audio:
                    meta['mood'] = audio['mood'][0]

            return meta
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            return None

    def _row_to_dict(self, row, cursor):
        """Convert database row to dictionary."""
        columns = [desc[0] for desc in cursor.description]
        return dict(zip(columns, row))

    def query(self, filters):
        """
        Filter library based on criteria using SQL.
        filters = {
            "bpm_min": 120, "bpm_max": 130,
            "key": "5A",
            "energy_min": 0.5,
            "genre": "House"
        }
        """
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Build WHERE clause
            conditions = []
            params = []
            
            if filters.get('bpm_min'):
                conditions.append("t.bpm >= ?")
                params.append(float(filters['bpm_min']))
            
            if filters.get('bpm_max'):
                conditions.append("t.bpm <= ?")
                params.append(float(filters['bpm_max']))
            
            if filters.get('energy_min'):
                conditions.append("t.energy >= ?")
                params.append(float(filters['energy_min']))
            
            if filters.get('energy_max'):
                conditions.append("t.energy <= ?")
                params.append(float(filters['energy_max']))
            
            if filters.get('key'):
                conditions.append("t.key = ?")
                params.append(filters['key'])
            
            if filters.get('genre'):
                conditions.append("tg.genre LIKE ?")
                params.append(f"%{filters['genre']}%")
            
            where_clause = " AND ".join(conditions) if conditions else "1=1"
            
            # Build query
            if filters.get('genre'):
                query = f"""
                    SELECT DISTINCT t.* FROM tracks t
                    LEFT JOIN track_genres tg ON t.id = tg.track_id
                    WHERE {where_clause}
                """
            else:
                query = f"""
                    SELECT * FROM tracks t
                    WHERE {where_clause}
                """
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            # Convert to list of dicts
            results = []
            for row in rows:
                track = self._row_to_dict(row, cursor)
                # Get folders
                cursor.execute("""
                    SELECT folder_path FROM track_folders WHERE track_id = ?
                """, (track['id'],))
                folders = [r[0] for r in cursor.fetchall()]
                if folders:
                    track['source_folders'] = folders
                    track['source_folder'] = folders[0]
                
                # Get genres
                cursor.execute("""
                    SELECT genre FROM track_genres WHERE track_id = ?
                """, (track['id'],))
                genres = [r[0] for r in cursor.fetchall()]
                if genres:
                    track['genres'] = genres
                    if len(genres) == 1:
                        track['genre'] = genres[0]
                
                results.append(track)
            
            return results

    def get_track_by_path(self, path):
        """Get a single track by path."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tracks WHERE path = ?", (path,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            track = self._row_to_dict(row, cursor)
            
            # Get folders
            cursor.execute("SELECT folder_path FROM track_folders WHERE track_id = ?", (track['id'],))
            folders = [r[0] for r in cursor.fetchall()]
            if folders:
                track['source_folders'] = folders
                track['source_folder'] = folders[0]
            
            # Get genres
            cursor.execute("SELECT genre FROM track_genres WHERE track_id = ?", (track['id'],))
            genres = [r[0] for r in cursor.fetchall()]
            if genres:
                track['genres'] = genres
                if len(genres) == 1:
                    track['genre'] = genres[0]
            
            return track

    def generate_smart_playlist(self, duration_minutes=60, energy_curve=None, start_key=None, mood=None, filters=None, key_strictness="moderate", avoid_artist_repeats=True):
        """
        Generate an intelligent playlist using harmonic mixing and energy curve.
        
        Args:
            duration_minutes: Target playlist duration
            energy_curve: List of (time_percent, energy_level) tuples or preset name
            start_key: Optional starting Camelot key
            filters: Optional filters to pre-filter library
        
        Returns:
            List of tracks in optimal order
        """
        self._ensure_loaded()
        # Pre-filter library if needed
        available_tracks = self.query(filters) if filters else self._get_all_tracks()
        
        # Apply duration filters if specified
        if filters:
            if filters.get('duration_min'):
                available_tracks = [t for t in available_tracks if t.get('duration', 0) >= filters['duration_min']]
            if filters.get('duration_max'):
                available_tracks = [t for t in available_tracks if t.get('duration', 0) <= filters['duration_max']]
            # Genre filtering (if genres list provided)
            if filters.get('genres') and isinstance(filters['genres'], list):
                genre_filter = filters['genres']
                available_tracks = [t for t in available_tracks if 
                    (t.get('genres') and any(g and isinstance(g, str) and g.lower() in [gf.lower() for gf in genre_filter if gf] for g in (t['genres'] if isinstance(t['genres'], list) else [t['genres']]))) or
                    (t.get('genre') and isinstance(t.get('genre'), str) and t['genre'].lower() in [g.lower() for g in genre_filter if g])]
        
        # Filter by mood if specified
        if mood:
            # Check how many tracks have mood data
            tracks_with_mood = [t for t in available_tracks if t.get('mood') and isinstance(t.get('mood'), str) and t.get('mood').strip()]
            print(f"Mood filter: {len(tracks_with_mood)}/{len(available_tracks)} tracks have mood data")
            
            if len(tracks_with_mood) == 0:
                print(f"WARNING: No tracks have mood data. Please re-analyze your library with 'Force Re-analyze' to populate mood information.")
                return []
            
            mood_lower = mood.lower() if isinstance(mood, str) else str(mood).lower()
            available_tracks = [t for t in available_tracks if t.get('mood') and isinstance(t.get('mood'), str) and mood_lower in t.get('mood').lower()]
            print(f"Mood filter: {len(available_tracks)} tracks match mood '{mood}'")
        
        # Filter out tracks without essential data
        available_tracks = [t for t in available_tracks if t.get('bpm', 0) > 0 and t.get('key')]
        
        if not available_tracks:
            return []
        
        # Get or create energy curve
        if energy_curve is None or energy_curve == "gradual_build":
            # 0-100 scale
            energy_curve = [(0, 30), (0.3, 50), (0.7, 80), (1.0, 90)]
        elif energy_curve == "peak_sustain":
            energy_curve = [(0, 40), (0.2, 70), (0.8, 90), (1.0, 80)]
        elif energy_curve == "rollercoaster":
            energy_curve = [(0, 50), (0.25, 80), (0.5, 40), (0.75, 90), (1.0, 60)]
        elif energy_curve == "chill_down":
            energy_curve = [(0, 70), (0.5, 50), (1.0, 30)]
        
        # Estimate number of tracks (assuming ~4 min per track)
        target_tracks = int(duration_minutes / 4)
        
        playlist = []
        self.recent_tracks = []
        
        # Select starting track
        if start_key:
            start_candidates = [t for t in available_tracks if key_to_camelot(t.get('key', '')) == start_key]
            if start_candidates:
                current_track = random.choice(start_candidates)
            else:
                current_track = random.choice(available_tracks)
        else:
            current_track = random.choice(available_tracks)
        
        playlist.append(current_track)
        self.recent_tracks.append(current_track.get('path', ''))
        
        # Initialize recent artists tracking
        if avoid_artist_repeats:
            self.recent_artists = []
            artist = current_track.get('artist')
            if artist and isinstance(artist, str):
                self.recent_artists.append(artist.lower())
        
        # Build playlist
        for i in range(1, target_tracks):
            progress = i / target_tracks
            target_energy = self._interpolate_energy(progress, energy_curve)
            
            next_track = self._select_next_track(
                current_track,
                available_tracks,
                target_energy,
                key_strictness,
                avoid_artist_repeats
            )
            
            if next_track:
                playlist.append(next_track)
                self.recent_tracks.append(next_track.get('path', ''))
                current_track = next_track
            else:
                break
        
        return playlist
    
    def generate_smart_playlist_from_tracks(self, tracks, duration_minutes=60, energy_curve=None, start_key=None, mood=None, key_strictness="moderate", avoid_artist_repeats=True):
        """
        Generate an intelligent playlist from a provided list of tracks.
        
        Args:
            tracks: List of track dictionaries to use
            duration_minutes: Target playlist duration
            energy_curve: List of (time_percent, energy_level) tuples or preset name
            start_key: Optional starting Camelot key
            mood: Optional mood filter
        
        Returns:
            List of tracks in optimal order
        """
        # Filter by mood if specified
        available_tracks = tracks.copy()
        
        if mood:
            tracks_with_mood = [t for t in available_tracks if t.get('mood') and isinstance(t.get('mood'), str) and t.get('mood').strip()]
            if len(tracks_with_mood) == 0:
                print(f"WARNING: No tracks have mood data.")
                return []
            mood_lower = mood.lower() if isinstance(mood, str) else str(mood).lower()
            available_tracks = [t for t in available_tracks if t.get('mood') and isinstance(t.get('mood'), str) and mood_lower in t.get('mood').lower()]
        
        # Filter out tracks without essential data
        available_tracks = [t for t in available_tracks if t.get('bpm', 0) > 0 and t.get('key')]
        
        if not available_tracks:
            return []
        
        # Get or create energy curve
        if energy_curve is None or energy_curve == "gradual_build":
            # 0-100 scale
            energy_curve = [(0, 30), (0.3, 50), (0.7, 80), (1.0, 90)]
        elif energy_curve == "peak_sustain":
            energy_curve = [(0, 40), (0.2, 70), (0.8, 90), (1.0, 80)]
        elif energy_curve == "rollercoaster":
            energy_curve = [(0, 50), (0.25, 80), (0.5, 40), (0.75, 90), (1.0, 60)]
        elif energy_curve == "chill_down":
            energy_curve = [(0, 70), (0.5, 50), (1.0, 30)]
        
        # Estimate number of tracks (assuming ~4 min per track)
        target_tracks = int(duration_minutes / 4)
        
        playlist = []
        self.recent_tracks = []
        
        # Select starting track
        if start_key:
            start_candidates = [t for t in available_tracks if key_to_camelot(t.get('key', '')) == start_key]
            if start_candidates:
                current_track = random.choice(start_candidates)
            else:
                current_track = random.choice(available_tracks)
        else:
            current_track = random.choice(available_tracks)
        
        playlist.append(current_track)
        self.recent_tracks.append(current_track.get('path', ''))
        
        # Initialize recent artists tracking
        if avoid_artist_repeats:
            self.recent_artists = []
            artist = current_track.get('artist')
            if artist and isinstance(artist, str):
                self.recent_artists.append(artist.lower())
        
        # Build playlist
        for i in range(1, target_tracks):
            progress = i / target_tracks
            target_energy = self._interpolate_energy(progress, energy_curve)
            
            next_track = self._select_next_track(
                current_track,
                available_tracks,
                target_energy,
                key_strictness,
                avoid_artist_repeats
            )
            
            if next_track:
                playlist.append(next_track)
                self.recent_tracks.append(next_track.get('path', ''))
                current_track = next_track
            else:
                break
        
        return playlist

    def _get_all_tracks(self):
        """Get all tracks from database."""
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tracks")
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]
            
            results = []
            for row in rows:
                track = dict(zip(columns, row))
                track_id = track['id']
                
                # Get folders
                cursor.execute("SELECT folder_path FROM track_folders WHERE track_id = ?", (track_id,))
                folders = [r[0] for r in cursor.fetchall()]
                if folders:
                    track['source_folders'] = folders
                    track['source_folder'] = folders[0]
                
                # Get genres
                cursor.execute("SELECT genre FROM track_genres WHERE track_id = ?", (track_id,))
                genres = [r[0] for r in cursor.fetchall()]
                if genres:
                    track['genres'] = genres
                    if len(genres) == 1:
                        track['genre'] = genres[0]
                
                results.append(track)
            
            return results

    def _interpolate_energy(self, progress, curve):
        """Interpolate energy level at given progress point."""
        for i in range(len(curve) - 1):
            t1, e1 = curve[i]
            t2, e2 = curve[i + 1]
            
            if t1 <= progress <= t2:
                # Linear interpolation
                ratio = (progress - t1) / (t2 - t1) if t2 != t1 else 0
                return e1 + (e2 - e1) * ratio
        
        return curve[-1][1]

    def _select_next_track(self, current_track, available_tracks, target_energy, key_strictness="moderate", avoid_artist_repeats=True):
        """Select the best next track based on multiple criteria."""
        current_key = key_to_camelot(current_track.get('key', ''))
        current_bpm = current_track.get('bpm', 0)
        current_artist = (current_track.get('artist') or '').lower()
        
        # Track recent artists if avoiding repeats
        recent_artists = []
        if avoid_artist_repeats and hasattr(self, 'recent_artists'):
            recent_artists = self.recent_artists[-5:]  # Last 5 artists
        
        # Score all candidates
        candidates = []
        for track in available_tracks:
            # Skip recently played tracks
            if track.get('path', '') in self.recent_tracks[-10:]:
                continue
            
            # Skip if no key
            track_key = key_to_camelot(track.get('key', ''))
            if not track_key:
                continue
            
            # Skip artist repeats if enabled
            if avoid_artist_repeats:
                track_artist = (track.get('artist') or '').lower()
                if track_artist and track_artist in recent_artists:
                    continue
            
            score = 0
            
            # Key compatibility (0-10) - adjust based on strictness
            key_score = get_transition_score(current_key, track_key)
            if key_strictness == "strict":
                # Only accept high compatibility scores
                if key_score < 8:
                    continue
                score += key_score
            elif key_strictness == "moderate":
                # Accept moderate+ scores, but weight them
                if key_score < 6:
                    score += key_score * 0.5  # Penalize low scores
                else:
                    score += key_score
            else:  # loose
                score += key_score
            
            # Energy match (0-10)
            if track.get('energy', 0) > 0:
                energy_diff = abs(track.get('energy', 0) - target_energy)
                if energy_diff <= 10:
                    score += 10
                elif energy_diff <= 20:
                    score += 5
                elif energy_diff <= 30:
                    score += 2
            
            # BPM continuity (0-5)
            bpm_diff = abs(track.get('bpm', 0) - current_bpm)
            if bpm_diff <= 3:
                score += 5
            elif bpm_diff <= 6:
                score += 3
            elif bpm_diff <= 10:
                score += 1
            
            # Genre consistency (0-3)
            if current_track.get('genre') and track.get('genre'):
                current_genre = current_track.get('genre', '')
                track_genre = track.get('genre', '')
                if isinstance(current_genre, str) and isinstance(track_genre, str) and current_genre.lower() == track_genre.lower():
                    score += 3
            # Also check genres array
            elif current_track.get('genres') and track.get('genres'):
                current_genres = current_track['genres'] if isinstance(current_track['genres'], list) else [current_track['genres']]
                track_genres = track['genres'] if isinstance(track['genres'], list) else [track['genres']]
                # Filter out None values and ensure strings
                current_genres = [cg for cg in current_genres if cg and isinstance(cg, str)]
                track_genres = [tg for tg in track_genres if tg and isinstance(tg, str)]
                if any(cg.lower() in [tg.lower() for tg in track_genres] for cg in current_genres):
                    score += 3
            
            candidates.append((track, score))
        
        if not candidates:
            return None
        
        # Sort by score and return best
        candidates.sort(key=lambda x: x[1], reverse=True)
        
        # Add some randomness - pick from top 3
        top_candidates = candidates[:min(3, len(candidates))]
        selected = random.choice(top_candidates)[0]
        
        # Track artist if avoiding repeats
        if avoid_artist_repeats:
            if not hasattr(self, 'recent_artists'):
                self.recent_artists = []
            artist_name = (selected.get('artist') or '').lower()
            if artist_name:
                self.recent_artists.append(artist_name)
                # Keep only last 10 artists
                if len(self.recent_artists) > 10:
                    self.recent_artists = self.recent_artists[-10:]
        
        return selected

    def export_m3u(self, tracks, filename=None):
        if filename is None:
            # Rekordbox Playlists folder on macOS
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(rekordbox_playlists, f"SkullKrush_{timestamp}.m3u")
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write("#EXTM3U\n")
            for track in tracks:
                # Get duration in seconds, default to -1 if unknown
                duration = -1
                if track.get('duration'):
                    try:
                        dur = float(track.get('duration'))
                        if dur > 0:
                            duration = int(dur)
                    except (ValueError, TypeError):
                        pass
                
                # Get artist and title with fallbacks
                artist = track.get('artist') or 'Unknown Artist'
                title = track.get('title') or track.get('filename', 'Unknown')
                
                # Clean up artist and title (remove newlines, etc.)
                artist = str(artist).replace('\n', ' ').replace('\r', ' ').strip()
                title = str(title).replace('\n', ' ').replace('\r', ' ').strip()
                
                # Write EXTINF line: #EXTINF:duration,artist - title
                f.write(f"#EXTINF:{duration},{artist} - {title}\n")
                
                # Write file path (ensure it's on a single line, use absolute path)
                file_path = track.get('path', '')
                if file_path:
                    # Remove any newlines from path (shouldn't happen in real paths, but handle it)
                    file_path = str(file_path).replace('\n', '').replace('\r', '').strip()
                    if file_path:
                        f.write(f"{file_path}\n")
        return os.path.abspath(filename)

    def export_rekordbox(self, tracks, filename=None, playlist_name="Exported Playlist"):
        """
        Export tracks to Rekordbox XML format.
        
        Note: Rekordbox does NOT directly import playlists via XML drag-and-drop.
        For playlist import, use M3U format instead (File > Import > Import Playlist in Rekordbox).
        This XML format is for library/collection export purposes.
        """
        if filename is None:
            # Rekordbox Playlists folder on macOS
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(rekordbox_playlists, f"{playlist_name.replace(' ', '_')}_{timestamp}.xml")
        
        root = ET.Element("DJ_PLAYLISTS", version="1.0.0")
        
        # COLLECTION section - contains all tracks
        collection = ET.SubElement(root, "COLLECTION", Entries=str(len(tracks)))
        
        # Track IDs for playlist reference
        track_ids = []
        
        for track in tracks:
            # Generate consistent TrackID
            track_id = str(abs(hash(track['path'])))
            track_ids.append(track_id)
            
            # Rekordbox needs URL encoded paths: file://localhost/Users/...
            # Properly URL encode the path
            import urllib.parse
            path_parts = track['path'].split('/')
            encoded_parts = [urllib.parse.quote(part, safe='') for part in path_parts if part]
            location = "file://localhost/" + "/".join(encoded_parts)
            
            # Handle None values - XML cannot serialize None
            title = track.get('title') or track.get('filename', 'Unknown')
            artist = track.get('artist') or 'Unknown Artist'
            album = track.get('album') or 'Unknown Album'
            genre = track.get('genre') or ''
            key = track.get('key') or ''
            bpm = track.get('bpm', 0) or 0
            
            # Get duration in milliseconds
            total_time = 0
            if track.get('duration'):
                try:
                    dur = float(track.get('duration'))
                    if dur > 0:
                        total_time = int(dur * 1000)  # Convert to milliseconds
                except (ValueError, TypeError):
                    pass
            
            ET.SubElement(collection, "TRACK", 
                TrackID=track_id,
                Name=str(title),
                Artist=str(artist),
                Album=str(album),
                Genre=str(genre),
                Kind="MP3 File",
                Size="0",
                TotalTime=str(total_time),
                Location=location,
                AverageBpm=str(int(bpm)),
                Tonality=str(key)
            )
        
        # PLAYLISTS section - contains playlist definitions
        playlists = ET.SubElement(root, "PLAYLISTS")
        node = ET.SubElement(playlists, "NODE", Name="ROOT", Type="0", Count="1")
        playlist_node = ET.SubElement(node, "NODE", Name=playlist_name, Type="1", KeyType="0", Entries=str(len(tracks)))
        
        # Add tracks to playlist in order
        for i, track_id in enumerate(track_ids):
            ET.SubElement(playlist_node, "TRACK", Key=track_id)
        
        xmlstr = minidom.parseString(ET.tostring(root)).toprettyxml(indent="  ")
        with open(filename, "w", encoding='utf-8') as f:
            f.write(xmlstr)
        return os.path.abspath(filename)
    
    def get_statistics(self):
        """Get library statistics and health metrics."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Total tracks
            cursor.execute("SELECT COUNT(*) FROM tracks")
            total_tracks = cursor.fetchone()[0]
            
            if total_tracks == 0:
                return {
                    "total_tracks": 0,
                    "analyzed_tracks": 0,
                    "missing_files": 0,
                    "incomplete_metadata": 0,
                    "coverage": {
                        "bpm": 0,
                        "key": 0,
                        "energy": 0,
                        "genre": 0,
                        "mood": 0
                    },
                    "health_score": 0
                }
            
            # Analyzed tracks
            cursor.execute("SELECT COUNT(*) FROM tracks WHERE analyzed_at IS NOT NULL")
            analyzed_count = cursor.fetchone()[0]
            
            # Missing files (check existence)
            cursor.execute("SELECT path FROM tracks")
            all_paths = [r[0] for r in cursor.fetchall()]
            missing_files = sum(1 for p in all_paths if not os.path.exists(p))
            
            # Coverage
            cursor.execute("SELECT COUNT(*) FROM tracks WHERE bpm > 0")
            bpm_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM tracks WHERE key IS NOT NULL AND key != ''")
            key_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM tracks WHERE energy > 0")
            energy_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(DISTINCT track_id) FROM track_genres")
            genre_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM tracks WHERE mood IS NOT NULL AND mood != ''")
            mood_count = cursor.fetchone()[0]
            
            # Incomplete metadata (missing bpm, key, or energy)
            cursor.execute("""
                SELECT COUNT(*) FROM tracks
                WHERE bpm = 0 OR key IS NULL OR key = '' OR energy = 0
            """)
            incomplete_metadata = cursor.fetchone()[0]
            
            # Convert to percentages
            coverage = {
                "bpm": round((bpm_count / total_tracks) * 100, 1) if total_tracks > 0 else 0,
                "key": round((key_count / total_tracks) * 100, 1) if total_tracks > 0 else 0,
                "energy": round((energy_count / total_tracks) * 100, 1) if total_tracks > 0 else 0,
                "genre": round((genre_count / total_tracks) * 100, 1) if total_tracks > 0 else 0,
                "mood": round((mood_count / total_tracks) * 100, 1) if total_tracks > 0 else 0
            }
            
            # Calculate health score (0-100)
            health_score = 0
            if total_tracks > 0:
                file_health = ((total_tracks - missing_files) / total_tracks) * 40
                metadata_health = ((total_tracks - incomplete_metadata) / total_tracks) * 40
                analysis_health = (analyzed_count / total_tracks) * 20
                health_score = round(file_health + metadata_health + analysis_health, 1)
            
            # Get unique genres
            cursor.execute("SELECT DISTINCT genre FROM track_genres ORDER BY genre")
            genres = [r[0] for r in cursor.fetchall()]
            
            return {
                "total_tracks": total_tracks,
                "analyzed_tracks": analyzed_count,
                "missing_files": missing_files,
                "incomplete_metadata": incomplete_metadata,
                "coverage": coverage,
                "health_score": health_score,
                "genres": genres
            }
    
    def check_health(self):
        """Check library health and return detailed report."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get all tracks
            cursor.execute("SELECT * FROM tracks")
            rows = cursor.fetchall()
            
            missing_files = []
            incomplete_tracks = []
            duplicate_paths = {}
            
            # Track paths for duplicates
            path_counts = {}
            for row in rows:
                track = self._row_to_dict(row, cursor)
                path = track.get('path', '')
                if path in path_counts:
                    path_counts[path].append(track)
                else:
                    path_counts[path] = [track]
            
            # Find duplicates
            for path, tracks in path_counts.items():
                if len(tracks) > 1:
                    duplicate_paths[path] = [t.get('id') for t in tracks]
            
            # Check each track
            for row in rows:
                track = self._row_to_dict(row, cursor)
                path = track.get('path', '')
                
                # Check if file exists
                if not os.path.exists(path):
                    missing_files.append({
                        "path": path,
                        "title": track.get('title', 'Unknown'),
                        "artist": track.get('artist', 'Unknown')
                    })
                    continue
                
                # Check metadata completeness
                missing_fields = []
                if not track.get('bpm', 0) > 0:
                    missing_fields.append('bpm')
                if not track.get('key', '').strip():
                    missing_fields.append('key')
                if not track.get('energy', 0) > 0:
                    missing_fields.append('energy')
                
                if missing_fields:
                    incomplete_tracks.append({
                        "path": path,
                        "title": track.get('title', 'Unknown'),
                        "artist": track.get('artist', 'Unknown'),
                        "missing_fields": missing_fields
                    })
            
            stats = self.get_statistics()
            
            return {
                "statistics": stats,
                "missing_files": missing_files,
                "incomplete_tracks": incomplete_tracks,
                "duplicates": duplicate_paths,
                "issues_found": len(missing_files) + len(incomplete_tracks) + len(duplicate_paths)
            }
    
    def cleanup_orphans(self, dry_run=True):
        """Remove tracks that no longer exist on disk.
        
        Args:
            dry_run: If True, return list without removing
            
        Returns:
            List of removed/orphaned tracks
        """
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Find orphaned tracks
            cursor.execute("SELECT * FROM tracks")
            rows = cursor.fetchall()
            
            orphans = []
            valid_ids = []
            
            for row in rows:
                track = self._row_to_dict(row, cursor)
                path = track.get('path', '')
                
                if os.path.exists(path):
                    valid_ids.append(track['id'])
                else:
                    orphans.append(track)
            
            if not dry_run:
                # Delete orphaned tracks (cascade will handle related records)
                for orphan in orphans:
                    cursor.execute("DELETE FROM tracks WHERE id = ?", (orphan['id'],))
                conn.commit()
            
            return {
                "removed_count": len(orphans),
                "remaining_count": len(valid_ids),
                "orphaned_tracks": orphans
            }
    
    def remove_duplicates(self, dry_run=True):
        """Remove duplicate entries (same path).
        
        Args:
            dry_run: If True, return list without removing
            
        Returns:
            Dict with duplicate info
        """
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Find duplicates
            cursor.execute("""
                SELECT path, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
                FROM tracks
                GROUP BY path
                HAVING cnt > 1
            """)
            
            duplicates = []
            ids_to_keep = set()
            
            for row in cursor.fetchall():
                path, count, ids_str = row
                ids = [int(id) for id in ids_str.split(',')]
                # Keep first, mark others as duplicates
                ids_to_keep.add(ids[0])
                duplicates.extend(ids[1:])
            
            if not dry_run:
                # Delete duplicates (keep first occurrence)
                for dup_id in duplicates:
                    cursor.execute("DELETE FROM tracks WHERE id = ?", (dup_id,))
                conn.commit()
            
            cursor.execute("SELECT COUNT(*) FROM tracks")
            unique_count = cursor.fetchone()[0]
            
            return {
                "duplicate_count": len(duplicates),
                "unique_count": unique_count,
                "duplicates": duplicates
            }
    
    def get_folder_statistics(self):
        """Get statistics organized by source folders."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    tf.folder_path,
                    COUNT(DISTINCT tf.track_id) as track_count,
                    COUNT(DISTINCT CASE WHEN t.analyzed_at IS NOT NULL THEN tf.track_id END) as analyzed_count,
                    MAX(t.analyzed_at) as last_analyzed
                FROM track_folders tf
                LEFT JOIN tracks t ON tf.track_id = t.id
                GROUP BY tf.folder_path
            """)
            
            folder_stats = {}
            for row in cursor.fetchall():
                folder_path, track_count, analyzed_count, last_analyzed = row
                
                # Get tracks for this folder
                cursor.execute("""
                    SELECT t.* FROM tracks t
                    JOIN track_folders tf ON t.id = tf.track_id
                    WHERE tf.folder_path = ?
                """, (folder_path,))
                
                tracks = []
                for track_row in cursor.fetchall():
                    track = self._row_to_dict(track_row, cursor)
                    # Get genres
                    cursor.execute("SELECT genre FROM track_genres WHERE track_id = ?", (track['id'],))
                    genres = [r[0] for r in cursor.fetchall()]
                    if genres:
                        track['genres'] = genres
                    tracks.append(track)
                
                folder_stats[folder_path] = {
                    'track_count': track_count,
                    'analyzed_count': analyzed_count,
                    'last_analyzed': last_analyzed,
                    'tracks': tracks
                }
        
        return folder_stats
    
    def get_analyzed_folders(self):
        """Get list of folders that have been analyzed."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT folder_path FROM analyzed_folders ORDER BY folder_path")
            return [row[0] for row in cursor.fetchall()]
    
    def get_tracks_by_folder(self, folder_path):
        """Get all tracks from a specific folder."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT t.* FROM tracks t
                JOIN track_folders tf ON t.id = tf.track_id
                WHERE tf.folder_path = ?
            """, (folder_path,))
            
            # Get column names before fetching rows
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            results = []
            
            for row in rows:
                # Convert row to dict using column names
                track = dict(zip(columns, row)) if columns else {}
                
                # Ensure 'id' exists before using it
                if 'id' not in track:
                    # Try to find id column (case-insensitive)
                    id_idx = next((i for i, col in enumerate(columns) if col.lower() == 'id'), None)
                    if id_idx is not None:
                        track['id'] = row[id_idx]
                    else:
                        print(f"Warning: No 'id' column found in track row for folder {folder_path}")
                        continue
                
                # Get genres
                cursor.execute("SELECT genre FROM track_genres WHERE track_id = ?", (track['id'],))
                genres = [r[0] for r in cursor.fetchall()]
                if genres:
                    track['genres'] = genres
                    if len(genres) == 1:
                        track['genre'] = genres[0]
                
                track['source_folder'] = folder_path
                track['source_folders'] = [folder_path]
                results.append(track)
            
            return results
    
    def find_content_duplicates(self, dry_run=True):
        """Find duplicate tracks based on content (title + artist + BPM) rather than just path.
        
        Args:
            dry_run: If True, return list without removing
            
        Returns:
            Dict with content duplicate info
        """
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Group tracks by content signature
            cursor.execute("""
                SELECT 
                    LOWER(COALESCE(artist, '')) || '|' || LOWER(COALESCE(title, '')) || '|' || CAST(bpm AS TEXT) as signature,
                    GROUP_CONCAT(id) as ids
                FROM tracks
                WHERE artist IS NOT NULL AND title IS NOT NULL AND bpm > 0
                GROUP BY signature
                HAVING COUNT(*) > 1
            """)
            
            duplicate_groups = []
            duplicates = []
            ids_to_keep = set()
            
            for row in cursor.fetchall():
                signature, ids_str = row
                ids = [int(id) for id in ids_str.split(',')]
                ids_to_keep.add(ids[0])
                duplicates.extend(ids[1:])
                
                # Get track details
                cursor.execute("SELECT * FROM tracks WHERE id IN ({})".format(','.join('?' * len(ids))), ids)
                tracks = [self._row_to_dict(r, cursor) for r in cursor.fetchall()]
                
                duplicate_groups.append({
                    "signature": signature,
                    "count": len(ids),
                    "tracks": tracks
                })
            
            if not dry_run:
                for dup_id in duplicates:
                    cursor.execute("DELETE FROM tracks WHERE id = ?", (dup_id,))
                conn.commit()
            
            cursor.execute("SELECT COUNT(*) FROM tracks")
            unique_count = cursor.fetchone()[0]
            
            return {
                "duplicate_count": len(duplicates),
                "unique_count": unique_count,
                "duplicate_groups": duplicate_groups
            }
    
    def refresh_track_metadata(self, path, force_spotify=False):
        """Refresh metadata for a track without re-analyzing audio.
        
        Args:
            path: File path
            force_spotify: If True, re-fetch Spotify metadata even if exists
            
        Returns:
            Updated metadata dict
        """
        self._ensure_loaded()
        
        track = self.get_track_by_path(path)
        if not track:
            return None
        
        # Extract metadata from file tags
        updated_metadata = self._extract_metadata(path)
        if not updated_metadata:
            return None
        
        # Merge with existing metadata
        updated_metadata['analyzed_at'] = track.get('analyzed_at', datetime.now().isoformat())
        
        # Preserve source folders
        if track.get('source_folders'):
            updated_metadata['source_folders'] = track['source_folders']
            updated_metadata['source_folder'] = track['source_folders'][0]
        
        # Update library
        self.update_track(path, updated_metadata, source_folder=updated_metadata.get('source_folder'))
        
        return updated_metadata
    
    def refresh_library_metadata(self, folder_path=None):
        """Refresh metadata for all tracks (or tracks in a folder) without re-analysis.
        
        Args:
            folder_path: Optional folder path to limit refresh
            
        Returns:
            Dict with refresh results
        """
        self._ensure_loaded()
        
        if folder_path:
            tracks_to_refresh = self.get_tracks_by_folder(folder_path)
        else:
            tracks_to_refresh = self._get_all_tracks()
        
        refreshed = 0
        failed = 0
        
        for track in tracks_to_refresh:
            path = track.get('path')
            if not path or not os.path.exists(path):
                continue
            
            try:
                updated = self.refresh_track_metadata(path)
                if updated:
                    refreshed += 1
            except Exception as e:
                print(f"Error refreshing {path}: {e}")
                failed += 1
        
        return {
            "refreshed": refreshed,
            "failed": failed,
            "total": len(tracks_to_refresh)
        }
    
    def clear_all_data(self):
        """Clear all library data - resets to empty state."""
        self._ensure_loaded()
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM tracks")
            cursor.execute("DELETE FROM analyzed_folders")
            cursor.execute("DELETE FROM playlists")
            conn.commit()
        
        return {
            "success": True,
            "message": "All library data cleared"
        }
    
    def organize_by_folders(self):
        """Organize library tracks by their source folders."""
        self._ensure_loaded()
        
        folder_organization = {}
        
        with self._get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT DISTINCT folder_path FROM track_folders
            """)
            folders = [row[0] for row in cursor.fetchall()]
            
            for folder in folders:
                tracks = self.get_tracks_by_folder(folder)
                folder_organization[folder] = {
                    'path': folder,
                    'track_count': len(tracks),
                    'tracks': tracks
                }
        
        return folder_organization
    
    def organize_by_playlists(self, playlists_dir="playlists"):
        """Organize library tracks by playlists they appear in.
        
        Note: Playlists are stored as JSON files, not in the database.
        This function reads from JSON files in the playlists directory.
        """
        import os
        import json
        
        playlist_organization = {}
        
        if not os.path.exists(playlists_dir):
            return playlist_organization
        
        for filename in os.listdir(playlists_dir):
            if not filename.endswith('.json'):
                continue
            
            playlist_path = os.path.join(playlists_dir, filename)
            try:
                with open(playlist_path, 'r') as f:
                    data = json.load(f)
                    
                playlist_name = data.get('name', filename.replace('.json', ''))
                tracks = data.get('tracks', [])
                
                playlist_organization[playlist_name] = {
                    'name': playlist_name,
                    'track_count': len(tracks),
                    'tracks': tracks,
                    'file': filename
                }
            except Exception as e:
                print(f"Error loading playlist {filename}: {e}")
                continue
        
        return playlist_organization

    # Property for backward compatibility
    @property
    def library(self):
        """Backward compatibility property that returns all tracks."""
        return self._get_all_tracks()
