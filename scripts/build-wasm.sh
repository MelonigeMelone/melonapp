#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
target_dir="${CARGO_TARGET_DIR:-target}"
version="$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')"

checksum() {
  case "$1" in
    0.2.130-x86_64-unknown-linux-musl) echo 9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f ;;
    0.2.130-aarch64-unknown-linux-musl) echo 99ffc93ce80081b91632e2b539b782821a8f3439ab0fddc645287462b2f55d3d ;;
    0.2.130-aarch64-apple-darwin) echo b90ddb9357f584b1af897d58ad77e4cce2b48fc17e2a967bc249a87f72809444 ;;
    0.2.130-x86_64-apple-darwin) echo eb209c115b7cb95832423c1aa3f4d06d6c53f63ef74fc4b6fb79ef0b2eea5f10 ;;
  esac
}

download() {
  local target
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) target=x86_64-unknown-linux-musl ;;
    Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-musl ;;
    Darwin-arm64) target=aarch64-apple-darwin ;;
    Darwin-x86_64) target=x86_64-apple-darwin ;;
    *) return 1 ;;
  esac
  local expected name work
  expected="$(checksum "$version-$target")"
  [[ -n "$expected" ]] || return 1
  name="wasm-bindgen-$version-$target"
  work="$(mktemp -d)"
  curl -fsSL --retry 3 --max-time 120 -o "$work/$name.tar.gz" \
    "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$name.tar.gz" || { rm -rf "$work"; return 1; }
  if [[ "$( (sha256sum "$work/$name.tar.gz" 2> /dev/null || shasum -a 256 "$work/$name.tar.gz") | cut -d' ' -f1)" != "$expected" ]]; then
    rm -rf "$work"
    echo "wasm-bindgen $version: checksum mismatch" >&2
    exit 1
  fi
  tar -xzf "$work/$name.tar.gz" -C "$work"
  local bin="${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}/bin"
  mkdir -p "$bin"
  install -m 755 "$work/$name/wasm-bindgen" "$bin/wasm-bindgen"
  rm -rf "$work"
}

if ! command -v wasm-bindgen > /dev/null || [ "$(wasm-bindgen --version | cut -d' ' -f2)" != "$version" ]; then
  if ! download; then
    echo "wasm-bindgen $version: no verified binary for this platform, building it" >&2
    cargo install wasm-bindgen-cli --version "$version" --locked
  fi
fi

cargo build -p melon-wasm --target wasm32-unknown-unknown --profile wasm-release --locked
wasm-bindgen --target web --out-dir packages/melon-wasm/pkg \
  "$target_dir/wasm32-unknown-unknown/wasm-release/melon_wasm.wasm"
