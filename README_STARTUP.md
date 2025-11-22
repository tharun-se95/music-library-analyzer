# Starting and Stopping the Server

## Quick Start

### Start the Server
```bash
./launcher.sh
```

The launcher script will:
1. ✅ Kill any existing server processes
2. ✅ Clear Python cache for fresh code
3. ✅ Start a new server instance
4. ✅ Open your browser automatically
5. ✅ Show server status and logs

### Stop the Server
```bash
./stop_server.sh
```

Or manually:
```bash
# Find and kill processes on port 8000
lsof -ti:8000 | xargs kill -9

# Or kill all uvicorn processes
pkill -9 -f "uvicorn.*server:app"
```

## Troubleshooting

### Port Already in Use
If you see "Port 8000 is already in use":
```bash
# Kill processes on port 8000
lsof -ti:8000 | xargs kill -9

# Or use the stop script
./stop_server.sh
```

### Code Changes Not Reflecting
The server uses `--reload` flag which should auto-reload on code changes. If changes aren't showing:

1. Stop the server: `./stop_server.sh`
2. Clear Python cache: `find . -type d -name __pycache__ -exec rm -r {} +`
3. Start fresh: `./launcher.sh`

### Server Won't Start
Check the logs:
```bash
tail -f app.log
```

Common issues:
- Port 8000 already in use → Use `./stop_server.sh`
- Virtual environment not activated → Run `source venv/bin/activate`
- Dependencies missing → Run `pip install -r requirements.txt`

## Development Mode

For development with auto-reload:
```bash
source venv/bin/activate
uvicorn server:app --reload --port 8000
```

## Production Mode

For production (no auto-reload):
```bash
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8000
```

