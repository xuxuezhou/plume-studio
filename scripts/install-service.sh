#!/usr/bin/env bash
# Installs Plume Studio as a macOS LaunchAgent so it starts at login,
# restarts if it crashes, and is always available at http://localhost:5757
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PORT="${PORT:-5757}"
LABEL="com.plume.studio"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.wewrite-studio"

if [ -z "$NODE_BIN" ]; then
  echo "node not found. Install Node.js first." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$PORT</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/plume-studio.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/plume-studio.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "✅ Plume Studio is installed as a background service (starts at login, auto-restarts)."
echo "   Permanent URL: http://localhost:$PORT"
echo "   Log file:      $LOG_DIR/plume-studio.log"
echo "   Uninstall:     npm run service:uninstall"
