#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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

# Robust terminal launcher: prefer gnome-terminal.wrapper, gnome-terminal, x-terminal-emulator, fall back to xterm; set TERMINAL_CMD to the chosen emulator and verify the launched PID is alive
START_IN_TERMINAL() {
  local cmd="$1"
  local pid

  for term in gnome-terminal.wrapper gnome-terminal x-terminal-emulator xterm; do
    if command -v "$term" >/dev/null 2>&1; then
      case "$term" in
        gnome-terminal.wrapper|gnome-terminal)
          "$term" -- bash -lc "$cmd; exec bash" >/dev/null 2>&1 &
          ;;
        x-terminal-emulator)
          "$term" -e "bash -lc '$cmd; exec bash'" >/dev/null 2>&1 &
          ;;
        xterm)
          xterm -hold -e "bash -lc '$cmd; exec bash'" >/dev/null 2>&1 &
          ;;
      esac
      pid=$!
      sleep 0.5
      if kill -0 "$pid" 2>/dev/null; then
        TERMINAL_CMD="$term"
        echo "$pid"
        return 0
      else
        echo "$term failed to start (or exited quickly), trying next" >&2
      fi
    fi
  done

  return 1
}

# Write a small worker script that runs inside terminal1. Writing a separate file avoids complex nested quoting
ensure_tunnel_worker() {
  WORKER="$SCRIPT_DIR/.cf_tunnel_worker.sh"
  cat > "$WORKER" <<WORKER
#!/bin/bash
LOG="$SCRIPT_DIR/cf_tunnel.log"
mkdir -p "$SCRIPT_DIR"
rm -f "\$LOG"

while true; do
  echo "Starting Cloudflare tunnel (\$(date))" >>"\$LOG"
  # start cloudflared in background so parsing won't kill it
  cloudflared tunnel --url http://localhost:8000 >>"\$LOG" 2>&1 &
  CF_PID=\$!
  echo "cloudflared started (pid: \$CF_PID)" >>"\$LOG"

  # wait up to 60s for the published URL to appear in the log, write once when found
  for i in {1..60}; do
    url=\$(grep -m1 -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "\$LOG" 2>/dev/null || true)
    if [ -n "\$url" ]; then
      prev=\$(cat "$TUNNEL_JSON" 2>/dev/null || true)
      new="{\"cf_url\":\"\$url\"}"
      if [ "\$prev" != "\$new" ]; then
        printf '%s' "\$new" > "$TUNNEL_JSON"
        echo "Wrote $TUNNEL_JSON: \$url" >>"\$LOG"
      else
        echo "URL unchanged; not rewriting $TUNNEL_JSON" >>"\$LOG"
      fi
      break
    fi
    sleep 1
  done

  # wait for cloudflared to exit; when it does, sleep and restart the loop
  wait \$CF_PID 2>/dev/null
  echo "cloudflared terminated (\$(date)), restarting in 2 seconds..." >>"\$LOG"
  sleep 2
done
WORKER
  chmod +x "$WORKER"
}

# Function to start the tunnel in a terminal (runs the worker script in terminal1)
start_tunnel_xterm() {
  ensure_tunnel_worker
  WORKER="$SCRIPT_DIR/.cf_tunnel_worker.sh"
  TUNNEL_XTERM_PID=$(START_IN_TERMINAL "bash '$WORKER'")
  if [ -z "$TUNNEL_XTERM_PID" ]; then
    echo "Failed to start any terminal for cloudflared. Exiting." >&2
    exit 1
  fi
  echo "Started tunnel terminal (PID: $TUNNEL_XTERM_PID) using ${TERMINAL_CMD:-terminal emulator}"
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
  echo "Tunnel URL not found after waiting. Last 30 lines of log (if any):"
  if [ -f "$SCRIPT_DIR/cf_tunnel.log" ]; then
    tail -n 30 "$SCRIPT_DIR/cf_tunnel.log" || true
  else
    echo "No log file at $SCRIPT_DIR/cf_tunnel.log"
  fi
  return 1
}

# Function to start Flask in a terminal
start_flask_xterm() {
  cmd="python3 app.py"
  FLASK_XTERM_PID=$(START_IN_TERMINAL "$cmd")
  echo "Started Flask terminal (PID: $FLASK_XTERM_PID) using ${TERMINAL_CMD:-terminal emulator}"
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