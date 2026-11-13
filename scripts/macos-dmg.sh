set -euo pipefail
: "${APPLE_SIGNING_IDENTITY:?}"
app="$1"
dmg="$2"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/$(basename "$app")"
ln -s /Applications "$stage/Applications"
mkdir -p "$(dirname "$dmg")"
rm -f "$dmg"
hdiutil create -volname MelonApp -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
codesign --verify --strict "$dmg"
