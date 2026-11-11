set -euo pipefail
cd "$(dirname "$0")/.."
: "${APPLE_DEVELOPMENT_TEAM:?Set APPLE_DEVELOPMENT_TEAM to your team ID}"
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to an installed Apple Development identity}"
export PATH="$HOME/.cargo/bin:$PATH"
export MELON_SIGNING_TEMP
MELON_SIGNING_TEMP=$(mktemp -d)
trap 'rm -rf "$MELON_SIGNING_TEMP"' EXIT
python3 - <<'PY'
import json, os, pathlib, plistlib
root = pathlib.Path(os.environ['MELON_SIGNING_TEMP'])
team = os.environ['APPLE_DEVELOPMENT_TEAM']
entitlements = root / 'Entitlements.plist'
entitlements.write_bytes(plistlib.dumps({'com.apple.application-identifier': team + '.de.melonapp.app', 'com.apple.developer.team-identifier': team}))
(root / 'config.json').write_text(json.dumps({'bundle': {'macOS': {'entitlements': str(entitlements), 'signingIdentity': os.environ['APPLE_SIGNING_IDENTITY']}}}))
PY
npm run tauri -w desktop -- build --config "$MELON_SIGNING_TEMP/config.json"
codesign --verify --deep --strict apps/desktop/src-tauri/target/release/bundle/macos/MelonApp.app
