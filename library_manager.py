import os
import json
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
import xml.etree.ElementTree as ET
from xml.dom import minidom
import random
from datetime import datetime
from camelot_wheel import key_to_camelot, get_compatible_keys, get_transition_score

LIBRARY_FILE = "library.json"

class LibraryManager:
    def __init__(self):
        self.library = None  # Lazy load on first access
        self.recent_tracks = []  # Track recently used tracks
        self._loaded = False
        self._pending_updates = []  # Batch updates for optimization
        self._save_threshold = 10  # Save after N updates
        self._analyzed_folders = set()  # Track which folders have been analyzed

    def _ensure_loaded(self):
        """Lazy load library on first access"""
        if not self._loaded:
            self.load_library()
            self._loaded = True

    def load_library(self):
        if os.path.exists(LIBRARY_FILE):
            try:
                with open(LIBRARY_FILE, 'r') as f:
                    self.library = json.load(f)
                # Filter out malformed entries
                self.library = [t for t in self.library if 'path' in t]
                
                # Build analyzed folders set from library
                self._analyzed_folders = set()
                for track in self.library:
                    if 'source_folder' in track:
                        self._analyzed_folders.add(track['source_folder'])
                    if 'source_folders' in track:
                        self._analyzed_folders.update(track['source_folders'])
            except:
                self.library = []
                self._analyzed_folders = set()
        else:
            self.library = []
            self._analyzed_folders = set()

    def save_library(self):
        with open(LIBRARY_FILE, 'w') as f:
            json.dump(self.library, f, indent=4)

    def scan_directory(self, path):
        """Recursively scans directory and builds library cache."""
        self._ensure_loaded()
        new_library = []
        for root, _, files in os.walk(path):
            for file in files:
                if file.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
                    file_path = os.path.join(root, file)
                    metadata = self._extract_metadata(file_path)
                    if metadata:
                        new_library.append(metadata)
        
        self.library = new_library
        self.save_library()
        return len(self.library)

    def update_track(self, path, metadata, batch_mode=False, source_folder=None):
        """Update or add a track in the library.
        
        Args:
            path: File path
            metadata: Track metadata dict
            batch_mode: If True, batch updates for performance (call flush_updates() to save)
            source_folder: Optional source folder path for tracking
        """
        self._ensure_loaded()
        
        # Add timestamp if not present
        if 'analyzed_at' not in metadata:
            metadata['analyzed_at'] = datetime.now().isoformat()
        
        # Add source folder tracking
        if source_folder:
            metadata['source_folder'] = source_folder
            # Track multiple source folders if file exists in multiple locations
            if 'source_folders' not in metadata:
                metadata['source_folders'] = []
            if source_folder not in metadata['source_folders']:
                metadata['source_folders'].append(source_folder)
            
            # Track analyzed folders
            self._analyzed_folders.add(source_folder)
        
        # Remove existing entry if present (by path)
        existing_index = None
        for i, track in enumerate(self.library):
            if track.get('path') == path:
                existing_index = i
                break
        
        if existing_index is not None:
            # Merge source folders if updating existing track
            existing = self.library[existing_index]
            if source_folder and 'source_folders' in existing:
                if 'source_folders' not in metadata:
                    metadata['source_folders'] = existing.get('source_folders', [])
                if source_folder not in metadata['source_folders']:
                    metadata['source_folders'].append(source_folder)
            # Update existing entry
            self.library[existing_index] = metadata
        else:
            # Add new entry
            self.library.append(metadata)
        
        if batch_mode:
            self._pending_updates.append(path)
            # Auto-save after threshold
            if len(self._pending_updates) >= self._save_threshold:
                self.flush_updates()
        else:
            self.save_library()
    
    def flush_updates(self):
        """Save pending batch updates to disk."""
        if self._pending_updates:
            self.save_library()
            self._pending_updates = []
    
    def batch_update_tracks(self, tracks_metadata):
        """Update multiple tracks efficiently.
        
        Args:
            tracks_metadata: List of metadata dicts
        """
        self._ensure_loaded()
        timestamp = datetime.now().isoformat()
        
        # Create path lookup for existing tracks
        existing_paths = {t.get('path'): i for i, t in enumerate(self.library)}
        
        updated_count = 0
        added_count = 0
        
        for metadata in tracks_metadata:
            path = metadata.get('path')
            if not path:
                continue
            
            # Add timestamp
            metadata['analyzed_at'] = timestamp
            
            if path in existing_paths:
                # Update existing
                self.library[existing_paths[path]] = metadata
                updated_count += 1
            else:
                # Add new
                self.library.append(metadata)
                added_count += 1
        
        self.save_library()
        return {"updated": updated_count, "added": added_count, "total": len(self.library)}

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
                        meta['key'] = tags['TKEY'].text[0]
                    
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
                    meta['key'] = audio['key'][0]
                if 'energy' in audio:
                    meta['energy'] = float(audio['energy'][0])
                if 'mood' in audio:
                    meta['mood'] = audio['mood'][0]

            return meta
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            return None

    def query(self, filters):
        """
        Filter library based on criteria.
        filters = {
            "bpm_min": 120, "bpm_max": 130,
            "key": "5A",
            "energy_min": 0.5,
            "genre": "House"
        }
        """
        self._ensure_loaded()
        results = self.library
        
        if 'bpm_min' in filters and filters['bpm_min']:
            results = [t for t in results if t['bpm'] >= float(filters['bpm_min'])]
        if 'bpm_max' in filters and filters['bpm_max']:
            results = [t for t in results if t['bpm'] <= float(filters['bpm_max'])]
            
        if 'energy_min' in filters and filters['energy_min']:
            results = [t for t in results if t['energy'] >= float(filters['energy_min'])]
        if 'energy_max' in filters and filters['energy_max']:
            results = [t for t in results if t['energy'] <= float(filters['energy_max'])]
            
        if 'key' in filters and filters['key']:
            # Exact match for now, could add Camelot logic later
            results = [t for t in results if t['key'] == filters['key']]
            
        if 'genre' in filters and filters['genre']:
            results = [t for t in results if filters['genre'].lower() in t['genre'].lower()]
            
        return results

    def generate_smart_playlist(self, duration_minutes=60, energy_curve=None, start_key=None, mood=None, filters=None):
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
        available_tracks = self.query(filters) if filters else self.library.copy()
        
        # Filter by mood if specified
        if mood:
            # Check how many tracks have mood data
            tracks_with_mood = [t for t in available_tracks if t.get('mood', '').strip()]
            print(f"Mood filter: {len(tracks_with_mood)}/{len(available_tracks)} tracks have mood data")
            
            if len(tracks_with_mood) == 0:
                print(f"WARNING: No tracks have mood data. Please re-analyze your library with 'Force Re-analyze' to populate mood information.")
                return []
            
            available_tracks = [t for t in available_tracks if mood.lower() in t.get('mood', '').lower()]
            print(f"Mood filter: {len(available_tracks)} tracks match mood '{mood}'")
        
        # Filter out tracks without essential data
        available_tracks = [t for t in available_tracks if t['bpm'] > 0 and t['key']]
        
        if not available_tracks:
            return []
        
        # Get or create energy curve
        if energy_curve is None or energy_curve == "gradual_build":
            energy_curve = [(0, 0.3), (0.3, 0.5), (0.7, 0.8), (1.0, 0.9)]
        elif energy_curve == "peak_sustain":
            energy_curve = [(0, 0.4), (0.2, 0.7), (0.8, 0.9), (1.0, 0.8)]
        elif energy_curve == "rollercoaster":
            energy_curve = [(0, 0.5), (0.25, 0.8), (0.5, 0.4), (0.75, 0.9), (1.0, 0.6)]
        elif energy_curve == "chill_down":
            energy_curve = [(0, 0.7), (0.5, 0.5), (1.0, 0.3)]
        
        # Estimate number of tracks (assuming ~4 min per track)
        target_tracks = int(duration_minutes / 4)
        
        playlist = []
        self.recent_tracks = []
        
        # Select starting track
        if start_key:
            start_candidates = [t for t in available_tracks if key_to_camelot(t['key']) == start_key]
            if start_candidates:
                current_track = random.choice(start_candidates)
            else:
                current_track = random.choice(available_tracks)
        else:
            current_track = random.choice(available_tracks)
        
        playlist.append(current_track)
        self.recent_tracks.append(current_track['path'])
        
        # Build playlist
        for i in range(1, target_tracks):
            progress = i / target_tracks
            target_energy = self._interpolate_energy(progress, energy_curve)
            
            next_track = self._select_next_track(
                current_track,
                available_tracks,
                target_energy
            )
            
            if next_track:
                playlist.append(next_track)
                self.recent_tracks.append(next_track['path'])
                current_track = next_track
            else:
                break
        
        return playlist
    
    def generate_smart_playlist_from_tracks(self, tracks, duration_minutes=60, energy_curve=None, start_key=None, mood=None):
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
            tracks_with_mood = [t for t in available_tracks if t.get('mood', '').strip()]
            if len(tracks_with_mood) == 0:
                print(f"WARNING: No tracks have mood data.")
                return []
            available_tracks = [t for t in available_tracks if mood.lower() in t.get('mood', '').lower()]
        
        # Filter out tracks without essential data
        available_tracks = [t for t in available_tracks if t.get('bpm', 0) > 0 and t.get('key')]
        
        if not available_tracks:
            return []
        
        # Get or create energy curve
        if energy_curve is None or energy_curve == "gradual_build":
            energy_curve = [(0, 0.3), (0.3, 0.5), (0.7, 0.8), (1.0, 0.9)]
        elif energy_curve == "peak_sustain":
            energy_curve = [(0, 0.4), (0.2, 0.7), (0.8, 0.9), (1.0, 0.8)]
        elif energy_curve == "rollercoaster":
            energy_curve = [(0, 0.5), (0.25, 0.8), (0.5, 0.4), (0.75, 0.9), (1.0, 0.6)]
        elif energy_curve == "chill_down":
            energy_curve = [(0, 0.7), (0.5, 0.5), (1.0, 0.3)]
        
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
        
        # Build playlist
        for i in range(1, target_tracks):
            progress = i / target_tracks
            target_energy = self._interpolate_energy(progress, energy_curve)
            
            next_track = self._select_next_track(
                current_track,
                available_tracks,
                target_energy
            )
            
            if next_track:
                playlist.append(next_track)
                self.recent_tracks.append(next_track.get('path', ''))
                current_track = next_track
            else:
                break
        
        return playlist

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

    def _select_next_track(self, current_track, available_tracks, target_energy):
        """Select the best next track based on multiple criteria."""
        current_key = key_to_camelot(current_track.get('key', ''))
        current_bpm = current_track.get('bpm', 0)
        
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
            
            score = 0
            
            # Key compatibility (0-10)
            key_score = get_transition_score(current_key, track_key)
            score += key_score
            
            # Energy match (0-10)
            if track.get('energy', 0) > 0:
                energy_diff = abs(track.get('energy', 0) - target_energy)
                if energy_diff <= 0.1:
                    score += 10
                elif energy_diff <= 0.2:
                    score += 5
                elif energy_diff <= 0.3:
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
                if current_track.get('genre', '').lower() == track.get('genre', '').lower():
                    score += 3
            
            candidates.append((track, score))
        
        if not candidates:
            return None
        
        # Sort by score and return best
        candidates.sort(key=lambda x: x[1], reverse=True)
        
        # Add some randomness - pick from top 3
        top_candidates = candidates[:min(3, len(candidates))]
        return random.choice(top_candidates)[0]

    def export_m3u(self, tracks, filename=None):
        if filename is None:
            # Rekordbox Playlists folder on macOS
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(rekordbox_playlists, f"SkullKrush_{timestamp}.m3u")
        
        with open(filename, 'w') as f:
            f.write("#EXTM3U\n")
            for track in tracks:
                duration = -1 # Unknown duration for now
                f.write(f"#EXTINF:{duration},{track['artist']} - {track['title']}\n")
                f.write(f"{track['path']}\n")
        return os.path.abspath(filename)

    def export_rekordbox(self, tracks, filename=None):
        if filename is None:
            # Rekordbox Playlists folder on macOS
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(rekordbox_playlists, f"SkullKrush_{timestamp}.xml")
        
        root = ET.Element("DJ_PLAYLISTS", version="1.0.0")
        collection = ET.SubElement(root, "COLLECTION", Entries=str(len(tracks)))
        
        for track in tracks:
            # Rekordbox needs URL encoded paths: file://localhost/Users/...
            location = "file://localhost" + track['path'].replace(" ", "%20")
            
            ET.SubElement(collection, "TRACK", 
                TrackID=str(abs(hash(track['path']))), # Simple hash ID
                Name=track['title'],
                Artist=track['artist'],
                Album=track['album'],
                Genre=track['genre'],
                Kind="MP3 File", # Simplified
                Size="0",
                TotalTime="0",
                Location=location,
                AverageBpm=str(track['bpm']),
                Tonality=track['key']
            )
            
        xmlstr = minidom.parseString(ET.tostring(root)).toprettyxml(indent="  ")
        with open(filename, "w") as f:
            f.write(xmlstr)
        return os.path.abspath(filename)
    
    def get_statistics(self):
        """Get library statistics and health metrics."""
        self._ensure_loaded()
        
        total_tracks = len(self.library)
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
        
        analyzed_count = 0
        missing_files = 0
        incomplete_metadata = 0
        
        coverage = {
            "bpm": 0,
            "key": 0,
            "energy": 0,
            "genre": 0,
            "mood": 0
        }
        
        for track in self.library:
            path = track.get('path', '')
            
            # Check if file exists
            if not os.path.exists(path):
                missing_files += 1
                continue
            
            # Check if analyzed
            if track.get('analyzed_at'):
                analyzed_count += 1
            
            # Check metadata completeness
            has_all = True
            if track.get('bpm', 0) > 0:
                coverage['bpm'] += 1
            else:
                has_all = False
            
            if track.get('key', '').strip():
                coverage['key'] += 1
            else:
                has_all = False
            
            if track.get('energy', 0) > 0:
                coverage['energy'] += 1
            else:
                has_all = False
            
            if track.get('genre', '').strip():
                coverage['genre'] += 1
            
            if track.get('mood', '').strip():
                coverage['mood'] += 1
            
            if not has_all:
                incomplete_metadata += 1
        
        # Convert to percentages
        for key in coverage:
            coverage[key] = round((coverage[key] / total_tracks) * 100, 1)
        
        # Calculate health score (0-100)
        health_score = 0
        if total_tracks > 0:
            file_health = ((total_tracks - missing_files) / total_tracks) * 40
            metadata_health = ((total_tracks - incomplete_metadata) / total_tracks) * 40
            analysis_health = (analyzed_count / total_tracks) * 20
            health_score = round(file_health + metadata_health + analysis_health, 1)
        
        return {
            "total_tracks": total_tracks,
            "analyzed_tracks": analyzed_count,
            "missing_files": missing_files,
            "incomplete_metadata": incomplete_metadata,
            "coverage": coverage,
            "health_score": health_score
        }
    
    def check_health(self):
        """Check library health and return detailed report."""
        self._ensure_loaded()
        
        missing_files = []
        incomplete_tracks = []
        duplicate_paths = {}
        
        # Track paths for duplicates
        path_counts = {}
        for i, track in enumerate(self.library):
            path = track.get('path', '')
            if path in path_counts:
                path_counts[path].append(i)
            else:
                path_counts[path] = [i]
        
        # Find duplicates
        for path, indices in path_counts.items():
            if len(indices) > 1:
                duplicate_paths[path] = indices
        
        # Check each track
        for i, track in enumerate(self.library):
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
        
        orphans = []
        valid_tracks = []
        
        for track in self.library:
            path = track.get('path', '')
            if not os.path.exists(path):
                orphans.append(track)
            else:
                valid_tracks.append(track)
        
        if not dry_run:
            self.library = valid_tracks
            self.save_library()
        
        return {
            "removed_count": len(orphans),
            "remaining_count": len(valid_tracks),
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
        
        seen_paths = {}
        duplicates = []
        unique_tracks = []
        
        for track in self.library:
            path = track.get('path', '')
            if path in seen_paths:
                duplicates.append(track)
            else:
                seen_paths[path] = True
                unique_tracks.append(track)
        
        if not dry_run:
            self.library = unique_tracks
            self.save_library()
        
        return {
            "duplicate_count": len(duplicates),
            "unique_count": len(unique_tracks),
            "duplicates": duplicates
        }
    
    def get_folder_statistics(self):
        """Get statistics organized by source folders."""
        self._ensure_loaded()
        
        folder_stats = {}
        
        for track in self.library:
            folders = []
            if 'source_folder' in track:
                folders.append(track['source_folder'])
            if 'source_folders' in track:
                folders.extend(track['source_folders'])
            
            for folder in folders:
                if folder not in folder_stats:
                    folder_stats[folder] = {
                        'track_count': 0,
                        'analyzed_count': 0,
                        'last_analyzed': None,
                        'tracks': []
                    }
                
                folder_stats[folder]['track_count'] += 1
                folder_stats[folder]['tracks'].append(track)
                
                if track.get('analyzed_at'):
                    folder_stats[folder]['analyzed_count'] += 1
                    analyzed_at = track.get('analyzed_at')
                    if not folder_stats[folder]['last_analyzed'] or analyzed_at > folder_stats[folder]['last_analyzed']:
                        folder_stats[folder]['last_analyzed'] = analyzed_at
        
        return folder_stats
    
    def get_analyzed_folders(self):
        """Get list of folders that have been analyzed."""
        self._ensure_loaded()
        return list(self._analyzed_folders)
    
    def get_tracks_by_folder(self, folder_path):
        """Get all tracks from a specific folder."""
        self._ensure_loaded()
        return [
            track for track in self.library
            if track.get('source_folder') == folder_path or 
               folder_path in track.get('source_folders', [])
        ]
    
    def find_content_duplicates(self, dry_run=True):
        """Find duplicate tracks based on content (title + artist + BPM) rather than just path.
        
        Args:
            dry_run: If True, return list without removing
            
        Returns:
            Dict with content duplicate info
        """
        self._ensure_loaded()
        
        # Group tracks by content signature (title + artist + bpm)
        content_groups = {}
        
        for track in self.library:
            title = (track.get('title') or '').lower().strip()
            artist = (track.get('artist') or '').lower().strip()
            bpm = track.get('bpm', 0)
            
            # Create content signature
            signature = f"{artist}|{title}|{bpm}"
            
            if signature not in content_groups:
                content_groups[signature] = []
            content_groups[signature].append(track)
        
        # Find duplicates (groups with more than one track)
        duplicates = []
        unique_tracks = []
        
        for signature, tracks in content_groups.items():
            if len(tracks) > 1:
                # Keep the first one, mark others as duplicates
                unique_tracks.append(tracks[0])
                duplicates.extend(tracks[1:])
            else:
                unique_tracks.append(tracks[0])
        
        if not dry_run:
            self.library = unique_tracks
            self.save_library()
        
        return {
            "duplicate_count": len(duplicates),
            "unique_count": len(unique_tracks),
            "duplicate_groups": [
                {
                    "signature": sig,
                    "count": len(tracks),
                    "tracks": tracks
                }
                for sig, tracks in content_groups.items()
                if len(tracks) > 1
            ]
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
        
        # Find track in library
        track = None
        for t in self.library:
            if t.get('path') == path:
                track = t
                break
        
        if not track:
            return None
        
        # Extract metadata from file tags
        updated_metadata = self._extract_metadata(path)
        if not updated_metadata:
            return None
        
        # Merge with existing metadata
        updated_metadata['analyzed_at'] = track.get('analyzed_at', datetime.now().isoformat())
        updated_metadata['source_folder'] = track.get('source_folder')
        updated_metadata['source_folders'] = track.get('source_folders', [])
        
        # Update library
        self.update_track(path, updated_metadata)
        
        return updated_metadata
    
    def refresh_library_metadata(self, folder_path=None):
        """Refresh metadata for all tracks (or tracks in a folder) without re-analysis.
        
        Args:
            folder_path: Optional folder path to limit refresh
            
        Returns:
            Dict with refresh results
        """
        self._ensure_loaded()
        
        tracks_to_refresh = self.library
        if folder_path:
            tracks_to_refresh = self.get_tracks_by_folder(folder_path)
        
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


