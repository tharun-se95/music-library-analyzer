#!/usr/bin/env python3
"""
Migration script to convert JSON-based storage to SQLite database.
Migrates library.json, analyzed_folders.json, and playlist JSON files.
"""

import os
import json
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path


DB_FILE = "music_library.db"
LIBRARY_FILE = "library.json"
ANALYZED_FOLDERS_FILE = "analyzed_folders.json"
PLAYLISTS_DIR = "playlists"


def create_database(db_path=DB_FILE):
    """Initialize SQLite database with schema."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Enable WAL mode for better concurrency
    cursor.execute("PRAGMA journal_mode = WAL")
    
    # Create tracks table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            bpm INTEGER,
            key TEXT,
            key_camelot TEXT,
            energy INTEGER,
            duration REAL,
            genre TEXT,
            mood TEXT,
            popularity INTEGER,
            danceability REAL,
            valence REAL,
            acousticness REAL,
            analyzed_at TEXT,
            source TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Create track_folders table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS track_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            folder_path TEXT NOT NULL,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
            UNIQUE(track_id, folder_path)
        )
    """)
    
    # Create analyzed_folders table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analyzed_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT UNIQUE NOT NULL,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_analyzed_at TEXT,
            track_count INTEGER DEFAULT 0
        )
    """)
    
    # Create playlists table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            track_count INTEGER DEFAULT 0
        )
    """)
    
    # Create playlist_tracks table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER,
            added_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
            UNIQUE(playlist_id, track_id, position)
        )
    """)
    
    # Create track_genres table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS track_genres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            genre TEXT NOT NULL,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
            UNIQUE(track_id, genre)
        )
    """)
    
    # Create indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path)",
        "CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm)",
        "CREATE INDEX IF NOT EXISTS idx_tracks_key ON tracks(key)",
        "CREATE INDEX IF NOT EXISTS idx_tracks_energy ON tracks(energy)",
        "CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)",
        "CREATE INDEX IF NOT EXISTS idx_tracks_analyzed_at ON tracks(analyzed_at)",
        "CREATE INDEX IF NOT EXISTS idx_track_folders_track ON track_folders(track_id)",
        "CREATE INDEX IF NOT EXISTS idx_track_folders_folder ON track_folders(folder_path)",
        "CREATE INDEX IF NOT EXISTS idx_analyzed_folders_path ON analyzed_folders(folder_path)",
        "CREATE INDEX IF NOT EXISTS idx_playlists_name ON playlists(name)",
        "CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id)",
        "CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id)",
        "CREATE INDEX IF NOT EXISTS idx_track_genres_track ON track_genres(track_id)",
        "CREATE INDEX IF NOT EXISTS idx_track_genres_genre ON track_genres(genre)",
    ]
    
    for index_sql in indexes:
        cursor.execute(index_sql)
    
    conn.commit()
    conn.close()
    print(f"✓ Database schema created: {db_path}")


def migrate_library_json(db_path=DB_FILE, library_file=LIBRARY_FILE):
    """Migrate library.json to tracks and track_folders tables."""
    if not os.path.exists(library_file):
        print(f"⚠ {library_file} not found, skipping library migration")
        return 0
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        with open(library_file, 'r') as f:
            tracks = json.load(f)
        
        if not isinstance(tracks, list):
            print(f"⚠ Invalid format in {library_file}, expected list")
            return 0
        
        migrated_count = 0
        folder_count = 0
        
        for track in tracks:
            if not track.get('path'):
                continue
            
            # Insert or replace track
            cursor.execute("""
                INSERT OR REPLACE INTO tracks (
                    path, filename, title, artist, album,
                    bpm, key, key_camelot, energy, duration,
                    genre, mood, popularity, danceability,
                    valence, acousticness, analyzed_at, source,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                track.get('path'),
                track.get('filename', os.path.basename(track.get('path', ''))),
                track.get('title'),
                track.get('artist'),
                track.get('album'),
                track.get('bpm'),
                track.get('key'),
                track.get('key_camelot'),
                track.get('energy'),
                track.get('duration'),
                track.get('genre'),
                track.get('mood'),
                track.get('popularity'),
                track.get('danceability'),
                track.get('valence'),
                track.get('acousticness'),
                track.get('analyzed_at'),
                track.get('source'),
                datetime.now().isoformat()
            ))
            
            track_id = cursor.lastrowid
            
            # Handle source folders
            folders = []
            if track.get('source_folder'):
                folders.append(track['source_folder'])
            if track.get('source_folders'):
                folders.extend(track['source_folders'])
            
            # Remove duplicates
            folders = list(set(folders))
            
            for folder_path in folders:
                cursor.execute("""
                    INSERT OR IGNORE INTO track_folders (track_id, folder_path)
                    VALUES (?, ?)
                """, (track_id, folder_path))
                folder_count += 1
            
            # Handle genres (if genres is a list)
            genres = track.get('genres', [])
            if isinstance(genres, str):
                genres = [genres]
            elif not isinstance(genres, list):
                genres = []
            
            for genre in genres:
                if genre:
                    cursor.execute("""
                        INSERT OR IGNORE INTO track_genres (track_id, genre)
                        VALUES (?, ?)
                    """, (track_id, genre))
            
            migrated_count += 1
        
        conn.commit()
        print(f"✓ Migrated {migrated_count} tracks and {folder_count} folder associations")
        return migrated_count
        
    except Exception as e:
        conn.rollback()
        print(f"✗ Error migrating library.json: {e}")
        raise
    finally:
        conn.close()


def migrate_analyzed_folders(db_path=DB_FILE, folders_file=ANALYZED_FOLDERS_FILE):
    """Migrate analyzed_folders.json to analyzed_folders table."""
    if not os.path.exists(folders_file):
        print(f"⚠ {folders_file} not found, skipping analyzed folders migration")
        return 0
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        with open(folders_file, 'r') as f:
            folders = json.load(f)
        
        if not isinstance(folders, list):
            print(f"⚠ Invalid format in {folders_file}, expected list")
            return 0
        
        migrated_count = 0
        
        for folder_path in folders:
            if not folder_path:
                continue
            
            # Count tracks in this folder
            cursor.execute("""
                SELECT COUNT(*) FROM track_folders WHERE folder_path = ?
            """, (folder_path,))
            track_count = cursor.fetchone()[0]
            
            # Get last analyzed timestamp from tracks
            cursor.execute("""
                SELECT MAX(t.analyzed_at) FROM tracks t
                JOIN track_folders tf ON t.id = tf.track_id
                WHERE tf.folder_path = ?
            """, (folder_path,))
            result = cursor.fetchone()
            last_analyzed_at = result[0] if result[0] else None
            
            cursor.execute("""
                INSERT OR REPLACE INTO analyzed_folders (
                    folder_path, imported_at, last_analyzed_at, track_count
                ) VALUES (?, ?, ?, ?)
            """, (
                folder_path,
                datetime.now().isoformat(),
                last_analyzed_at,
                track_count
            ))
            
            migrated_count += 1
        
        conn.commit()
        print(f"✓ Migrated {migrated_count} analyzed folders")
        return migrated_count
        
    except Exception as e:
        conn.rollback()
        print(f"✗ Error migrating analyzed_folders.json: {e}")
        raise
    finally:
        conn.close()


def migrate_playlists(db_path=DB_FILE, playlists_dir=PLAYLISTS_DIR):
    """Migrate playlist JSON files to playlists and playlist_tracks tables."""
    if not os.path.exists(playlists_dir):
        print(f"⚠ {playlists_dir} directory not found, skipping playlist migration")
        return 0
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        playlist_files = [f for f in os.listdir(playlists_dir) if f.endswith('.json')]
        
        if not playlist_files:
            print(f"⚠ No playlist JSON files found in {playlists_dir}")
            return 0
        
        migrated_count = 0
        track_associations = 0
        
        for filename in playlist_files:
            playlist_path = os.path.join(playlists_dir, filename)
            
            try:
                with open(playlist_path, 'r') as f:
                    playlist_data = json.load(f)
                
                playlist_name = playlist_data.get('name', filename.replace('.json', ''))
                tracks = playlist_data.get('tracks', [])
                
                if not playlist_name:
                    continue
                
                # Insert playlist
                cursor.execute("""
                    INSERT OR REPLACE INTO playlists (
                        name, created_at, updated_at, track_count
                    ) VALUES (?, ?, ?, ?)
                """, (
                    playlist_name,
                    playlist_data.get('created', datetime.now().isoformat()),
                    datetime.now().isoformat(),
                    len(tracks)
                ))
                
                playlist_id = cursor.lastrowid
                
                # Clear existing track associations
                cursor.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
                
                # Insert track associations
                for position, track_data in enumerate(tracks):
                    track_path = track_data.get('path') if isinstance(track_data, dict) else track_data
                    
                    if not track_path:
                        continue
                    
                    # Find track_id by path
                    cursor.execute("SELECT id FROM tracks WHERE path = ?", (track_path,))
                    result = cursor.fetchone()
                    
                    if result:
                        track_id = result[0]
                        cursor.execute("""
                            INSERT OR IGNORE INTO playlist_tracks (
                                playlist_id, track_id, position, added_at
                            ) VALUES (?, ?, ?, ?)
                        """, (
                            playlist_id,
                            track_id,
                            position,
                            datetime.now().isoformat()
                        ))
                        track_associations += 1
                
                migrated_count += 1
                
            except Exception as e:
                print(f"⚠ Error migrating playlist {filename}: {e}")
                continue
        
        conn.commit()
        print(f"✓ Migrated {migrated_count} playlists with {track_associations} track associations")
        return migrated_count
        
    except Exception as e:
        conn.rollback()
        print(f"✗ Error migrating playlists: {e}")
        raise
    finally:
        conn.close()


def validate_migration(db_path=DB_FILE, library_file=LIBRARY_FILE):
    """Validate that migration was successful."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Count tracks in database
        cursor.execute("SELECT COUNT(*) FROM tracks")
        db_track_count = cursor.fetchone()[0]
        
        # Count tracks in JSON (if exists)
        json_track_count = 0
        if os.path.exists(library_file):
            with open(library_file, 'r') as f:
                tracks = json.load(f)
                if isinstance(tracks, list):
                    json_track_count = len([t for t in tracks if t.get('path')])
        
        # Count analyzed folders
        cursor.execute("SELECT COUNT(*) FROM analyzed_folders")
        db_folder_count = cursor.fetchone()[0]
        
        # Count playlists
        cursor.execute("SELECT COUNT(*) FROM playlists")
        db_playlist_count = cursor.fetchone()[0]
        
        print("\n=== Migration Validation ===")
        print(f"Tracks in DB: {db_track_count} (JSON had: {json_track_count})")
        print(f"Analyzed folders in DB: {db_folder_count}")
        print(f"Playlists in DB: {db_playlist_count}")
        
        if json_track_count > 0 and db_track_count != json_track_count:
            print(f"⚠ Warning: Track count mismatch!")
            return False
        
        print("✓ Migration validation passed")
        return True
        
    except Exception as e:
        print(f"✗ Validation error: {e}")
        return False
    finally:
        conn.close()


def backup_files():
    """Create backup copies of JSON files before migration."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    backups = []
    
    if os.path.exists(LIBRARY_FILE):
        backup_path = f"{LIBRARY_FILE}.backup_{timestamp}"
        shutil.copy2(LIBRARY_FILE, backup_path)
        backups.append(backup_path)
        print(f"✓ Backed up {LIBRARY_FILE} → {backup_path}")
    
    if os.path.exists(ANALYZED_FOLDERS_FILE):
        backup_path = f"{ANALYZED_FOLDERS_FILE}.backup_{timestamp}"
        shutil.copy2(ANALYZED_FOLDERS_FILE, backup_path)
        backups.append(backup_path)
        print(f"✓ Backed up {ANALYZED_FOLDERS_FILE} → {backup_path}")
    
    return backups


def rollback_migration(db_path=DB_FILE):
    """Remove database file to rollback migration."""
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"✓ Removed database file: {db_path}")
        print("  Restore JSON files from .backup_* files if needed")
    else:
        print(f"⚠ Database file not found: {db_path}")


def main():
    """Main migration function."""
    print("=" * 60)
    print("SQLite Migration Script")
    print("=" * 60)
    
    # Check if database already exists
    if os.path.exists(DB_FILE):
        response = input(f"\n⚠ {DB_FILE} already exists. Overwrite? (y/N): ")
        if response.lower() != 'y':
            print("Migration cancelled.")
            return
        os.remove(DB_FILE)
        print(f"✓ Removed existing {DB_FILE}")
    
    # Create backups
    print("\n--- Creating backups ---")
    backups = backup_files()
    
    try:
        # Create database schema
        print("\n--- Creating database schema ---")
        create_database()
        
        # Migrate library.json
        print("\n--- Migrating library.json ---")
        migrate_library_json()
        
        # Migrate analyzed_folders.json
        print("\n--- Migrating analyzed_folders.json ---")
        migrate_analyzed_folders()
        
        # Migrate playlists
        print("\n--- Migrating playlists ---")
        migrate_playlists()
        
        # Validate migration
        print("\n--- Validating migration ---")
        if validate_migration():
            print("\n" + "=" * 60)
            print("✓ Migration completed successfully!")
            print(f"✓ Database created: {DB_FILE}")
            print(f"✓ Backups created: {len(backups)} file(s)")
            print("=" * 60)
        else:
            print("\n⚠ Migration completed with warnings. Please review.")
            
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        print("\nRolling back...")
        rollback_migration()
        print("\nYou can restore JSON files from backup files if needed.")
        raise


if __name__ == "__main__":
    main()

