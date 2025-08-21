#!/bin/bash
LOG="/mnt/data/greece-main/public/cf_tunnel.log"
mkdir -p "/mnt/data/greece-main/public"
rm -f "$LOG"

while true; do
  echo "Starting Cloudflare tunnel ($(date))" >>"$LOG"
  # start cloudflared in background so parsing won't kill it
  cloudflared tunnel --url http://localhost:8000 >>"$LOG" 2>&1 &
  CF_PID=$!
  echo "cloudflared started (pid: $CF_PID)" >>"$LOG"

  # wait up to 60s for the published URL to appear in the log, write once when found
  for i in {1..60}; do
    url=$(grep -m1 -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG" 2>/dev/null || true)
    if [ -n "$url" ]; then
      prev=$(cat "/mnt/data/greece-main/public/cf_url.json" 2>/dev/null || true)
      new="{\"cf_url\":\"$url\"}"
      if [ "$prev" != "$new" ]; then
        printf '%s' "$new" > "/mnt/data/greece-main/public/cf_url.json"
        echo "Wrote /mnt/data/greece-main/public/cf_url.json: $url" >>"$LOG"
      else
        echo "URL unchanged; not rewriting /mnt/data/greece-main/public/cf_url.json" >>"$LOG"
      fi
      break
    fi
    sleep 1
  done

  # wait for cloudflared to exit; when it does, sleep and restart the loop
  wait $CF_PID 2>/dev/null
  echo "cloudflared terminated ($(date)), restarting in 2 seconds..." >>"$LOG"
  sleep 2
done
