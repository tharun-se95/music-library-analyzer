#!/bin/bash

# Stop SkullKrush Music Analyzer Server

echo "=== Stopping SkullKrush Music Analyzer ==="

# Kill processes on port 8000
PORT_PIDS=$(lsof -ti:8000 2>/dev/null)
if [ ! -z "$PORT_PIDS" ]; then
    echo "Killing processes on port 8000: $PORT_PIDS"
    kill -9 $PORT_PIDS 2>/dev/null
    echo "✓ Stopped processes on port 8000"
else
    echo "No processes found on port 8000"
fi

# Kill any uvicorn processes related to server:app
UVICORN_PIDS=$(ps aux | grep -E "uvicorn.*server:app" | grep -v grep | awk '{print $2}')
if [ ! -z "$UVICORN_PIDS" ]; then
    echo "Killing uvicorn processes: $UVICORN_PIDS"
    kill -9 $UVICORN_PIDS 2>/dev/null
    echo "✓ Stopped uvicorn processes"
else
    echo "No uvicorn processes found"
fi

# Wait a moment
sleep 1

# Verify everything is stopped
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "⚠ WARNING: Some processes may still be running"
else
    echo "✓ All server processes stopped"
fi

