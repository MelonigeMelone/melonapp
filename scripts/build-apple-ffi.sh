set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
cargo build -p melon-ffi --locked
cargo run -p melon-ffi --locked --features bindgen --bin melon-bindgen -- generate --library target/debug/libmelon_ffi.dylib --language swift --out-dir apps/desktop/apple/Bindings
case "${1:-host}" in
  iphonesimulator) cargo build -p melon-ffi --locked --release --target aarch64-apple-ios-sim ;;
  iphoneos) cargo build -p melon-ffi --locked --release --target aarch64-apple-ios ;;
  host) ;;
  *) exit 2 ;;
esac
