#!/bin/bash
set -e

# Export environment paths
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.config/nvm/versions/node/v22.22.2/bin:$PATH:/usr/local/bin:/usr/bin:/bin"

REPO_DIR="/home/anurag/Desktop/levelup"
PORT=5173
URL="http://127.0.0.1:${PORT}"

cd "$REPO_DIR"

# Check if dist is built; build if missing
if [ ! -d "$REPO_DIR/dist" ]; then
  npm run build
fi

# Ensure fresh server instance with newest dist
if ! curl -s --connect-timeout 1 "${URL}" >/dev/null 2>&1; then
  nohup npm run preview -- --port ${PORT} --host 127.0.0.1 >/tmp/levelup-server.log 2>&1 &
  
  # Wait for server readiness
  for i in {1..30}; do
    if curl -s --connect-timeout 1 "${URL}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.15
  done
fi

# Launch in standalone App Window Mode with custom profile
if [ -x "/usr/bin/brave-browser-stable" ]; then
  exec /usr/bin/brave-browser-stable \
    --app="${URL}" \
    --user-data-dir="${HOME}/.config/levelup-app" \
    --class="LevelUp" \
    --name="LevelUp" \
    --window-size=430,920 \
    "$@"
elif [ -x "/usr/bin/xdg-open" ]; then
  exec /usr/bin/xdg-open "${URL}"
else
  echo "LevelUp is running at ${URL}"
fi
