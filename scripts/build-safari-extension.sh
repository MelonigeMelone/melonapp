set -euo pipefail
cd "$(dirname "$0")/.."
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY, or - for an unsigned build}"
export MELON_VERSION
MELON_VERSION=$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")
export MELON_WEB_EXTENSION="$PWD/apps/extension/build/safari"
test -f "$MELON_WEB_EXTENSION/manifest.json"
spec=apps/desktop/apple/Safari
out=apps/desktop/src-tauri/target/safari
rm -rf "$spec/build" "$spec/MelonSafari.xcodeproj" "$out"
mkdir -p "$spec/build" "$out"
xcodegen generate --spec "$spec/project.yml"
signing=(CODE_SIGN_IDENTITY="$APPLE_SIGNING_IDENTITY")
if [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
  signing=(CODE_SIGNING_ALLOWED=NO)
else
  signing+=(DEVELOPMENT_TEAM="${APPLE_DEVELOPMENT_TEAM:?Set APPLE_DEVELOPMENT_TEAM}")
fi
xcodebuild -project "$spec/MelonSafari.xcodeproj" -scheme MelonSafari -configuration Release \
  -derivedDataPath "$spec/build/derived" "${signing[@]}" build
ditto "$spec/build/derived/Build/Products/Release/MelonSafari.appex" "$out/MelonSafari.appex"
test -f "$out/MelonSafari.appex/Contents/Resources/manifest.json"
if [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
  codesign --verify --strict "$out/MelonSafari.appex"
fi
