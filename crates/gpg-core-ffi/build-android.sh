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

: "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point to the Android NDK}"
LLVM_STRIP=$(ls "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/*/bin/llvm-strip | head -n 1)

# 1. Native libraries per ABI (minSdk 26 matches the Android app).
#    uniffi-bindgen reads its metadata from the ELF symbol table (.symtab), so
#    keep symbols here (only debug info is dropped) and strip after step 2.
CARGO_PROFILE_RELEASE_STRIP=debuginfo cargo ndk \
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

# uniffi-bindgen exits 0 even when it finds no metadata, so check the output.
KOTLIN="$OUT/kotlin/com/gpglocal/core/gpg_core_ffi.kt"
if [ ! -f "$KOTLIN" ]; then
  echo "uniffi-bindgen did not generate $KOTLIN" >&2
  exit 1
fi

# 3. Strip the shipped libraries (same result as `strip = true` in Cargo.toml)
for so in "$OUT"/jniLibs/*/libgpg_core_ffi.so; do
  "$LLVM_STRIP" --strip-all "$so"
done
