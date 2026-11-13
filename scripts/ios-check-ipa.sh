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
  entitlements="$(codesign -d --entitlements - --xml "$extension" 2>/dev/null || true)
$(codesign -d --entitlements :- "$extension" 2>/dev/null || true)
$(codesign -d --entitlements - "$extension" 2>&1 || true)"
  if grep -q group.de.melonigemelone.app <<<"$entitlements"; then
    return 0
  fi
  echo "  entitlements of $(basename "$extension"):"
  codesign -d --entitlements - "$extension" 2>&1 | sed 's/^/    /' || true
  codesign -dvv "$extension" 2>&1 | grep -E 'Authority|Identifier|TeamIdentifier' | sed 's/^/    /' || true
  return 1
}
check "extension links only system libraries" only_system_libraries
check "app build number" build_number "$app"
check "extension build number" build_number "$extension"
check "app privacy manifest" test -f "$app/PrivacyInfo.xcprivacy"
check "extension privacy manifest" test -f "$extension/PrivacyInfo.xcprivacy"
check "extension App Group entitlement" app_group
exit "$failed"
