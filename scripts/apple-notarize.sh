set -euo pipefail
: "${APPLE_API_KEY:?}" "${APPLE_API_ISSUER:?}" "${APPLE_API_KEY_PATH:?}"
target="$1"
deadline=$((SECONDS + ${MELON_NOTARY_TIMEOUT:-14400}))
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
upload="$target"
if [[ "$target" == *.app ]]; then
  upload="$work/upload.zip"
  ditto -c -k --keepParent "$target" "$upload"
fi
auth=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
field() {
  python3 -c "import json, sys; print(json.load(sys.stdin).get('$1', ''))"
}
id=""
for attempt in 1 2 3 4 5; do
  if id=$(xcrun notarytool submit "$upload" "${auth[@]}" --output-format json | field id) && [ -n "$id" ]; then
    break
  fi
  echo "submit attempt $attempt failed"
  sleep 30
done
[ -n "$id" ]
echo "Notarization submission $id"
while :; do
  status=$(xcrun notarytool info "$id" "${auth[@]}" --output-format json 2>/dev/null | field status || true)
  echo "$(date -u +%H:%M:%S) ${status:-unreachable}"
  case "$status" in
    Accepted) break ;;
    Invalid | Rejected)
      xcrun notarytool log "$id" "${auth[@]}" || true
      exit 1
      ;;
  esac
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Notarization did not finish in time"
    exit 1
  fi
  sleep 60
done
for attempt in 1 2 3 4 5; do
  if xcrun stapler staple "$target"; then
    exit 0
  fi
  sleep 30
done
exit 1
