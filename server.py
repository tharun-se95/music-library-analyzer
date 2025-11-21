import os
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import mutagen

# Import our existing logic
from analyzer import analyze_track
from metadata import MetadataFetcher
from tagger import tag_file

load_dotenv()

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Store active websockets
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

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

manager = ConnectionManager()

class ScanRequest(BaseModel):
    directory: str

@app.get("/")
async def get():
    with open("static/index.html") as f:
        return HTMLResponse(f.read())

@app.post("/scan")
async def start_scan(request: ScanRequest):
    # Start scanning in background
    asyncio.create_task(run_scan(request.directory))
    return {"status": "started", "directory": request.directory}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def run_scan(directory: str):
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    fetcher = MetadataFetcher(client_id, client_secret)
    
    supported_exts = ('.mp3', '.flac', '.ogg', '.wav')
    
    total_files = 0
    processed_files = 0
    
    # First count files
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.lower().endswith(supported_exts):
                total_files += 1
                
    await manager.broadcast({"type": "start", "total": total_files})
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.lower().endswith(supported_exts):
                path = os.path.join(root, file)
                processed_files += 1
                
                # Notify UI: Processing file
                await manager.broadcast({
                    "type": "progress", 
                    "current": processed_files, 
                    "total": total_files,
                    "filename": file,
                    "status": "Analyzing..."
                })
                
                # 1. Analyze
                analysis_result = analyze_track(path)
                if not analysis_result:
                    continue

                # Notify UI: Analysis done
                await manager.broadcast({
                    "type": "log",
                    "message": f"Analyzed {file}: BPM {analysis_result['bpm']}, Key {analysis_result['key']}"
                })

                # 2. Metadata
                artist, title = get_artist_title(path)
                metadata_result = {}
                if artist and title:
                    metadata_result = fetcher.get_track_info(artist, title)
                
                # 3. Tag
                final_tags = {**analysis_result}
                if metadata_result:
                    final_tags.update(metadata_result)
                
                tag_file(path, final_tags)
                
                # Notify UI: Done with file
                await manager.broadcast({
                    "type": "file_done",
                    "filename": file,
                    "tags": final_tags
                })
                
                # Small delay to yield control
                await asyncio.sleep(0.01)

    await manager.broadcast({"type": "complete"})

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
