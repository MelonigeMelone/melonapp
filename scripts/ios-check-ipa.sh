set -euo pipefail
ipa="$1"
build="$2"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
unzip -q "$ipa" -d "$work"
app="$work/Payload/MelonApp.app"
extension="$app/PlugIns/MelonAutoFill.appex"
failed=0
check() {
  local label="$1"
  shift
  if "$@"; then
    echo "ok: $label"
  else
    echo "FAILED: $label"
    failed=1
  fi
}
only_system_libraries() {
  ! otool -L "$extension/MelonAutoFill" | tail -n +2 | grep -v -e /usr/lib/ -e /System/Library/
}
build_number() {
  local actual
  actual=$(plutil -extract CFBundleVersion raw "$1/Info.plist")
  echo "  CFBundleVersion of $(basename "$1"): $actual"
  [ "$actual" = "$build" ]
}
app_group() {
  local entitlements
  entitlements=$(codesign -d --entitlements - --xml "$extension" 2>/dev/null || true)
  grep -q group.de.melonigemelone.app <<<"$entitlements"
}
check "extension links only system libraries" only_system_libraries
check "app build number" build_number "$app"
check "extension build number" build_number "$extension"
check "app privacy manifest" test -f "$app/PrivacyInfo.xcprivacy"
check "extension privacy manifest" test -f "$extension/PrivacyInfo.xcprivacy"
check "extension App Group entitlement" app_group
exit "$failed"
