set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-apple-ffi.sh host
mkdir -p tmp
swiftc apps/desktop/apple/Bindings/melon_ffi.swift apps/desktop/apple/AutoFill/CredentialVault.swift apps/desktop/apple/Tests/main.swift \
  -Xcc -fmodule-map-file=apps/desktop/apple/Bindings/melon_ffiFFI.modulemap \
  -L target/debug -lmelon_ffi -Xlinker -rpath -Xlinker "$PWD/target/debug" -o tmp/melon-swift-tests
tmp/melon-swift-tests
