set -euo pipefail
cd "$(dirname "$0")/.."
icons=apps/desktop/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset
for icon in "$icons"/*.png; do
  size=$(sips -g pixelWidth "$icon" | awk '/pixelWidth/ {print $2}')
  rsvg-convert -w "$size" -h "$size" -b '#05060A' assets/icon-ios.svg -o "$icon"
  test "$(sips -g hasAlpha "$icon" | awk '/hasAlpha/ {print $2}')" = no
done
