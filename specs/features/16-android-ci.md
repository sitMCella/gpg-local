# Feature: Android Build in CI

Build, test and release the Android app and its Rust core in GitHub Actions. A new pull-request workflow verifies the shared Rust crates, the Android build, JVM tests and instrumented tests on emulators. The existing tag-triggered release workflow is extended to produce a signed, verified Android APK and attach it to the same GitHub Release as the desktop installers. The Android app version is derived from the same single version the desktop release already checks.

---

## Motivation

Features 09–15 add two Rust crates and an Android app, but the repository's only workflow (`.github/workflows/release.yml`) builds the desktop app on tag pushes. Nothing verifies on pull requests that:

- `gpg-core` and `gpg-core-ffi` still compile, pass tests and stay free of Tauri,
- the native libraries still cross-compile for all Android ABIs with 16 KB alignment,
- the Android app builds, and its unit and instrumented tests pass on real emulator images,
- ciphertext stays compatible across desktop, Android and `gpg`.

Releases also need a reproducible, signed APK whose version can't drift from the desktop release, without a manual signing step on a developer machine.

---

## Goals

1. Add `.github/workflows/android-ci.yml`, triggered on pull requests and pushes to `main` that touch `crates/**`, `android/**`, `src-tauri/**` or the workflow itself.
2. **Rust core job:** `fmt`, `clippy -D warnings` and tests for `gpg-core` and `gpg-core-ffi`, plus a check that no Tauri crate is in the core's dependency tree.
3. **Android build job:** cross-compile the native libraries once, verify their linked libraries and 16 KB alignment, then build the debug APK and run JVM unit tests and Android Lint. Upload the native `dist/` and the APK as artifacts.
4. **Instrumented test job:** run `connectedDebugAndroidTest` on x86_64 emulators at API 26 and API 35, reusing the built native libraries.
5. **Single source of version truth:** the Android `versionName` / `versionCode` are derived from `package.json`, which `release.yml` already checks against `tauri.conf.json` and `src-tauri/Cargo.toml`.
6. **Release:** on a `vX.Y.Z` tag, build a signed release APK with secrets-held keys, verify its signature and alignment, and attach `GPG-Local_<version>_android.apk` plus its SHA-256 checksum to the GitHub Release created by the desktop jobs.
7. Keep CI fast and cheap: path filters, Rust and Gradle caching, native libraries built once per run, and concurrency cancellation of superseded runs.

---

## Out of Scope

- Google Play publishing (AAB upload, tracks, Play App Signing).
- F-Droid metadata or reproducible-build attestation.
- iOS builds.
- A pull-request workflow for the desktop app (the existing `release.yml` behaviour is kept; desktop PR checks can be a separate feature).
- Dependabot / Renovate configuration.
- Running instrumented tests on physical devices or a device farm.
- Benchmarking large-file performance in CI (remains a manual check in features 13/14).

---

## Prerequisites

| Requirement        | Notes                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Features 09–15     | Crates, Android project, tests and fixtures exist                                                                                   |
| `release.yml`      | Existing tag workflow with `validate-versions` and the desktop `build` matrix                                                       |
| Repository secrets | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (release only)                  |
| Upload keystore    | Created once offline with `keytool` (RSA 4096, validity ≥ 25 years). Stored only as a secret and in the maintainer's offline backup |

---

## Current State

- `.github/workflows/release.yml` runs on `v*.*.*` tags:
  - `validate-versions` checks that `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` agree, and extracts the release notes from `CHANGELOG.md`;
  - `build` (macOS ×2, Ubuntu, Windows) runs `pnpm vitest run` and `tauri-action`, which creates the GitHub Release `vX.Y.Z` and uploads the installers.
- Third-party actions are pinned to full commit SHAs with a `# vN` comment. New workflow steps follow the same convention.
- Features 09 and 11 each mention adding Rust checks to "CI". This feature owns that workflow: those checks are implemented here, in one place.
- `android/app/build.gradle.kts` hard-codes `versionCode = 1`, `versionName = "0.1.0"` (feature 12) and has no signing config.

---

## Implementation Plan

### 1. Derive the Android version from `package.json`

In `android/app/build.gradle.kts`:

```kotlin
import groovy.json.JsonSlurper

val appVersion: String = (JsonSlurper()
    .parse(rootProject.projectDir.resolve("../package.json")) as Map<*, *>)["version"] as String

// MAJOR * 10_000 + MINOR * 100 + PATCH → 0.1.4 = 104, 1.2.3 = 10203
val appVersionCode: Int = appVersion.split('.').map(String::toInt).let { (maj, min, pat) ->
    require(min < 100 && pat < 100) { "minor/patch must be < 100 for versionCode: $appVersion" }
    maj * 10_000 + min * 100 + pat
}

android {
    defaultConfig {
        versionName = appVersion
        versionCode = appVersionCode
    }
}
```

- `package.json` is already one of the three files `validate-versions` compares, so a tag can't ship an Android version different from the desktop one, and no new version check is needed.
- `versionCode` increases monotonically with semver, as Android requires for upgrades. Pre-release suffixes (e.g. `-beta.1`) are rejected by the parse. The project's tags are plain `X.Y.Z`.

### 2. Release signing config

In `android/app/build.gradle.kts`:

```kotlin
android {
    signingConfigs {
        create("release") {
            val ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }
    buildTypes {
        release {
            // Only sign when the keystore is provided (CI release job); local builds stay unsigned.
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
```

No signing material or passwords are ever written to `gradle.properties`, `local.properties` or the repository.

### 3. Pull-request workflow (`.github/workflows/android-ci.yml`)

```yaml
name: Android CI

on:
  pull_request:
    paths: ['crates/**', 'android/**', 'src-tauri/**', '.github/workflows/android-ci.yml']
  push:
    branches: [main]
    paths: ['crates/**', 'android/**', 'src-tauri/**', '.github/workflows/android-ci.yml']

concurrency:
  group: android-ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  NDK_VERSION: '28.0.13004108'
  CARGO_TERM_COLOR: always

jobs:
  rust-core:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
      - uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
        with: { components: 'rustfmt, clippy' }
      - uses: swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
        with: { workspaces: "crates/gpg-core\ncrates/gpg-core-ffi" }
      - name: Format
        run: |
          cargo fmt --manifest-path crates/gpg-core/Cargo.toml -- --check
          cargo fmt --manifest-path crates/gpg-core-ffi/Cargo.toml -- --check
      - name: Clippy
        run: |
          cargo clippy --manifest-path crates/gpg-core/Cargo.toml --all-targets -- -D warnings
          cargo clippy --manifest-path crates/gpg-core-ffi/Cargo.toml --all-targets -- -D warnings
      - name: Test
        run: |
          cargo test --manifest-path crates/gpg-core/Cargo.toml
          cargo test --manifest-path crates/gpg-core-ffi/Cargo.toml
      - name: Core has no Tauri dependency
        run: |
          if cargo tree --manifest-path crates/gpg-core/Cargo.toml | grep -i tauri; then
            echo "gpg-core must not depend on Tauri"; exit 1
          fi
      - name: Interop with gpg CLI
        run: |
          sudo apt-get install -y gnupg
          cargo test --manifest-path crates/gpg-core/Cargo.toml --features gpg-interop-tests -- interop

  android-build:
    runs-on: ubuntu-22.04
    needs: rust-core
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
      - uses: actions/setup-java@<sha> # v4
        with: { distribution: temurin, java-version: '17' }
      - uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
        with: { targets: 'aarch64-linux-android,armv7-linux-androideabi,x86_64-linux-android' }
      - uses: swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
        with: { workspaces: crates/gpg-core-ffi, key: android }
      - name: Install NDK
        run: |
          yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "ndk;$NDK_VERSION" > /dev/null
          echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$NDK_VERSION" >> "$GITHUB_ENV"
      - name: Install cargo-ndk
        run: cargo install cargo-ndk --version ^3.5 --locked
      - name: Build native libraries + bindings
        run: crates/gpg-core-ffi/build-android.sh
      - name: Verify native libraries
        run: |
          READELF="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
          for so in crates/gpg-core-ffi/dist/jniLibs/*/libgpg_core_ffi.so; do
            echo "== $so"
            if "$READELF" -d "$so" | grep NEEDED | grep -vE 'lib(c|m|dl|log)\.so'; then
              echo "unexpected native dependency"; exit 1
            fi
            if "$READELF" -lW "$so" | awk '$1=="LOAD" && $NF!="0x4000"{bad=1} END{exit !bad}'; then
              echo "LOAD segment not 16 KB aligned"; exit 1
            fi
          done
      - uses: gradle/actions/setup-gradle@<sha> # v4
      - name: Build, unit test, lint
        working-directory: android
        run: ./gradlew assembleDebug test lintDebug -Pgpglocal.skipRust=true
      - name: Verify APK alignment
        run: |
          "$ANDROID_HOME/build-tools/35.0.0/zipalign" -c -P 16 -v 4 \
            android/app/build/outputs/apk/debug/app-debug.apk > /dev/null
      - uses: actions/upload-artifact@<sha> # v4
        with: { name: gpg-core-ffi-dist, path: crates/gpg-core-ffi/dist, retention-days: 7 }
      - uses: actions/upload-artifact@<sha> # v4
        with:
          {
            name: app-debug-apk,
            path: android/app/build/outputs/apk/debug/app-debug.apk,
            retention-days: 7,
          }
      - uses: actions/upload-artifact@<sha> # v4
        if: always()
        with: { name: android-reports, path: 'android/**/build/reports/**', retention-days: 7 }

  android-instrumented:
    runs-on: ubuntu-22.04
    needs: android-build
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        api-level: [26, 35]
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
      - uses: actions/download-artifact@<sha> # v4
        with: { name: gpg-core-ffi-dist, path: crates/gpg-core-ffi/dist }
      - uses: actions/setup-java@<sha> # v4
        with: { distribution: temurin, java-version: '17' }
      - uses: gradle/actions/setup-gradle@<sha> # v4
      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
      - name: Instrumented tests
        uses: reactivecircus/android-emulator-runner@<sha> # v2
        with:
          api-level: ${{ matrix.api-level }}
          arch: x86_64
          target: ${{ matrix.api-level >= 30 && 'google_apis' || 'default' }}
          disable-animations: true
          emulator-options: -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim
          script: cd android && ./gradlew connectedDebugAndroidTest -Pgpglocal.skipRust=true
      - uses: actions/upload-artifact@<sha> # v4
        if: always()
        with:
          name: instrumented-reports-api${{ matrix.api-level }}
          path: android/**/build/reports/androidTests/**
          retention-days: 7
```

Notes:

- `<sha>` placeholders are replaced with the full commit SHA of the named major version when implementing, following the convention in `release.yml`. SHAs already used there (checkout, rust-toolchain, rust-cache) are reused as-is.
- Native libraries are built **once**, in `android-build`. The emulator jobs download `dist/` and use `-Pgpglocal.skipRust=true` (feature 12), so they need no Rust toolchain or NDK.
- `src-tauri/**` is in the path filter because a change to the desktop backend can break assumptions shared with the core (feature 10 depends on `gpg-core`).
- The **Interop with gpg CLI** step runs ignored-by-default tests behind a `gpg-interop-tests` Cargo feature, added to `gpg-core` in this feature. They shell out to `gpg --batch --symmetric` / `--decrypt` to check two-way compatibility. They are feature-gated so local `cargo test` does not require GnuPG.
- `lintDebug` uses Android Lint with `abortOnError = true` and `warningsAsErrors = false`. A `lint-baseline.xml` is committed only if pre-existing findings need to be accepted.
- Emulator jobs have `fail-fast: false` and a 45-minute timeout. If flakiness shows up, they can retry once with `nick-fields/retry`. Do not add retries pre-emptively.

### 4. Release workflow (`.github/workflows/release.yml`)

Add a job after the desktop matrix, so the GitHub Release already exists when Android uploads to it:

```yaml
android-release:
  needs: [validate-versions, build]
  runs-on: ubuntu-22.04
  permissions:
    contents: write
  env:
    NDK_VERSION: '28.0.13004108'
  steps:
    - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
    - uses: actions/setup-java@<sha> # v4
      with: { distribution: temurin, java-version: '17' }
    - uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
      with: { targets: 'aarch64-linux-android,armv7-linux-androideabi,x86_64-linux-android' }
    - name: Install NDK + cargo-ndk
      run: |
        yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "ndk;$NDK_VERSION" > /dev/null
        echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$NDK_VERSION" >> "$GITHUB_ENV"
        cargo install cargo-ndk --version ^3.5 --locked
    - uses: gradle/actions/setup-gradle@<sha> # v4
      with: { cache-read-only: true }
    - name: Decode keystore
      env: { ANDROID_KEYSTORE_BASE64: '${{ secrets.ANDROID_KEYSTORE_BASE64 }}' }
      run: |
        echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP/upload.jks"
        echo "ANDROID_KEYSTORE_PATH=$RUNNER_TEMP/upload.jks" >> "$GITHUB_ENV"
    - name: Build signed release APK
      working-directory: android
      env:
        ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
        ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
        ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
      run: ./gradlew test assembleRelease
    - name: Verify APK
      run: |
        VERSION="${GITHUB_REF_NAME#v}"
        APK=android/app/build/outputs/apk/release/app-release.apk
        BT="$ANDROID_HOME/build-tools/35.0.0"
        "$BT/apksigner" verify --verbose --print-certs "$APK"
        "$BT/zipalign" -c -P 16 -v 4 "$APK" > /dev/null
        "$BT/aapt2" dump badging "$APK" | grep -q "versionName='$VERSION'"
        OUT="GPG-Local_${VERSION}_android.apk"
        cp "$APK" "$OUT"
        sha256sum "$OUT" > "$OUT.sha256"
    - name: Attach to GitHub Release
      env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
      run: |
        VERSION="${GITHUB_REF_NAME#v}"
        gh release upload "$GITHUB_REF_NAME" \
          "GPG-Local_${VERSION}_android.apk" "GPG-Local_${VERSION}_android.apk.sha256" --clobber
    - name: Remove keystore
      if: always()
      run: rm -f "$RUNNER_TEMP/upload.jks"
```

- `needs: build` ensures `tauri-action` has created the `vX.Y.Z` release. `gh release upload` then attaches to it rather than racing to create a second release.
- `--clobber` makes re-running a failed job idempotent.
- `aapt2 dump badging` cross-checks that the APK's `versionName` equals the tag, on top of the `package.json` check in `validate-versions`.
- The release job rebuilds the native libraries from the tagged commit and does not reuse PR artifacts, so the shipped binaries come only from the tag.
- `cache-read-only: true` stops a tag build from writing to the Gradle cache that PR builds read. Rust caching is deliberately not used in the release job.

### 5. Keystore management (documented in `README.md` → "Releasing")

1. Generate the upload key once, offline:
   `keytool -genkeypair -v -keystore upload.jks -alias gpglocal -keyalg RSA -keysize 4096 -validity 10000`
2. Store `base64 -w0 upload.jks` and the passwords/alias as the four repository secrets.
3. Keep an encrypted offline backup of `upload.jks` and its passwords. **Losing the key means existing installs cannot be upgraded** to future APKs: users would have to uninstall, which deletes the app keyring. That warning goes in the README.
4. Record the certificate SHA-256 fingerprint (`apksigner verify --print-certs`) in the README, so users who sideload can verify that APKs come from the project.

### 6. Changelog and documentation

- `CHANGELOG.md`: entries keep the existing format. Android-only changes go under an `### Android` sub-heading inside the version section, so the release notes extracted by `validate-versions` cover both platforms.
- `README.md`: Android install instructions (download `GPG-Local_<version>_android.apk`, verify `.sha256`, allow installs from the browser/file manager), the signing certificate fingerprint and the Releasing section.
- `CLAUDE.md`: mention `android-ci.yml` and the release job in the Commands/CI notes, and add `@specs/features/16-android-ci.md` to the spec list.

---

## File Tree After This Feature

```
gpg-local/
├── .github/workflows/
│   ├── release.yml           # + android-release job
│   └── android-ci.yml        # ← new: rust-core, android-build, android-instrumented
├── android/app/
│   ├── build.gradle.kts      # version from package.json; env-driven release signing
│   └── lint-baseline.xml     # only if needed
├── crates/gpg-core/
│   ├── Cargo.toml            # + [features] gpg-interop-tests = []
│   └── src/tests.rs          # + interop tests (feature-gated)
├── CHANGELOG.md              # ### Android sub-heading convention
└── README.md                 # Android install, cert fingerprint, Releasing
```

---

## Security Considerations

- **Signing secrets are only available to tag builds.** They are referenced only in `release.yml` (`push: tags`), never in `android-ci.yml`. Pull requests, including from forks, never see them.
- **The keystore is on disk only during the release job**, in `$RUNNER_TEMP`, and deleted in an `always()` step. Passwords are passed through environment variables, never as command-line arguments (which can be logged) and never written to files.
- **Least-privilege tokens.** `android-ci.yml` runs with `contents: read`. Only `android-release` gets `contents: write`, which it needs to upload release assets.
- **Pinned actions.** All third-party actions are pinned to full commit SHAs, as in the existing workflow, to prevent tag-moving supply-chain attacks.
- **Release binaries are built from the tag only.** They don't reuse PR artifacts or write to shared caches. The APK signature, alignment and version are verified before upload.
- **Verifiable downloads.** Each APK ships with a SHA-256 checksum, and the README publishes the signing certificate fingerprint. Android itself enforces the same signer on upgrades.
- **Key loss is a data-loss risk for users** (an uninstall wipes the keyring), so the README documents the offline backup requirement.

---

## Acceptance Criteria

- [ ] A pull request touching `crates/**`, `android/**`, `src-tauri/**` or the workflow runs `rust-core`, `android-build` and `android-instrumented`. A PR touching only `src/**` or `specs/**` does not.
- [ ] `rust-core` fails on unformatted code, a clippy warning, a failing test in either crate, a Tauri crate in `gpg-core`'s dependency tree, or a failed `gpg` CLI interop test.
- [ ] `android-build` fails if any `libgpg_core_ffi.so` links a library other than `libc`/`libm`/`libdl`/`liblog`, has a `LOAD` segment not aligned to 16 KB, or if the APK fails `zipalign -c -P 16`.
- [ ] `android-build` runs `assembleDebug`, `test` and `lintDebug`, and uploads the native `dist/`, the debug APK and the reports.
- [ ] `android-instrumented` runs all instrumented and Compose UI tests on API 26 and API 35 x86_64 emulators without building Rust, and uploads the reports even on failure.
- [ ] A newer push to the same PR cancels the in-progress run.
- [ ] `versionName` equals `package.json` `version`, and `versionCode` follows `MAJOR*10000 + MINOR*100 + PATCH` (e.g. 0.1.4 gives 104).
- [ ] Pushing a `vX.Y.Z` tag produces a GitHub Release containing the existing desktop installers **and** `GPG-Local_X.Y.Z_android.apk` + `.sha256`.
- [ ] The released APK passes `apksigner verify` with the project certificate, is 16 KB aligned, and reports `versionName='X.Y.Z'`.
- [ ] Installing release X.Y.Z over X.Y.(Z−1) upgrades in place and keeps the app keyring.
- [ ] Re-running a failed `android-release` job succeeds without creating duplicate assets.
- [ ] No signing secret appears in `android-ci.yml`, in logs, or in the repository.
- [ ] The desktop jobs in `release.yml` behave exactly as before.
