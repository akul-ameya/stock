#!/bin/bash

SCRIPT_DIR="$(dirname "$0")"
TUNNEL_JSON="$SCRIPT_DIR/cf_url.json"

# Function to start the tunnel in xterm1 (looping forever)
start_tunnel_xterm() {
  xterm -hold -e "
    while true; do
      echo 'Starting Cloudflare tunnel...'
      cloudflared tunnel --url http://localhost:8000 2>&1 | \
        grep -m 1 -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' | \
        awk '{print \"{\\\"cf_url\\\": \\\"\" \$0 \"\\\"}\"}' > \"$TUNNEL_JSON\"
      echo 'Tunnel terminated. Restarting in 2 seconds...'
      sleep 2
    done
  " &
  TUNNEL_XTERM_PID=$!
}

# Function to wait for tunnel_url.json to exist and contain a valid URL
wait_for_tunnel_url() {
  for i in {1..30}; do
    if [ -f "$TUNNEL_JSON" ] && grep -q "https://" "$TUNNEL_JSON"; then
      echo "Tunnel URL found: $(cat "$TUNNEL_JSON")"
      return 0
    fi
    sleep 1
  done
  echo "Tunnel URL not found after waiting."
  return 1
}

# Function to start Flask in xterm2
start_flask_xterm() {
  xterm -hold -e "python3 app.py" &
  FLASK_XTERM_PID=$!
}

# Function to kill Flask xterm
kill_flask_xterm() {
  if [ -n "$FLASK_XTERM_PID" ]; then
    echo "Killing Flask xterm ($FLASK_XTERM_PID)"
    kill $FLASK_XTERM_PID 2>/dev/null
    FLASK_XTERM_PID=""
  fi
}

# Start tunnel in xterm1 (never killed, always running)
start_tunnel_xterm

while true; do
  wait_for_tunnel_url
  start_flask_xterm

  # Monitor tunnel process by checking tunnel_url.json update
  LAST_TUNNEL_URL=$(cat "$TUNNEL_JSON" 2>/dev/null)
  while true; do
    sleep 2
    CURRENT_TUNNEL_URL=$(cat "$TUNNEL_JSON" 2>/dev/null)
    if [ "$CURRENT_TUNNEL_URL" != "$LAST_TUNNEL_URL" ]; then
      echo "Tunnel URL changed or tunnel restarted. Restarting Flask xterm..."
      kill_flask_xterm
      break
    fi
    # If Flask xterm is closed manually, restart it
    if ! kill -0 $FLASK_XTERM_PID 2>/dev/null; then
      echo "Flask xterm closed. Restarting Flask xterm..."
      break
    fi
  done
done