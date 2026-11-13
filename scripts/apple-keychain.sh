set -euo pipefail
: "${MELON_P12:?Set MELON_P12 to a base64 encoded PKCS#12 file}"
: "${MELON_P12_PASSWORD:?Set MELON_P12_PASSWORD}"
dir="$1"
umask 077
mkdir -p "$dir"
keychain="$dir/signing.keychain-db"
password=$(openssl rand -base64 24)
printf '%s' "$MELON_P12" | base64 --decode > "$dir/identity.p12"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$dir/identity.p12" -k "$keychain" -P "$MELON_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
rm "$dir/identity.p12"
