#!/bin/bash

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=== SkullKrush Music Analyzer Launcher ==="
echo "Killing any existing server processes..."

# Kill any processes using port 8000
PORT_PIDS=$(lsof -ti:8000 2>/dev/null)
if [ ! -z "$PORT_PIDS" ]; then
    echo "Found processes on port 8000: $PORT_PIDS"
    kill -9 $PORT_PIDS 2>/dev/null
    echo "Killed processes on port 8000"
fi

# Kill any uvicorn processes related to this server
UVICORN_PIDS=$(ps aux | grep -E "uvicorn.*server:app" | grep -v grep | awk '{print $2}')
if [ ! -z "$UVICORN_PIDS" ]; then
    echo "Found uvicorn processes: $UVICORN_PIDS"
    kill -9 $UVICORN_PIDS 2>/dev/null
    echo "Killed uvicorn processes"
fi

# Wait a moment for processes to fully terminate
sleep 1

# Verify port is free
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "WARNING: Port 8000 is still in use. Trying again..."
    sleep 2
    PORT_PIDS=$(lsof -ti:8000 2>/dev/null)
    if [ ! -z "$PORT_PIDS" ]; then
        kill -9 $PORT_PIDS 2>/dev/null
        sleep 1
    fi
fi

echo "Starting fresh server instance..."

# Activate virtual environment
if [ ! -d "venv" ]; then
    echo "ERROR: Virtual environment not found. Please run: python3 -m venv venv"
    exit 1
fi

source venv/bin/activate

# Clear Python cache to ensure fresh code
echo "Clearing Python cache..."
find . -type d -name __pycache__ -exec rm -r {} + 2>/dev/null
find . -type f -name "*.pyc" -delete 2>/dev/null

# Start the server in the background with reload for development
echo "Starting uvicorn server..."
./venv/bin/uvicorn server:app --reload --port 8000 --host 127.0.0.1 > app.log 2>&1 &
PID=$!

# Wait for server to start
echo "Waiting for server to start..."
for i in {1..10}; do
    if curl -s http://127.0.0.1:8000 > /dev/null 2>&1; then
        echo "✓ Server is running (PID: $PID)"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "✗ Server failed to start. Check app.log for errors."
        tail -20 app.log
        exit 1
    fi
    sleep 1
done

# Open the browser
echo "Opening browser..."
open "http://127.0.0.1:8000"

echo ""
echo "Server is running!"
echo "PID: $PID"
echo "Logs: $DIR/app.log"
echo "URL: http://127.0.0.1:8000"
echo ""
echo "Press Ctrl+C to stop the server"

# Keep the script running to keep the server alive
wait $PID
