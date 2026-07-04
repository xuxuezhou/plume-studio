#!/usr/bin/env bash
# Removes the Plume Studio LaunchAgent.
set -euo pipefail

LABEL="com.plume.studio"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

echo "Plume Studio service removed. You can still start it manually with npm start."
