import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import mutagen
import uvicorn
import json

# Import our existing logic
from analyzer import analyze_track
from metadata import MetadataFetcher
from tagger import tag_file
from library_manager import LibraryManager

load_dotenv()

app = FastAPI()
library_manager = LibraryManager()

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
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
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
    bpm_min: int | None = None
    bpm_max: int | None = None
    energy_min: float | None = None
    energy_max: float | None = None
    key: str | None = None
    genre: str | None = None

@app.post("/library/export/m3u")
async def export_m3u(request: ExportRequest):
    if request.tracks:
        # Export provided tracks directly
        tracks = request.tracks
    else:
        # Use filters to query library
        filters = {k: v for k, v in request.dict().items() if v is not None and k != 'tracks'}
        tracks = library_manager.query(filters)
    path = library_manager.export_m3u(tracks)
    return {"message": "Playlist exported", "path": path}

@app.post("/library/export/rekordbox")
async def export_rekordbox(request: ExportRequest):
    if request.tracks:
        # Export provided tracks directly
        tracks = request.tracks
    else:
        # Use filters to query library
        filters = {k: v for k, v in request.dict().items() if v is not None and k != 'tracks'}
        tracks = library_manager.query(filters)
    path = library_manager.export_rekordbox(tracks)
    return {"message": "Rekordbox XML exported", "path": path}

class SmartPlaylistRequest(BaseModel):
    duration: int = 60  # minutes
    energy_curve: str = "gradual_build"  # preset name
    start_key: str | None = None
    mood: str | None = None  # NEW: mood filter
    filters: dict | None = None
    tracks: list | None = None  # Optional: use provided tracks instead of querying

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
                mood=request.mood
            )
        else:
            # Use filters to query library
            playlist = library_manager.generate_smart_playlist(
                duration_minutes=request.duration,
                energy_curve=request.energy_curve,
                start_key=request.start_key,
                mood=request.mood,
                filters=request.filters
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
        playlists_dir = os.path.join(os.path.dirname(__file__), "playlists")
        os.makedirs(playlists_dir, exist_ok=True)
        
        playlist_file = os.path.join(playlists_dir, f"{request.name.replace('/', '_')}.json")
        
        playlist_data = {
            "name": request.name,
            "tracks": request.tracks,
            "created": __import__('datetime').datetime.now().isoformat(),
            "track_count": len(request.tracks)
        }
        
        with open(playlist_file, 'w') as f:
            json.dump(playlist_data, f, indent=2)
        
        return {"success": True, "message": f"Playlist '{request.name}' saved"}
    except Exception as e:
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
                            artist = track.get("artist", "").strip()
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
                            genre = track.get("genre", "").strip()
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
                            "first_artist": tracks[0].get("artist", "") if tracks else "",
                            "first_title": tracks[0].get("title", "") if tracks else "",
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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

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
            is_in_library = any(t.get('path') == path for t in (library_manager.library or []))
            
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
                            library_manager.update_track(path, existing_metadata, batch_mode=True, source_folder=directory)
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
                
            # 1. Analyze
            try:
                analysis_result = analyze_track(path)
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
            
            # Update library cache (batch mode for performance)
            # Track source folder for organization
            library_manager.update_track(path, final_tags, batch_mode=True, source_folder=directory)
            
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
        library_manager.flush_updates()
        
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
