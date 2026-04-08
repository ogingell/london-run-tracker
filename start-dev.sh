#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/gingelo/Desktop/code/london-run-tracker
npx concurrently -n server,client -c blue,green "node --watch server/index.js" "npx vite --port 5173"
