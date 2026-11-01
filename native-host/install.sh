#!/bin/sh
# Registers the easy-agent native messaging host so the Chrome extension can
# reach the `easy` C++ agent. macOS only for now.
#
# Usage:
#   ./install.sh <extension-id> [path-to-easy-binary]
#
# <extension-id> is shown on chrome://extensions under the loaded extension.
# path-to-easy-binary defaults to ~/easy-agent/build/easy
#
# This writes:
#   - a small wrapper that runs `easy native-host`
#   - the native host manifest Chrome looks for
# Nothing opens a network port; native messaging is a private pipe.

set -e

EXT_ID="$1"
EASY_BIN="${2:-$HOME/easy-agent/build/easy}"

if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install.sh <extension-id> [path-to-easy-binary]" >&2
  echo "Find the extension id on chrome://extensions (Developer mode on)." >&2
  exit 1
fi
if [ ! -x "$EASY_BIN" ]; then
  echo "easy binary not found or not executable: $EASY_BIN" >&2
  echo "Build it first (cmake --build build) or pass the path as the 2nd argument." >&2
  exit 1
fi

HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
WRAPPER="$HOME/.makeiteasy/easy-agent-host"

mkdir -p "$HOME/.makeiteasy" "$HOST_DIR"

cat > "$WRAPPER" <<EOF
#!/bin/sh
exec "$EASY_BIN" native-host
EOF
chmod +x "$WRAPPER"

cat > "$HOST_DIR/com.makeiteasy.easy_agent.json" <<EOF
{
  "name": "com.makeiteasy.easy_agent",
  "description": "Native messaging host for the easy-agent Chrome extension",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "Installed."
echo "  agent:   $EASY_BIN native-host"
echo "  wrapper: $WRAPPER"
echo "  manifest: $HOST_DIR/com.makeiteasy.easy_agent.json"
echo "Now click 'Check agent' in the extension popup."
