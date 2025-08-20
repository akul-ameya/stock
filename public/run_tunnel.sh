#!/bin/bash

SCRIPT_DIR="$(dirname "$0")"
TUNNEL_JSON="$SCRIPT_DIR/cf_url.json"

# Function to run git add/commit/push from repo root (one level up from public/)
git_commit_push() {
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  echo "Running git commit/push in $REPO_ROOT"
  (
    cd "$REPO_ROOT" || return 1

    # Stage only the tunnel JSON file (avoid committing unrelated changes)
    if [ -f "$SCRIPT_DIR/cf_url.json" ]; then
      git add -- "public/cf_url.json"
    else
      echo "No $SCRIPT_DIR/cf_url.json to add"
    fi

    # If there is nothing staged, skip commit/push
    if git diff --staged --quiet; then
      echo "No staged changes to commit"
      return 0
    fi

    # Ensure an ssh-agent is available and the key is loaded so git push won't prompt
    AGENT_STARTED=""
    if [ -z "$SSH_AUTH_SOCK" ]; then
      # start a temporary agent for this subshell
      eval "$(ssh-agent -s)" >/dev/null 2>&1
      AGENT_STARTED=1
    fi

    SSH_KEY="$HOME/.ssh/id_ed25519"
    if [ -f "$SSH_KEY" ]; then
      # try to add the key (quiet on success). If passphrase required, user may need to enter it.
      ssh-add "$SSH_KEY" >/dev/null 2>&1 || echo "ssh-add failed (key may require a passphrase or agent not available)"
    fi

    # commit and push, but don't abort the script on error
    if git commit -m "cf update"; then
      git push -u origin main || echo "git push failed"
    else
      echo "git commit failed (maybe no changes or git not configured)"
    fi

    # If we started a temporary agent, kill it to avoid leftover processes
    if [ -n "$AGENT_STARTED" ]; then
      eval "$(ssh-agent -k)" >/dev/null 2>&1 || true
    fi
  )
}

# Choose a terminal emulator: prefer gnome-terminal, fall back to xterm
if command -v gnome-terminal >/dev/null 2>&1; then
  TERMINAL_CMD="gnome-terminal"
  # Use -- bash -lc "..." so commands run in bash and the terminal stays open with exec bash
  START_IN_TERMINAL() { $TERMINAL_CMD -- bash -lc "$1; exec bash" & echo $!; }
elif command -v xterm >/dev/null 2>&1; then
  TERMINAL_CMD="xterm"
  START_IN_TERMINAL() { $TERMINAL_CMD -hold -e "bash -lc \"$1; exec bash\"" & echo $!; }
else
  echo "No supported terminal emulator found (gnome-terminal or xterm). Exiting."
  exit 1
fi

# Function to start the tunnel in a terminal (looping forever)
start_tunnel_xterm() {
  # command to run in terminal
  cmd="while true; do
    echo 'Starting Cloudflare tunnel...';
    cloudflared tunnel --url http://localhost:8000 2>&1 | \
      grep -m 1 -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' | \
      awk '{print \"{\\\"cf_url\\\": \\\"\" \$0 \"\\\"}\"}' > \"$TUNNEL_JSON\";
    echo 'Tunnel terminated. Restarting in 2 seconds...';
    sleep 2;
  done"
  TUNNEL_XTERM_PID=$(START_IN_TERMINAL "$cmd")
  echo "Started tunnel terminal (PID: $TUNNEL_XTERM_PID) using $TERMINAL_CMD"
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

# Function to start Flask in a terminal
start_flask_xterm() {
  cmd="python3 app.py"
  FLASK_XTERM_PID=$(START_IN_TERMINAL "$cmd")
  echo "Started Flask terminal (PID: $FLASK_XTERM_PID) using $TERMINAL_CMD"
}

# Function to kill Flask terminal
kill_flask_xterm() {
  if [ -n "$FLASK_XTERM_PID" ]; then
    echo "Killing Flask terminal ($FLASK_XTERM_PID)"
    kill $FLASK_XTERM_PID 2>/dev/null || true
    FLASK_XTERM_PID=""
  fi
}

start_tunnel_xterm

while true; do
  wait_for_tunnel_url
  start_flask_xterm

  # Monitor tunnel process by checking tunnel_url.json update
  LAST_TUNNEL_URL=$(cat "$TUNNEL_JSON" 2>/dev/null)

  # commit/push the initial URL as well
  git_commit_push

  while true; do
    sleep 2
    CURRENT_TUNNEL_URL=$(cat "$TUNNEL_JSON" 2>/dev/null)
    if [ "$CURRENT_TUNNEL_URL" != "$LAST_TUNNEL_URL" ]; then
      echo "Tunnel URL changed or tunnel restarted. Restarting Flask terminal..."
      # commit & push the new URL
      git_commit_push
      kill_flask_xterm
      break
    fi
    # If Flask terminal is closed manually, restart it
    if [ -n "$FLASK_XTERM_PID" ] && ! kill -0 $FLASK_XTERM_PID 2>/dev/null; then
      echo "Flask terminal closed. Restarting Flask terminal..."
      break
    fi
  done
done