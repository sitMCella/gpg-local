#!/usr/bin/env bash
# Builds libgpg_core_ffi.so for every Android ABI and generates the Kotlin
# bindings into dist/ (jniLibs/ + kotlin/), ready for the Android project.
#
# Requires: Android NDK r28+ (ANDROID_NDK_HOME), cargo-ndk >= 3.5 and
#   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
set -euo pipefail
cd "$(dirname "$0")"

OUT=dist
rm -rf "$OUT"

# 1. Native libraries per ABI (minSdk 26 matches the Android app)
cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  --platform 26 \
  -o "$OUT/jniLibs" \
  build --release --locked

# 2. Kotlin bindings from the compiled library's metadata
cargo run --release --locked --bin uniffi-bindgen -- generate \
  --library "$OUT/jniLibs/arm64-v8a/libgpg_core_ffi.so" \
  --language kotlin \
  --config uniffi.toml \
  --out-dir "$OUT/kotlin"
