#!/usr/bin/env sh
cd "$(dirname "$0")"
echo "Starting SafeCircle at http://localhost:8000"
python3 -m http.server 8000
