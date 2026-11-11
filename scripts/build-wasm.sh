#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
target_dir="${CARGO_TARGET_DIR:-target}"
version="$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')"

if ! command -v wasm-bindgen >/dev/null || [ "$(wasm-bindgen --version | cut -d' ' -f2)" != "$version" ]; then
  cargo install wasm-bindgen-cli --version "$version" --locked
fi

cargo build -p melon-wasm --target wasm32-unknown-unknown --profile wasm-release --locked
wasm-bindgen --target web --out-dir packages/melon-wasm/pkg \
  "$target_dir/wasm32-unknown-unknown/wasm-release/melon_wasm.wasm"
