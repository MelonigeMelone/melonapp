set -euo pipefail
cd "$(dirname "$0")/.."
: "${APPLE_DEVELOPMENT_TEAM:?Set APPLE_DEVELOPMENT_TEAM to your team ID}"
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to an installed Apple Development identity}"
: "${APPLE_PROVISIONING_PROFILE:?Set APPLE_PROVISIONING_PROFILE to a matching macOS development profile}"
export PATH="$HOME/.cargo/bin:$PATH"
export MELON_SIGNING_TEMP
MELON_SIGNING_TEMP=$(mktemp -d)
trap 'rm -rf "$MELON_SIGNING_TEMP"' EXIT
python3 - <<'PY'
import datetime, fnmatch, json, os, pathlib, plistlib, subprocess
root = pathlib.Path(os.environ['MELON_SIGNING_TEMP'])
team = os.environ['APPLE_DEVELOPMENT_TEAM']
profile = pathlib.Path(os.environ['APPLE_PROVISIONING_PROFILE']).expanduser().resolve(strict=True)
data = plistlib.loads(subprocess.run(['security', 'cms', '-D', '-i', str(profile)], check=True, capture_output=True).stdout)
app_id = data.get('Entitlements', {}).get('com.apple.application-identifier', '')
if 'OSX' not in data.get('Platform', []) or team not in data.get('TeamIdentifier', []) or not fnmatch.fnmatch(team + '.de.melonigemelone.app', app_id) or data.get('ExpirationDate', datetime.datetime.min) <= datetime.datetime.now():
    raise SystemExit('Provisioning profile does not match this macOS app and team, or has expired')
entitlements = root / 'Entitlements.plist'
entitlements.write_bytes(plistlib.dumps({'com.apple.application-identifier': team + '.de.melonigemelone.app', 'com.apple.developer.team-identifier': team}))
(root / 'config.json').write_text(json.dumps({'bundle': {'macOS': {'entitlements': str(entitlements), 'signingIdentity': os.environ['APPLE_SIGNING_IDENTITY'], 'files': {'embedded.provisionprofile': str(profile)}}}}))
PY
npm run tauri -w desktop -- build --config "$MELON_SIGNING_TEMP/config.json"
codesign --verify --deep --strict apps/desktop/src-tauri/target/release/bundle/macos/MelonApp.app
