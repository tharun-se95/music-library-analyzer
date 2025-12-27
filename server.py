import os
import asyncio
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import mutagen
import uvicorn
import json

# Import our existing logic
# Import our existing logic
from analyzer import analyze_track
from metadata import MetadataFetcher
from tagger import tag_file
from library_manager import LibraryManager
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from fastapi.responses import RedirectResponse

# Spotify OAuth Settings
SPOTIFY_SCOPE = "user-library-read playlist-read-private playlist-read-collaborative user-read-email"
sp_oauth = None


load_dotenv()

app = FastAPI()
library_manager = LibraryManager()

# Add middleware to disable caching for static files in development
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # Add no-cache headers for static files in development
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Store active websockets
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.scan_cancelled = False
        self.current_scan_task = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        if not self.active_connections:
            print(f"[WEBSOCKET] No active connections to broadcast message: {message.get('type', 'unknown')}")
        else:
            print(f"[WEBSOCKET] Broadcasting {message.get('type', 'unknown')} to {len(self.active_connections)} connection(s)")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"[WEBSOCKET] Error sending message to connection: {e}")
                # Remove dead connections
                try:
                    self.active_connections.remove(connection)
                except ValueError:
                    pass
    
    def cancel_scan(self):
        """Cancel the current scan"""
        self.scan_cancelled = True
        if self.current_scan_task:
            self.current_scan_task.cancel()
    
    def reset_cancellation(self):
        """Reset cancellation flag for new scan"""
        self.scan_cancelled = False

manager = ConnectionManager()

class ScanRequest(BaseModel):
    directory: str
    force: bool = False


class BrowseRequest(BaseModel):
    path: str | None = None

class LibraryQuery(BaseModel):
    bpm_min: float | None = None
    bpm_max: float | None = None
    energy_min: float | None = None
    energy_max: float | None = None
    key: str | None = None
    genre: str | None = None

class AnalyzeFileRequest(BaseModel):
    path: str
    force: bool = True

@app.get("/")
async def get():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())

@app.post("/analyze_file")
async def analyze_single_file(request: AnalyzeFileRequest):
    """Analyze a single file and return results."""
    try:
        path = request.path
        
        # 1. Analyze
        analysis_result = analyze_track(path)
        if not analysis_result:
            return {"error": "Analysis failed", "path": path}

        # 2. Metadata
        client_id = os.getenv("SPOTIPY_CLIENT_ID")
        client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
        fetcher = MetadataFetcher(client_id, client_secret)
        
        artist, title = get_artist_title(path)
        metadata_result = {}
        if artist and title:
            # Pass the analyzed key to metadata fetcher for mood enhancement
            analyzed_key = analysis_result.get('key')
            analyzed_energy = analysis_result.get('energy')
            metadata_result = fetcher.get_track_info(artist, title, key=analyzed_key, audio_energy=analyzed_energy)
        
        # 3. Tag
        final_tags = {
            "path": path,
            "filename": os.path.basename(path),
            "artist": artist or "Unknown Artist",
            "title": title or os.path.basename(path),
            **analysis_result
        }
        if metadata_result:
            final_tags.update(metadata_result)
        
        tag_file(path, final_tags)
        
        # Update library cache
        # Extract source folder from path
        source_folder = os.path.dirname(path) if path else None
        library_manager.update_track(path, final_tags, source_folder=source_folder)
        
        return {"success": True, "path": path, "tags": final_tags}
    except Exception as e:
        return {"error": str(e), "path": request.path}

class BatchAnalyzeRequest(BaseModel):
    paths: list[str]
    force: bool = True

@app.post("/analyze_files_batch")
async def analyze_files_batch(request: BatchAnalyzeRequest):
    """Analyze multiple files and return results."""
    results = []
    
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    fetcher = MetadataFetcher(client_id, client_secret)
    
    for path in request.paths:
        try:
            # 1. Analyze
            analysis_result = analyze_track(path)
            if not analysis_result:
                results.append({"success": False, "path": path, "error": "Analysis failed"})
                continue

            # 2. Metadata
            artist, title = get_artist_title(path)
            metadata_result = {}
            if artist and title:
                analyzed_key = analysis_result.get('key')
                analyzed_energy = analysis_result.get('energy')
                metadata_result = fetcher.get_track_info(artist, title, key=analyzed_key, audio_energy=analyzed_energy)
            
            # 3. Tag
            final_tags = {
                "path": path,
                "filename": os.path.basename(path),
                "artist": artist or "Unknown Artist",
                "title": title or os.path.basename(path),
                **analysis_result
            }
            if metadata_result:
                final_tags.update(metadata_result)
            
            tag_file(path, final_tags)
            
            # Update library cache
            source_folder = os.path.dirname(path) if path else None
            library_manager.update_track(path, final_tags, source_folder=source_folder)
            
            results.append({"success": True, "path": path, "tags": final_tags})
        except Exception as e:
            results.append({"success": False, "path": path, "error": str(e)})
    
    return {"success": True, "results": results}

class OpenFolderRequest(BaseModel):
    path: str

@app.post("/open_folder")
async def open_folder(request: OpenFolderRequest):
    """Open folder in system file manager."""
    import platform
    import subprocess
    
    try:
        path = request.path
        if not os.path.exists(path):
            return {"success": False, "error": "Path does not exist"}
        
        system = platform.system()
        if system == "Darwin":  # macOS
            subprocess.Popen(["open", path])
        elif system == "Windows":
            subprocess.Popen(["explorer", path])
        else:  # Linux
            subprocess.Popen(["xdg-open", path])
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/browse")
async def browse_directory(request: BrowseRequest):
    path = request.path
    if not path:
        path = os.path.expanduser("~")
    
    if not os.path.exists(path):
        return {"error": "Path does not exist", "current_path": path, "items": []}

    items = []
    try:
        # Add parent directory option if not at root
        parent = os.path.dirname(path)
        if parent and parent != path:
             items.append({"name": "..", "type": "directory", "path": parent})

        with os.scandir(path) as it:
            for entry in it:
                if entry.name.startswith('.'):
                    continue
                
                item_type = "file"
                if entry.is_dir():
                    item_type = "directory"
                
                items.append({
                    "name": entry.name,
                    "type": item_type,
                    "path": entry.path
                })
        
        # Sort: Directories first, then files
        items.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))
        
    except PermissionError:
        return {"error": "Permission denied", "current_path": path, "items": []}
    except Exception as e:
        return {"error": str(e), "current_path": path, "items": []}

    return {
        "current_path": path,
        "parent_path": os.path.dirname(path),
        "items": items
    }

@app.post("/scan")
async def start_scan(request: ScanRequest):
    # Validate directory before starting
    if not request.directory or not request.directory.strip():
        return {"status": "error", "message": "Directory path is required"}
    
    # Reset cancellation flag for new scan
    manager.reset_cancellation()
    
    # Start scanning in background
    # Store task reference to avoid garbage collection issues
    task = asyncio.create_task(run_scan(request.directory, request.force))
    manager.current_scan_task = task
    
    # Add exception handler to task
    def handle_task_exception(task):
        try:
            task.result()  # This will raise if task failed
        except asyncio.CancelledError:
            print("Scan was cancelled")
        except Exception as e:
            print(f"Task exception: {e}")
            import traceback
            traceback.print_exc()
    
    task.add_done_callback(handle_task_exception)
    
    return {"status": "started", "message": f"Analysis started for {request.directory}"}

@app.post("/stop")
async def stop_scan():
    """Stop the current analysis scan"""
    manager.cancel_scan()
    await manager.broadcast({
        "type": "cancelled",
        "message": "Analysis cancelled by user"
    })
    return {"status": "stopped", "message": "Analysis stopped"}

@app.post("/library/scan")
async def scan_library(request: ScanRequest):
    count = library_manager.scan_directory(request.directory)
    return {"count": count, "message": "Library scanned successfully"}

@app.post("/library/query")
async def query_library(query: LibraryQuery):
    # Convert pydantic model to dict, removing None values
    filters = {k: v for k, v in query.dict().items() if v is not None}
    results = library_manager.query(filters)
    return {"count": len(results), "tracks": results}

class ExportRequest(BaseModel):
    tracks: list | None = None
    name: str | None = None  # Optional playlist name for filename
    bpm_min: int | None = None
    bpm_max: int | None = None
    energy_min: float | None = None
    energy_max: float | None = None
    key: str | None = None
    genre: str | None = None

@app.post("/library/export/m3u")
async def export_m3u(request: ExportRequest):
    try:
        if request.tracks:
            # Export provided tracks directly
            tracks = request.tracks
        else:
            # Use filters to query library
            filters = {k: v for k, v in request.dict().items() if v is not None and k not in ['tracks', 'name']}
            tracks = library_manager.query(filters)
        
        if not tracks:
            return {"success": False, "error": "No tracks to export"}
        
        # Generate filename if name is provided
        filename = None
        if request.name:
            import os
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            # Sanitize name for filename
            safe_name = "".join(c for c in request.name if c.isalnum() or c in (' ', '-', '_')).strip()
            safe_name = safe_name.replace(' ', '_')
            filename = os.path.join(rekordbox_playlists, f"{safe_name}.m3u")
        
        path = library_manager.export_m3u(tracks, filename)
        return {
            "success": True, 
            "message": "M3U playlist exported. Import in Rekordbox: File > Import > Import Playlist", 
            "path": path
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/library/export/rekordbox")
async def export_rekordbox(request: ExportRequest):
    try:
        if request.tracks:
            # Export provided tracks directly
            tracks = request.tracks
        else:
            # Use filters to query library
            filters = {k: v for k, v in request.dict().items() if v is not None and k not in ['tracks', 'name']}
            tracks = library_manager.query(filters)
        
        if not tracks:
            return {"success": False, "error": "No tracks to export"}
        
        # Generate filename if name is provided
        filename = None
        playlist_name = request.name or "Exported Playlist"
        if request.name:
            import os
            rekordbox_playlists = os.path.expanduser("~/Music/Pioneer/Playlists")
            os.makedirs(rekordbox_playlists, exist_ok=True)
            # Sanitize name for filename
            safe_name = "".join(c for c in request.name if c.isalnum() or c in (' ', '-', '_')).strip()
            safe_name = safe_name.replace(' ', '_')
            filename = os.path.join(rekordbox_playlists, f"{safe_name}.xml")
        
        path = library_manager.export_rekordbox(tracks, filename, playlist_name)
        return {
            "success": True, 
            "message": "Rekordbox XML exported. Note: For playlist import, use M3U format (File > Import > Import Playlist in Rekordbox)", 
            "path": path
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

class SmartPlaylistRequest(BaseModel):
    duration: int = 60  # minutes
    energy_curve: str = "gradual_build"  # preset name
    start_key: str | None = None
    mood: str | None = None  # NEW: mood filter
    filters: dict | None = None
    tracks: list | None = None  # Optional: use provided tracks instead of querying
    bpm_min: int | None = None
    bpm_max: int | None = None
    genres: list[str] | None = None
    key_strictness: str = "moderate"  # strict, moderate, loose
    avoid_artist_repeats: bool = True
    track_duration_min: float | None = None
    track_duration_max: float | None = None

@app.post("/library/generate_smart_playlist")
async def generate_smart_playlist(request: SmartPlaylistRequest):
    """Generate an intelligent playlist using harmonic mixing and energy curve."""
    try:
        # If tracks are provided, use them directly; otherwise use filters
        if request.tracks:
            # Use provided tracks directly
            playlist = library_manager.generate_smart_playlist_from_tracks(
                tracks=request.tracks,
                duration_minutes=request.duration,
                energy_curve=request.energy_curve,
                start_key=request.start_key,
                mood=request.mood,
                key_strictness=request.key_strictness,
                avoid_artist_repeats=request.avoid_artist_repeats
            )
        else:
            # Build filters dict with all options
            filters = request.filters or {}
            if request.bpm_min is not None:
                filters['bpm_min'] = request.bpm_min
            if request.bpm_max is not None:
                filters['bpm_max'] = request.bpm_max
            if request.genres:
                filters['genres'] = request.genres
            if request.track_duration_min is not None:
                filters['duration_min'] = request.track_duration_min
            if request.track_duration_max is not None:
                filters['duration_max'] = request.track_duration_max
            
            # Use filters to query library
            playlist = library_manager.generate_smart_playlist(
                duration_minutes=request.duration,
                energy_curve=request.energy_curve,
                start_key=request.start_key,
                mood=request.mood,
                filters=filters if filters else None,
                key_strictness=request.key_strictness,
                avoid_artist_repeats=request.avoid_artist_repeats
            )
        
        return {
            "success": True,
            "count": len(playlist),
            "tracks": playlist,
            "message": f"Generated {len(playlist)}-track playlist"
        }
    except Exception as e:
        return {"success": False, "error": str(e), "tracks": []}

class SavePlaylistRequest(BaseModel):
    name: str
    tracks: list

@app.post("/library/save_playlist")
async def save_playlist(request: SavePlaylistRequest):
    """Save a playlist to disk."""
    try:
        # Debug: Log what we're receiving
        print(f"[SAVE] Received playlist save request:")
        print(f"  Name: {request.name}")
        print(f"  Tracks count: {len(request.tracks) if request.tracks else 0}")
        print(f"  Tracks type: {type(request.tracks)}")
        if request.tracks and len(request.tracks) > 0:
            print(f"  First track keys: {list(request.tracks[0].keys()) if isinstance(request.tracks[0], dict) else 'Not a dict'}")
        
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        os.makedirs(playlists_dir, exist_ok=True)
        
        playlist_file = os.path.join(playlists_dir, f"{request.name.replace('/', '_')}.json")
        
        # Ensure tracks is a list
        tracks_list = request.tracks if isinstance(request.tracks, list) else []
        
        playlist_data = {
            "name": request.name,
            "tracks": tracks_list,
            "created": __import__('datetime').datetime.now().isoformat(),
            "track_count": len(tracks_list)
        }
        
        print(f"[SAVE] Saving playlist with {len(tracks_list)} tracks to {playlist_file}")
        
        with open(playlist_file, 'w') as f:
            json.dump(playlist_data, f, indent=2)
        
        return {"success": True, "message": f"Playlist '{request.name}' saved with {len(tracks_list)} tracks"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.get("/library/playlists")
async def list_playlists():
    """List all saved playlists."""
    try:
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        if not os.path.exists(playlists_dir):
            return {"playlists": []}
        
        playlists = []
        for filename in os.listdir(playlists_dir):
            if filename.endswith('.json'):
                playlist_path = os.path.join(playlists_dir, filename)
                try:
                    with open(playlist_path, 'r') as f:
                        data = json.load(f)
                        tracks = data.get("tracks", [])
                        
                        # Get album art from first track if available
                        album_art = None
                        if tracks:
                            first_track = tracks[0]
                            # Check if track has album art URL (from Spotify metadata)
                            album_art = first_track.get("album_art") or first_track.get("album_art_url") or first_track.get("image_url")
                        
                        # Calculate total duration (estimate ~4 minutes per track if not available)
                        total_duration_minutes = 0
                        for track in tracks:
                            # Try to get duration from track metadata
                            duration_sec = track.get("duration") or track.get("length") or track.get("time")
                            if duration_sec:
                                total_duration_minutes += duration_sec / 60
                            else:
                                # Estimate ~4 minutes per track
                                total_duration_minutes += 4
                        
                        # Get unique artists
                        artists = []
                        artist_set = set()
                        for track in tracks:
                            artist = track.get("artist")
                            if artist and isinstance(artist, str):
                                artist = artist.strip()
                                if artist and artist not in artist_set:
                                    artists.append(artist)
                                    artist_set.add(artist)
                                    if len(artists) >= 5:  # Limit to 5 artists for display
                                        break
                        
                        # Determine style/genre from tracks
                        genres = []
                        genre_set = set()
                        for track in tracks:
                            # Check for genre field
                            genre = track.get("genre")
                            if genre and isinstance(genre, str):
                                genre = genre.strip()
                                if genre and genre not in genre_set:
                                    genres.append(genre)
                                    genre_set.add(genre)
                            
                            # Check for genres array (from Spotify)
                            track_genres = track.get("genres", [])
                            if isinstance(track_genres, list):
                                for g in track_genres[:2]:  # Limit per track
                                    if g and g not in genre_set:
                                        genres.append(g)
                                        genre_set.add(g)
                                        if len(genres) >= 3:  # Limit total genres
                                            break
                            if len(genres) >= 3:
                                break
                        
                        # Get primary style/genre
                        primary_style = genres[0] if genres else "Mixed"
                        
                        playlists.append({
                            "id": filename.replace('.json', ''),
                            "name": data.get("name", filename.replace('.json', '')),
                            "track_count": data.get("track_count", len(tracks)),
                            "created": data.get("created", ""),
                            "album_art": album_art,
                            "first_artist": (tracks[0].get("artist") or "") if tracks else "",
                            "first_title": (tracks[0].get("title") or tracks[0].get("filename") or "") if tracks else "",
                            "duration_minutes": round(total_duration_minutes, 1),
                            "artists": artists,
                            "style": primary_style,
                            "genres": genres[:3]  # Top 3 genres
                        })
                except Exception as e:
                    print(f"Error loading playlist {filename}: {e}")
                    continue
        
        # Sort by created date (newest first)
        playlists.sort(key=lambda x: x.get("created", ""), reverse=True)
        return {"playlists": playlists}
    except Exception as e:
        return {"playlists": [], "error": str(e)}

@app.get("/library/playlists/{playlist_id}")
async def get_playlist(playlist_id: str):
    """Load a specific playlist."""
    try:
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        playlist_file = os.path.join(playlists_dir, f"{playlist_id}.json")
        
        if not os.path.exists(playlist_file):
            return {"success": False, "error": "Playlist not found"}
        
        with open(playlist_file, 'r') as f:
            data = json.load(f)
        
        return {
            "success": True,
            "name": data.get("name", playlist_id),
            "tracks": data.get("tracks", [])
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.delete("/library/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str):
    """Delete a playlist."""
    try:
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        playlist_file = os.path.join(playlists_dir, f"{playlist_id}.json")
        
        if not os.path.exists(playlist_file):
            return {"success": False, "error": "Playlist not found"}
        
        os.remove(playlist_file)
        return {"success": True, "message": "Playlist deleted"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/audio/{file_path:path}")
@app.head("/audio/{file_path:path}")
async def serve_audio(file_path: str, request: Request):
    """Serve audio files for the player."""
    try:
        # Decode the file path (it will be URL encoded)
        import urllib.parse
        
        # Decode each path segment separately
        path_segments = file_path.split('/')
        decoded_segments = [urllib.parse.unquote(segment) for segment in path_segments if segment]  # Filter empty segments
        decoded_path = '/' + '/'.join(decoded_segments)  # Always start with /
        
        print(f"Serving audio file: {decoded_path}")
        print(f"Original file_path parameter: {file_path}")
        
        # Security check: ensure the path exists and is a valid audio file
        if not os.path.exists(decoded_path):
            print(f"File not found: {decoded_path}")
            print(f"Current working directory: {os.getcwd()}")
            print(f"Decoded path segments: {decoded_segments}")
            # Return proper error response
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=404,
                content={"error": f"File not found: {decoded_path}"}
            )
        
        # Check if it's an audio file
        supported_exts = ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac')
        filename_lower = os.path.basename(decoded_path).lower()
        is_valid_audio = filename_lower.endswith(supported_exts)
        
        if not is_valid_audio:
            print(f"Invalid audio file: {decoded_path}")
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=400,
                content={"error": f"Invalid audio file: {filename_lower}"}
            )
        
        # Determine media type based on file extension
        ext = os.path.splitext(decoded_path)[1].lower()
        media_types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac'
        }
        media_type = media_types.get(ext, 'audio/mpeg')
        
        file_size = os.path.getsize(decoded_path)
        
        # Handle HEAD requests (for pre-flight checks)
        if hasattr(request, 'method') and request.method == "HEAD":
            from fastapi.responses import Response
            return Response(
                status_code=200,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Type": media_type,
                    "Content-Length": str(file_size),
                    "Cache-Control": "public, max-age=3600"
                }
            )
        
        # Handle range requests for seeking
        range_header = None
        if request:
            range_header = request.headers.get('range')
        
        if range_header:
            # Parse range header
            byte_start = 0
            byte_end = file_size - 1
            
            range_match = range_header.replace('bytes=', '').split('-')
            if range_match[0]:
                byte_start = int(range_match[0])
            if len(range_match) > 1 and range_match[1]:
                byte_end = int(range_match[1])
            
            content_length = byte_end - byte_start + 1
            
            # Read file chunk
            with open(decoded_path, 'rb') as f:
                f.seek(byte_start)
                chunk = f.read(content_length)
            
            return StreamingResponse(
                iter([chunk]),
                status_code=206,  # Partial Content
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {byte_start}-{byte_end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(content_length),
                    "Content-Type": media_type,
                }
            )
        
        # Return the full file with appropriate headers
        # Use StreamingResponse for better compatibility
        def iterfile():
            with open(decoded_path, mode="rb") as file_like:
                yield from file_like
        
        return StreamingResponse(
            iterfile(),
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Disposition": f'inline; filename="{os.path.basename(decoded_path)}"',
                "Cache-Control": "public, max-age=3600",
                "Content-Type": media_type
            }
        )
    except Exception as e:
        print(f"Error serving audio: {e}")
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.get("/library/statistics")
async def get_library_statistics():
    """Get library statistics and health metrics."""
    try:
        stats = library_manager.get_statistics()
        return {"success": True, **stats}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/library/health")
async def check_library_health():
    """Check library health and return detailed report."""
    try:
        health_report = library_manager.check_health()
        return {"success": True, **health_report}
    except Exception as e:
        return {"success": False, "error": str(e)}

class CleanupRequest(BaseModel):
    dry_run: bool = True

@app.post("/library/cleanup")
async def cleanup_library(request: CleanupRequest):
    """Clean up orphaned tracks (files that no longer exist)."""
    try:
        result = library_manager.cleanup_orphans(dry_run=request.dry_run)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/library/remove_duplicates")
async def remove_duplicates(request: CleanupRequest):
    """Remove duplicate entries from library."""
    try:
        result = library_manager.remove_duplicates(dry_run=request.dry_run)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/library/folders")
async def get_analyzed_folders():
    """Get list of folders that have been analyzed."""
    try:
        folders = library_manager.get_analyzed_folders()
        folder_stats = library_manager.get_folder_statistics()
        return {
            "success": True,
            "folders": folders,
            "statistics": folder_stats
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/library/folders/{folder_path:path}/tracks")
async def get_folder_tracks(folder_path: str):
    """Get all tracks from a specific folder."""
    try:
        tracks = library_manager.get_tracks_by_folder(folder_path)
        return {
            "success": True,
            "folder": folder_path,
            "count": len(tracks),
            "tracks": tracks
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

class RefreshRequest(BaseModel):
    folder_path: str | None = None

@app.post("/library/refresh")
async def refresh_library_metadata(request: RefreshRequest):
    """Refresh metadata for tracks without re-analysis."""
    try:
        result = library_manager.refresh_library_metadata(folder_path=request.folder_path)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/library/find_content_duplicates")
async def find_content_duplicates(request: CleanupRequest):
    """Find duplicate tracks based on content (title + artist + BPM)."""
    try:
        result = library_manager.find_content_duplicates(dry_run=request.dry_run)
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}

class ClearDataRequest(BaseModel):
    confirm: bool = False
    clear_playlists: bool = False
    clear_exports: bool = False

@app.post("/library/clear_all")
async def clear_all_data(request: ClearDataRequest):
    """Clear all library data. Requires confirmation."""
    try:
        if not request.confirm:
            return {
                "success": False,
                "error": "Confirmation required. Set 'confirm' to true."
            }
        
        # Clear library
        result = library_manager.clear_all_data()
        
        # Optionally clear playlists
        if request.clear_playlists:
            playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
            if os.path.exists(playlists_dir):
                for filename in os.listdir(playlists_dir):
                    if filename.endswith('.json'):
                        try:
                            os.remove(os.path.join(playlists_dir, filename))
                        except Exception as e:
                            print(f"Error deleting playlist {filename}: {e}")
        
        # Optionally clear exports
        if request.clear_exports:
            exports_dir = os.path.join(os.path.dirname(__file__), "exports")
            if os.path.exists(exports_dir):
                for filename in os.listdir(exports_dir):
                    try:
                        os.remove(os.path.join(exports_dir, filename))
                    except Exception as e:
                        print(f"Error deleting export {filename}: {e}")
        
        return {
            "success": True,
            "message": "All data cleared successfully",
            "library_cleared": True,
            "playlists_cleared": request.clear_playlists,
            "exports_cleared": request.clear_exports
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/library/organize/folders")
async def organize_by_folders():
    """Get library organized by source folders."""
    try:
        organization = library_manager.organize_by_folders()
        return {
            "success": True,
            "folders": organization,
            "folder_count": len(organization)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/library/organize/playlists")
async def organize_by_playlists():
    """Get library organized by playlists."""
    try:
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        organization = library_manager.organize_by_playlists(playlists_dir)
        return {
            "success": True,
            "playlists": organization,
            "playlist_count": len(organization)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# Browser API Endpoints
class BrowserFilesRequest(BaseModel):
    path: str | None = None
    type: str = "folder"  # "folder" or "playlist"

class AnalyzeSelectedRequest(BaseModel):
    files: list[str] = []
    folders: list[str] = []
    playlists: list[str] = []
    force: bool = False

@app.get("/browser/tree")
async def get_browser_tree():
    """Get folder and playlist tree structure for browser."""
    try:
        # Ensure library is loaded to get analyzed folders
        library_manager._ensure_loaded()
        
        # Get analyzed folders
        folders = library_manager.get_analyzed_folders()
        
        # Sort folders for better display
        folders = sorted(list(folders))
        
        # Get saved playlists from database
        with library_manager._get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM playlists ORDER BY name")
            playlists = [row[0] for row in cursor.fetchall()]
        
        return {
            "success": True,
            "folders": folders,
            "playlists": sorted(playlists)
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/browser/files")
async def get_browser_files(request: BrowserFilesRequest):
    """Get files in a folder or playlist."""
    try:
        files = []
        
        if request.type == "playlist":
            # Load playlist tracks from database
            with library_manager._get_db_connection() as conn:
                cursor = conn.cursor()
                # Get playlist by name
                cursor.execute("SELECT id FROM playlists WHERE name = ?", (request.path,))
                playlist_row = cursor.fetchone()
                
                if playlist_row:
                    playlist_id = playlist_row[0]
                    # Get tracks in playlist
                    cursor.execute("""
                        SELECT t.* FROM tracks t
                        JOIN playlist_tracks pt ON t.id = pt.track_id
                        WHERE pt.playlist_id = ?
                        ORDER BY pt.position
                    """, (playlist_id,))
                    
                    track_rows = cursor.fetchall()
                    columns = [desc[0] for desc in cursor.description]
                    
                    for track_row in track_rows:
                        track = dict(zip(columns, track_row))
                        file_path = track.get('path')
                        if file_path and os.path.exists(file_path):
                            files.append({
                                "name": track.get('filename', os.path.basename(file_path)),
                                "path": file_path,
                                "type": "file",
                                "artist": track.get('artist', ''),
                                "title": track.get('title', ''),
                                "bpm": track.get('bpm'),
                                "key": track.get('key'),
                                "energy": track.get('energy')
                            })
        else:
            # Get files from folder
            if request.path and os.path.exists(request.path):
                with os.scandir(request.path) as it:
                    for entry in it:
                        if entry.name.startswith('.'):
                            continue
                        
                        if entry.is_file():
                            # Check if it's an audio file
                            ext = os.path.splitext(entry.name)[1].lower()
                            if ext in ['.mp3', '.wav', '.flac', '.aiff', '.ogg', '.m4a']:
                                file_info = {
                                    "name": entry.name,
                                    "path": entry.path,
                                    "type": "file"
                                }
                                
                                # Try to get analysis data from library (preferred - already analyzed)
                                track = library_manager.get_track_by_path(entry.path)
                                found_in_library = False
                                if track:
                                    if track.get('bpm'):
                                        file_info['bpm'] = track.get('bpm')
                                    if track.get('key'):
                                        file_info['key'] = track.get('key')
                                    if track.get('energy') is not None:
                                        file_info['energy'] = track.get('energy')
                                    # Include metadata fields for playlist generation
                                    if track.get('title'):
                                        file_info['title'] = track.get('title')
                                    if track.get('artist'):
                                        file_info['artist'] = track.get('artist')
                                    if track.get('duration'):
                                        file_info['duration'] = track.get('duration')
                                    if track.get('album'):
                                        file_info['album'] = track.get('album')
                                    if track.get('genre'):
                                        file_info['genre'] = track.get('genre')
                                    if track.get('mood'):
                                        file_info['mood'] = track.get('mood')
                                    # Mark that we found it in library (already analyzed)
                                    file_info['analyzed'] = True
                                    # Include analysis status for UI state restoration
                                    # Default to 'analyzed' if status is null but track has analysis data
                                    analysis_status = track.get('analysis_status')
                                    if not analysis_status:
                                        analysis_status = 'analyzed' if track.get('analyzed_at') else 'pending'
                                    file_info['analysis_status'] = analysis_status
                                    found_in_library = True
                                else:
                                    # Not in library yet
                                    file_info['analysis_status'] = 'pending'
                                
                                # If not in library, try reading Mixed in Key tags directly from file
                                # This is for files that haven't been analyzed yet but have Mixed in Key tags
                                # Skip this for performance - only check library data
                                # if not found_in_library:
                                #     from analyzer import get_mixed_in_key_data
                                #     mixed_data = get_mixed_in_key_data(entry.path)
                                #     if mixed_data:
                                #         file_info['bpm'] = mixed_data.get('bpm')
                                #         file_info['key'] = mixed_data.get('key')
                                #         file_info['source'] = 'Mixed in Key (not analyzed)'
                                
                                files.append(file_info)
                        elif entry.is_dir():
                            files.append({
                                "name": entry.name,
                                "path": entry.path,
                                "type": "directory"
                            })
        
        return {
            "success": True,
            "path": request.path,
            "type": request.type,
            "files": files,
            "count": len(files)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/analyze/selected")
async def analyze_selected_items(request: AnalyzeSelectedRequest):
    """Analyze selected files, folders, and playlists."""
    try:
        # Collect all file paths to analyze
        all_files = []
        
        # Add individual files
        for file_path in request.files:
            if os.path.exists(file_path) and os.path.isfile(file_path):
                all_files.append(file_path)
        
        # Expand folders to files
        for folder_path in request.folders:
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                # Add folder to analyzed folders immediately so it appears in browser tree
                # This is handled automatically by update_track() when tracks are added
                # But we need to ensure the folder is registered
                with library_manager._get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT OR IGNORE INTO analyzed_folders (folder_path, imported_at)
                        VALUES (?, ?)
                    """, (folder_path, datetime.now().isoformat()))
                    conn.commit()
                
                for root, dirs, filenames in os.walk(folder_path):
                    for filename in filenames:
                        ext = os.path.splitext(filename)[1].lower()
                        if ext in ['.mp3', '.wav', '.flac', '.aiff', '.ogg', '.m4a']:
                            all_files.append(os.path.join(root, filename))
        
        # Expand playlists to files
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        for playlist_name in request.playlists:
            playlist_path = os.path.join(playlists_dir, f"{playlist_name}.json")
            if os.path.exists(playlist_path):
                with open(playlist_path, 'r') as f:
                    playlist_data = json.load(f)
                    tracks = playlist_data.get('tracks', [])
                    for track in tracks:
                        file_path = track.get('path')
                        if file_path and os.path.exists(file_path):
                            if file_path not in all_files:
                                all_files.append(file_path)
        
        # Remove duplicates
        all_files = list(set(all_files))
        
        if not all_files:
            return {"success": False, "error": "No files to analyze"}
        
        # Start analysis task
        print(f"[ANALYSIS] Starting analysis task for {len(all_files)} files")
        manager.reset_cancellation()
        manager.current_scan_task = asyncio.create_task(
            run_scan_for_files(all_files, request.force)
        )
        print(f"[ANALYSIS] Analysis task created and started")
        
        return {
            "success": True,
            "message": f"Analyzing {len(all_files)} files",
            "file_count": len(all_files)
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

async def run_scan_for_files(file_paths: list[str], force: bool = False):
    """Run analysis for a list of file paths."""
    try:
        print(f"[ANALYSIS] Starting analysis of {len(file_paths)} files (force={force})")
        client_id = os.getenv("SPOTIPY_CLIENT_ID")
        client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
        fetcher = MetadataFetcher(client_id, client_secret)
        
        total_files = len(file_paths)
        processed_files = 0
        
        print(f"[ANALYSIS] Broadcasting 'start' message with total={total_files}")
        await manager.broadcast({
            "type": "start",
            "total": total_files
        })
        
        for idx, path in enumerate(file_paths, 1):
            if manager.scan_cancelled:
                print(f"[ANALYSIS] Analysis cancelled at file {idx}/{total_files}")
                break
            
            file = os.path.basename(path)
            print(f"[ANALYSIS] Processing file {idx}/{total_files}: {file}")
            
            await manager.broadcast({
                "type": "processing",
                "filename": file,
                "path": path,
                "current": idx,
                "total": total_files
            })
            
            # Also send analyzing message for browser rows
            await manager.broadcast({
                "type": "analyzing",
                "filename": file,
                "path": path,
                "current": idx,
                "total": total_files
            })
            
            # Check if already analyzed
            if not force:
                from tagger import has_analysis_tags
                if has_analysis_tags(path):
                    processed_files += 1
                    print(f"[ANALYSIS] File {idx}/{total_files} skipped (already analyzed): {file}")
                    # Send file_done for skipped files
                    await manager.broadcast({
                        "type": "file_done",
                        "filename": file,
                        "path": path,
                        "tags": {},
                        "status": "Skipped (already analyzed)",
                        "current": processed_files,
                        "total": total_files
                    })
                    await asyncio.sleep(0.01)
                    continue
            
            # Update status to analyzing
            with library_manager._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE tracks SET analysis_status = ? WHERE path = ?", ('analyzing', path))
                conn.commit()
            
            # Analyze
            print(f"[ANALYSIS] Analyzing file {idx}/{total_files}: {file}")
            analysis_result = analyze_track(path)
            if not analysis_result:
                processed_files += 1
                print(f"[ANALYSIS] File {idx}/{total_files} failed to analyze: {file}")
                
                # Update database status
                with library_manager._get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE tracks SET analysis_status = ? WHERE path = ?", ('failed', path))
                    conn.commit()
                
                # Send file_done for failed analysis
                await manager.broadcast({
                    "type": "file_done",
                    "filename": file,
                    "path": path,
                    "tags": {},
                    "status": "Failed to analyze",
                    "current": processed_files,
                    "total": total_files
                })
                await asyncio.sleep(0.01)
                continue
            
            # Get metadata
            artist, title = get_artist_title(path)
            metadata_result = {}
            if artist and title:
                analyzed_key = analysis_result.get('key')
                analyzed_energy = analysis_result.get('energy')
                metadata_result = fetcher.get_track_info(artist, title, key=analyzed_key, audio_energy=analyzed_energy)
            
            # Tag file (force=True means overwrite existing tags)
            final_tags = {**analysis_result}
            if metadata_result:
                final_tags.update(metadata_result)
            
            # If forcing re-analysis, clear existing tags first
            if force:
                print(f"[ANALYSIS] Force re-analyze: clearing existing tags for {file}")
                from tagger import clear_analysis_tags
                try:
                    clear_analysis_tags(path)
                except Exception as e:
                    print(f"[ANALYSIS] Warning: Could not clear tags: {e}")
            
            tag_file(path, final_tags)
            
            # Update library - use the parent directory as source folder
            source_folder = os.path.dirname(path)
            final_tags['analysis_status'] = 'analyzed'
            library_manager.update_track(path, final_tags, source_folder=source_folder)
            
            processed_files += 1
            print(f"[ANALYSIS] File {idx}/{total_files} completed: {file} (BPM: {final_tags.get('bpm')}, Key: {final_tags.get('key')})")
            
            # Broadcast update via WebSocket for real-time UI sync
            await manager.broadcast({
                "type": "file_done",
                "filename": file,
                "path": path,
                "tags": final_tags,
                "current": processed_files,
                "total": total_files
            })
            
            await asyncio.sleep(0.01)
        print(f"[ANALYSIS] Analysis complete: {processed_files}/{total_files} files processed")
        
        if not manager.scan_cancelled:
            print(f"[ANALYSIS] Broadcasting 'complete' message: {processed_files}/{total_files}")
            await manager.broadcast({
                "type": "complete",
                "current": processed_files,
                "total": total_files
            })
            print(f"[ANALYSIS] 'complete' message broadcasted successfully")
    except Exception as e:
        error_msg = f"Error during analysis: {str(e)}"
        print(f"ERROR: {error_msg}")
        try:
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
        except:
            pass

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Spotify Integration Endpoints (Public / Client Credentials) ---
from spotipy.oauth2 import SpotifyClientCredentials

def get_spotify_client():
    """Initialize Spotify client with Client Credentials flow (no user login needed)."""
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        return None
        
    client_credentials_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
    return spotipy.Spotify(client_credentials_manager=client_credentials_manager)

@app.get("/spotify/public/status")
async def spotify_status():
    """Check if API is configured."""
    sp = get_spotify_client()
    if not sp:
        return {"connected": False, "error": "Credentials missing"}
    return {"connected": True}

@app.get("/spotify/public/trending")
async def get_spotify_trending():
    """Get Global Top 50 Playlist (Dynamic Search) with Fallback."""
    sp = get_spotify_client()
    
    # Fallback Data to ensure UI never breaks
    fallback_tracks = [
        {"id": "mock1", "name": "Espresso", "artists": ["Sabrina Carpenter"], "album": "Espresso", "duration_ms": 190000, "image": "https://i.scdn.co/image/ab67616d0000b273659cd4673230913b3918e316"},
        {"id": "mock2", "name": "Lunch", "artists": ["Billie Eilish"], "album": "HIT ME HARD AND SOFT", "duration_ms": 180000, "image": "https://i.scdn.co/image/ab67616d0000b27371d62ea7ea8a5be92d3c1f62"},
        {"id": "mock3", "name": "Million Dollar Baby", "artists": ["Tommy Richman"], "album": "Million Dollar Baby", "duration_ms": 200000, "image": "https://i.scdn.co/image/ab67616d0000b273523f5b72e50df8829F"},
        {"id": "mock4", "name": "A Bar Song (Tipsy)", "artists": ["Shaboozey"], "album": "A Bar Song (Tipsy)", "duration_ms": 170000, "image": "https://i.scdn.co/image/ab67616d0000b27344c214d02677d2429d2c4176"},
        {"id": "mock5", "name": "I Had Some Help", "artists": ["Post Malone", "Morgan Wallen"], "album": "I Had Some Help", "duration_ms": 195000, "image": "https://i.scdn.co/image/ab67616d0000b273926f43e7cce57a957088b427"}
    ]
    
    if not sp: 
        return {"success": True, "title": "Trending (Offline Mode)", "tracks": fallback_tracks, "available_offline": True}
    
    try:
        # Search for the playlist to avoid hardcoded ID issues
        search_results = sp.search(q="Top 50 - Global", type="playlist", limit=1)
        if not search_results or not search_results.get('playlists') or not search_results['playlists']['items']:
             print("Spotify: Playlist search returned no results")
             return {"success": True, "title": "Trending (Fallback)", "tracks": fallback_tracks}
        
        playlist_id = search_results['playlists']['items'][0]['id']
        results = sp.playlist(playlist_id)
        
        if not results or not results.get('tracks') or not results['tracks'].get('items'):
            raise Exception("Invalid playlist structure")

        tracks = []
        for item in results['tracks']['items']:
            try:
                track = item.get('track')
                if not track: continue
                
                # Safer parsing
                album = track.get('album', {})
                images = album.get('images', [])
                image_url = images[0].get('url') if images else None
                
                tracks.append({
                    "id": track.get('id', 'unknown'),
                    "name": track.get('name', 'Unknown Title'),
                    "artists": [a.get('name', 'Unknown') for a in track.get('artists', [])],
                    "album": album.get('name', 'Unknown Album'),
                    "duration_ms": track.get('duration_ms', 0),
                    "image": image_url
                })
            except Exception as parse_e:
                print(f"Skipping malformed track: {parse_e}")
                continue
            
        return {"success": True, "title": results.get('name', "Global Top 50"), "description": results.get('description', ""), "tracks": tracks}
    except Exception as e:
        print(f"Spotify Trending API Error: {e}")
        # RETURN FALLBACK INSTEAD OF ERROR
        return {"success": True, "title": "Trending (Fallback Mode)", "description": "Unable to fetch live data.", "tracks": fallback_tracks}

@app.get("/spotify/public/new")
async def get_spotify_new_releases():
    """Get New Releases."""
    sp = get_spotify_client()
    if not sp: return {"error": "Credentials missing"}
    
    try:
        results = sp.new_releases(limit=20, country='US')
        albums = []
        for item in results['albums']['items']:
            albums.append({
                "id": item['id'],
                "name": item['name'],
                "artists": [a['name'] for a in item['artists']],
                "image": item['images'][0]['url'] if item['images'] else None,
                "release_date": item['release_date'],
                "total_tracks": item['total_tracks']
            })
        return {"success": True, "albums": albums}
    except Exception as e:
        return {"success": False, "error": str(e)}
        
@app.get("/spotify/public/album/{album_id}")
async def get_spotify_album(album_id: str):
    """Get tracks for a specific album."""
    sp = get_spotify_client()
    if not sp: return {"error": "Credentials missing"}
    
    try:
        album = sp.album(album_id)
        tracks = []
        for track in album['tracks']['items']:
            tracks.append({
                "id": track['id'],
                "name": track['name'],
                "artists": [a['name'] for a in track['artists']],
                "album": album['name'], # Use album name from parent object
                "duration_ms": track['duration_ms'],
                # Album tracks don't have individual images usually, reuse album art or Handle client side
                "image": album['images'][0]['url'] if album['images'] else None 
            })
        return {"success": True, "tracks": tracks, "album_name": album['name']}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/spotify/public/genres")
async def get_spotify_genres():
    """Get available genre seeds."""
    sp = get_spotify_client()
    if not sp: return {"error": "Credentials missing"}
    try:
        # Try the API method first
        try:
            genres_result = sp.recommendation_genre_seeds()
            genres = genres_result.get('genres', [])
            if genres:
                return {"success": True, "genres": genres}
        except (AttributeError, Exception) as api_error:
            print(f"Spotify genres API error: {api_error}")
            # Fall through to fallback list
        
        # Fallback: use hardcoded list of common genres if API method doesn't exist
        fallback_genres = [
            "acoustic", "afrobeat", "alt-rock", "alternative", "ambient", "anime",
            "black-metal", "bluegrass", "blues", "bossanova", "brazil", "breakbeat",
            "british", "cantopop", "chicago-house", "children", "chill", "classical",
            "club", "comedy", "country", "dance", "dancehall", "death-metal",
            "deep-house", "detroit-techno", "disco", "disney", "drum-and-bass",
            "dub", "dubstep", "edm", "electro", "electronic", "emo", "folk",
            "forro", "french", "funk", "garage", "german", "gospel", "goth",
            "grindcore", "groove", "grunge", "guitar", "happy", "hard-rock",
            "hardcore", "hardstyle", "heavy-metal", "hip-hop", "holidays", "honky-tonk",
            "house", "idm", "indian", "indie", "indie-pop", "industrial", "iranian",
            "j-dance", "j-idol", "j-pop", "j-rock", "jazz", "k-pop", "kids",
            "latin", "latino", "malay", "mandopop", "metal", "metalcore", "minimal-techno",
            "movies", "mpb", "new-age", "new-release", "opera", "pagode", "party",
            "philippines-opm", "piano", "pop", "pop-film", "post-dubstep", "power-pop",
            "progressive-house", "psych-rock", "punk", "punk-rock", "r-n-b", "rainy-day",
            "reggae", "reggaeton", "rock", "rock-n-roll", "salsa", "samba", "sertanejo",
            "show-tunes", "singer-songwriter", "ska", "sleep", "songwriter", "soul",
            "soundtracks", "spanish", "study", "summer", "swedish", "synth-pop", "tango",
            "techno", "trance", "trip-hop", "turkish", "work-out", "world-music"
        ]
        return {"success": True, "genres": fallback_genres}
    except Exception as e:
        print(f"Spotify genres error: {e}")
        # Return fallback genres list even on error
        fallback_genres = [
            "electronic", "house", "techno", "trance", "dubstep", "drum-and-bass",
            "hip-hop", "pop", "rock", "jazz", "classical", "ambient", "chill",
            "dance", "edm", "indie", "alternative", "metal", "punk", "reggae"
        ]
        return {"success": True, "genres": fallback_genres}

@app.get("/spotify/public/recommendations")
async def get_spotify_recommendations(genre: str, energy: float = None, bpm: float = None):
    """Get recommendations based on genre and optional features."""
    sp = get_spotify_client()
    if not sp: return {"error": "Credentials missing"}
    
    try:
        kwargs = {}
        if energy: kwargs['target_energy'] = energy
        if bpm: kwargs['target_tempo'] = bpm
        
        results = sp.recommendations(seed_genres=[genre], limit=20, **kwargs)
        
        tracks = []
        for track in results['tracks']:
            tracks.append({
                "id": track['id'],
                "name": track['name'],
                "artists": [a['name'] for a in track['artists']],
                "album": track['album']['name'],
                "duration_ms": track['duration_ms'],
                "image": track['album']['images'][0]['url'] if track['album']['images'] else None 
            })
        return {"success": True, "tracks": tracks}
    except Exception as e:
        error_msg = str(e)
        print(f"Spotify recommendations error: {error_msg}")
        # Check if it's a 404/403 error (API access limitation)
        if "404" in error_msg or "403" in error_msg or "not available" in error_msg.lower():
            return {
                "success": False, 
                "error": "Spotify Recommendations API is not available. This may be due to API access limitations. Try using Trending or New Releases instead.",
                "api_limited": True
            }
        return {"success": False, "error": error_msg}

@app.post("/spotify/import")
async def import_spotify_playlist(request: Request):
    """
    Match Spotify tracks against local library.
    Expects body: { "tracks": [ ... ] }
    """
    data = await request.json()
    spotify_tracks = data.get('tracks', [])
    
    # Needs library access
    local_tracks = library_manager._get_all_tracks()
    
    matched_results = []
    
    # Create simple index for faster matching
    # Key: "artist - title" (lowercase, simplified)
    def simplify(text): # Simple index key generator
        import re
        if not text: return ""
        return re.sub(r'[^a-z0-9]', '', text.lower())
    
    local_index = {}
    for t in local_tracks:
        key = simplify(f"{t.get('artist')} {t.get('title')}")
        local_index[key] = t
    
    for s_track in spotify_tracks:
        # Prepare search keys
        s_artist = s_track['artists'][0] if s_track['artists'] else ""
        s_title = s_track['name']
        s_key = simplify(f"{s_artist} {s_title}")
        
        match = local_index.get(s_key)
        
        matched_results.append({
            "spotify_track": s_track,
            "match_found": match is not None,
            "local_track": match
        })
        
    return {"success": True, "results": matched_results}

async def run_scan(directory: str, force: bool = False):
    try:
        client_id = os.getenv("SPOTIPY_CLIENT_ID")
        client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
        fetcher = MetadataFetcher(client_id, client_secret)
        
        supported_exts = ('.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac')
        
        total_files = 0
        processed_files = 0
        
        print(f"DEBUG: Starting scan for directory: '{directory}'")
        
        # Validate directory exists
        if not os.path.exists(directory):
            error_msg = f"Directory does not exist: '{directory}'"
            print(f"ERROR: {error_msg}")
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
            return
        
        if not os.path.isdir(directory):
            error_msg = f"Path is not a directory: '{directory}'"
            print(f"ERROR: {error_msg}")
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
            return
        
        def is_audio_file(filepath):
            """Check if file is a valid audio file."""
            if not os.path.isfile(filepath):
                return False
            filename_lower = os.path.basename(filepath).lower()
            return filename_lower.endswith(supported_exts)
        
        # First, collect all valid audio files and send them to client
        all_files = []
        try:
            for root, dirs, files in os.walk(directory):
                for file in files:
                    path = os.path.join(root, file)
                    if is_audio_file(path):
                        all_files.append({
                            "filename": file,
                            "path": path
                        })
                        total_files += 1
        except PermissionError as e:
            error_msg = f"Permission denied accessing directory: '{directory}'"
            print(f"ERROR: {error_msg}: {e}")
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
            return
        except Exception as e:
            error_msg = f"Error scanning directory: {str(e)}"
            print(f"ERROR: {error_msg}")
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
            return
                
        print(f"DEBUG: Total supported files found: {total_files}")
        
        if total_files == 0:
            await manager.broadcast({
                "type": "error",
                "message": f"No supported audio files found in '{directory}'"
            })
            return
        
        # Send all files list to client for display
        await manager.broadcast({
            "type": "start", 
            "total": total_files,
            "files": all_files
        })
        
        from tagger import has_analysis_tags
        
        # Process only the files we collected (ensures consistency)
        for file_info in all_files:
            # Check for cancellation before processing each file
            if manager.scan_cancelled:
                await manager.broadcast({
                    "type": "cancelled",
                    "message": "Analysis cancelled",
                    "processed": processed_files,
                    "total": total_files
                })
                return
            
            file = file_info['filename']
            path = file_info['path']
            
            # Double-check it's still a valid audio file
            if not is_audio_file(path):
                print(f"WARNING: Skipping non-audio file: {path}")
                continue
            
            # Check if file is already analyzed (incremental analysis)
            is_already_analyzed = not force and has_analysis_tags(path)
            library_manager._ensure_loaded()
            track = library_manager.get_track_by_path(path)
            is_in_library = track is not None
            
            if is_already_analyzed and not force:
                # Skip if already analyzed and not forcing
                processed_files += 1
                
                # Still update library if not present (in case tags exist but not in library)
                existing_metadata = None
                if not is_in_library:
                    try:
                        # Extract metadata from existing tags
                        existing_metadata = library_manager._extract_metadata(path)
                        if existing_metadata:
                            # Try to get artist/title for metadata fetch
                            artist, title = get_artist_title(path)
                            if artist and title:
                                analyzed_key = existing_metadata.get('key')
                                analyzed_energy = existing_metadata.get('energy')
                                metadata_result = fetcher.get_track_info(artist, title, key=analyzed_key, audio_energy=analyzed_energy)
                                if metadata_result:
                                    existing_metadata.update(metadata_result)
                            library_manager.update_track(path, existing_metadata, source_folder=directory)
                    except Exception as e:
                        print(f"Error adding existing track to library: {e}")
                
                # Notify UI: File skipped
                await manager.broadcast({
                    "type": "file_done",
                    "filename": file,
                    "path": path,
                    "tags": existing_metadata or {},
                    "current": processed_files,
                    "total": total_files,
                    "status": "Skipped (Already Analyzed)"
                })
                
                await asyncio.sleep(0.001)
                continue
            
            # Notify UI: Processing file
            await manager.broadcast({
                "type": "analyzing", 
                "current": processed_files, 
                "total": total_files,
                "filename": file,
                "path": path,
                "status": "Analyzing..."
            })
            
            # Check for cancellation after broadcasting
            if manager.scan_cancelled:
                await manager.broadcast({
                    "type": "cancelled",
                    "message": "Analysis cancelled",
                    "processed": processed_files,
                    "total": total_files
                })
                return
                
            # 1. Check for Mixed in Key tags first (prefer over our analysis)
            from camelot_wheel import is_camelot_code, camelot_to_key
            from mutagen.mp3 import MP3
            from mutagen.wave import WAVE
            
            mixed_in_key_key = None
            existing_bpm = None
            
            try:
                audio_file = mutagen.File(path)
                if audio_file:
                    if isinstance(audio_file, MP3) or isinstance(audio_file, WAVE):
                        if audio_file.tags:
                            if 'TKEY' in audio_file.tags:
                                key_value = audio_file.tags['TKEY'].text[0]
                                if is_camelot_code(key_value):
                                    mixed_in_key_key = camelot_to_key(key_value)
                            if 'TBPM' in audio_file.tags:
                                existing_bpm = float(audio_file.tags['TBPM'].text[0])
                    else:
                        # FLAC, OGG, etc.
                        if 'key' in audio_file:
                            key_value = audio_file['key'][0]
                            if is_camelot_code(key_value):
                                mixed_in_key_key = camelot_to_key(key_value)
                        if 'bpm' in audio_file:
                            existing_bpm = float(audio_file['bpm'][0])
            except Exception as e:
                print(f"Warning: Could not read existing tags for {path}: {e}")
            
            # 1. Analyze (or use Mixed in Key if available)
            analysis_result = None
            if mixed_in_key_key and existing_bpm:
                # Use Mixed in Key data - skip audio analysis for BPM/Key
                print(f"Using Mixed in Key data for {file}: Key {mixed_in_key_key}, BPM {existing_bpm}")
                # Still need to get energy and duration from audio analysis
                try:
                    loop = asyncio.get_running_loop()
                    energy_result = await loop.run_in_executor(None, analyze_track, path)
                    energy = energy_result.get('energy', 0) if energy_result else 0
                    duration = energy_result.get('duration', 0) if energy_result else 0
                except Exception as e:
                    print(f"Warning: Could not analyze energy for {path}: {e}")
                    energy = 0
                    duration = 0
                
                analysis_result = {
                    "bpm": int(round(existing_bpm)),
                    "key": mixed_in_key_key,
                    "energy": energy,
                    "duration": duration,
                    "source": "Mixed in Key"
                }
            else:
                # Run full audio analysis
                try:
                    # Run analysis in a thread pool to avoid blocking the event loop
                    # This allows the stop command to be processed immediately
                    loop = asyncio.get_running_loop()
                    analysis_result = await loop.run_in_executor(None, analyze_track, path)
                    
                    if not analysis_result:
                        # Analysis failed - still count as processed
                        processed_files += 1
                        await manager.broadcast({
                            "type": "file_done",
                            "filename": file,
                            "path": path,
                            "tags": {},
                            "current": processed_files,
                            "total": total_files,
                            "status": "Analysis Failed"
                        })
                        continue
                except Exception as e:
                    # Analysis error - still count as processed
                    print(f"ERROR: Analysis failed for {path}: {e}")
                    processed_files += 1
                    await manager.broadcast({
                        "type": "file_done",
                        "filename": file,
                        "path": path,
                        "tags": {},
                        "current": processed_files,
                        "total": total_files,
                        "status": f"Error: {str(e)[:50]}"
                    })
                    continue

            # Check for cancellation after analysis
            if manager.scan_cancelled:
                await manager.broadcast({
                    "type": "cancelled",
                    "message": "Analysis cancelled",
                    "processed": processed_files,
                    "total": total_files
                })
                return

            # Notify UI: Analysis done
            await manager.broadcast({
                "type": "log",
                "message": f"Analyzed {file}: BPM {analysis_result['bpm']}, Key {analysis_result['key']}"
            })

            # 2. Metadata
            artist, title = get_artist_title(path)
            metadata_result = {}
            if artist and title:
                # Pass the analyzed key to metadata fetcher for mood enhancement
                analyzed_key = analysis_result.get('key')
                analyzed_energy = analysis_result.get('energy')
                metadata_result = fetcher.get_track_info(artist, title, key=analyzed_key, audio_energy=analyzed_energy)
            
            # 3. Tag
            final_tags = {**analysis_result}
            if metadata_result:
                final_tags.update(metadata_result)
            
            tag_file(path, final_tags)
            
            # Update library cache
            # Track source folder for organization
            library_manager.update_track(path, final_tags, source_folder=directory)
            
            # Increment processed count after successful analysis
            processed_files += 1
            
            # Notify UI: Done with file
            await manager.broadcast({
                "type": "file_done",
                "filename": file,
                "path": path,
                "tags": final_tags,
                "current": processed_files,
                "total": total_files
            })
            
            # Small delay to yield control
            await asyncio.sleep(0.01)
        
        # Flush any pending library updates
        # Database handles transactions automatically, no flush needed
        
        # Only send complete if not cancelled
        if not manager.scan_cancelled:
            await manager.broadcast({"type": "complete"})
        
    except Exception as e:
        error_msg = f"Unexpected error during scan: {str(e)}"
        print(f"ERROR: {error_msg}")
        import traceback
        traceback.print_exc()
        try:
            await manager.broadcast({
                "type": "error",
                "message": error_msg
            })
        except:
            pass  # If we can't broadcast, at least log it

def get_artist_title(path):
    try:
        audio = mutagen.File(path, easy=True)
        if audio:
            artist = audio.get('artist', [None])[0]
            title = audio.get('title', [None])[0]
            return artist, title
    except Exception:
        pass
    return None, None
