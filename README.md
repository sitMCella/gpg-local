# GPG Local

![GPG Local](https://github.com/sitMCella/gpg-local/wiki/images/gpg-local.png)

GPG Local is a desktop application that provides a GUI for encrypting and decrypting local files using GPG. It ships as a native binary on Windows, macOS, and Linux via [Tauri 2](https://tauri.app/), with a React + Vite UI that can also run in a browser during development.

## Documentation

For installation instructions, usage guides, and troubleshooting, see the [Wiki](https://github.com/sitMCella/gpg-local/wiki).

## Architecture

```
src/           React + TypeScript UI (Vite bundled)
src-tauri/     Tauri 2 Rust core (window, OS integration, GPG invocation)
e2e/           Playwright end-to-end tests (run against Vite dev server)
public/        Static assets served as-is (SVG icon sprite)
```

**Stack:**

| Layer                  | Technology                   |
| ---------------------- | ---------------------------- |
| Desktop shell          | Tauri 2 (Rust)               |
| UI framework           | React 19                     |
| Language               | TypeScript 6 / Rust (stable) |
| Bundler / dev server   | Vite 8                       |
| Unit / component tests | Vitest 4 + Testing Library   |
| End-to-end tests       | Playwright                   |
| Package manager        | pnpm                         |

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) — `npm install -g pnpm`
- [Rust](https://rustup.rs/) (stable toolchain via `rustup`)
- [GPG](https://gnupg.org/) installed and available on `PATH`

**Platform build dependencies:**

- **macOS** — Xcode Command Line Tools (`xcode-select --install`)
- **Windows** — WebView2 runtime + Visual Studio Build Tools ("Desktop development with C++")
- **Linux (Debian/Ubuntu)** —
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

## Install dependencies

```bash
pnpm install
```

## Commands

| Command              | Description                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Start the Vite dev server only (browser at `http://localhost:5173`)                          |
| `pnpm dev:tauri`     | Start Vite dev server + open the native Tauri desktop window                                 |
| `pnpm build`         | Type-check and produce a web build in `dist/`                                                |
| `pnpm build:tauri`   | Web build + compile Rust + produce platform installers in `src-tauri/target/release/bundle/` |
| `pnpm preview`       | Serve the production web build locally                                                       |
| `pnpm lint`          | Run ESLint across all source files                                                           |
| `pnpm format`        | Format all source files with Prettier                                                        |
| `pnpm test`          | Run unit tests in watch mode (Vitest)                                                        |
| `pnpm test:ui`       | Open the Vitest browser UI                                                                   |
| `pnpm test:coverage` | Run unit tests and generate a coverage report                                                |
| `pnpm test:e2e`      | Run Playwright end-to-end tests (auto-starts Vite dev server)                                |
| `pnpm test:e2e:ui`   | Open the Playwright interactive UI                                                           |

## Android

Each GitHub Release also contains a signed Android APK (Android 8.0 / API 26 or newer).

1. Download `GPG-Local_<version>_android.apk` and `GPG-Local_<version>_android.apk.sha256` from the [Releases](https://github.com/sitMCella/gpg-local/releases) page.
2. Verify the checksum: `sha256sum -c GPG-Local_<version>_android.apk.sha256` (macOS: `shasum -a 256 -c …`).
3. Open the APK on the device and allow installs from your browser or file manager when Android asks.

Optionally check the signer before installing (`apksigner` ships with the Android SDK build-tools):

```bash
apksigner verify --print-certs GPG-Local_<version>_android.apk
```

The `Signer #1 certificate SHA-256 digest` must equal:

```
<to be filled in when the upload keystore is created>
```

Android refuses to upgrade an installed app with an APK signed by a different key, so every future release keeps this signer.

## Releasing a new version

Releases are published automatically by the [Release workflow](.github/workflows/release.yml) when a version tag is pushed. The workflow builds platform installers for macOS (Apple Silicon + Intel), Windows, and Linux, then attaches them to a GitHub Release. After the desktop jobs finish, the `android-release` job builds a signed release APK from the same tag and attaches `GPG-Local_<version>_android.apk` and its `.sha256` checksum to that release.

The Android `versionName` is read from `package.json`, and `versionCode` is `MAJOR * 10000 + MINOR * 100 + PATCH` (e.g. `0.1.4` → `104`), so minor and patch must stay below 100. Android-only changes go under an `### Android` sub-heading in the version's `CHANGELOG.md` section.

### Steps

**1. Bump the version in all three manifests** — they must all agree or the workflow will fail:

| File                        | Field       |
| --------------------------- | ----------- |
| `package.json`              | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml`      | `version`   |

**2. Commit and merge to `main`:**

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to 0.2.0"
# open a PR and merge to main
```

**3. Push the version tag:**

```bash
git tag v0.2.0
git push origin v0.2.0
```

Pushing the tag triggers the release workflow. Once all four build jobs complete, the installers are attached to a new GitHub Release tagged `v0.2.0`, followed by the Android APK.

### Android signing key

The release APK is signed with an upload key held only in repository secrets. Create it once, offline:

```bash
keytool -genkeypair -v -keystore upload.jks -alias gpglocal \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then add these repository secrets (Settings → Secrets and variables → Actions):

| Secret                      | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | output of `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password                                                 |
| `ANDROID_KEY_ALIAS`         | `gpglocal`                                                        |
| `ANDROID_KEY_PASSWORD`      | key password                                                      |

Record the certificate SHA-256 fingerprint (`apksigner verify --print-certs` on the first signed APK, or `keytool -list -v -keystore upload.jks`) in the [Android](#android) section above.

> **Keep an encrypted offline backup of `upload.jks` and its passwords.** If the key is lost, installed apps cannot be upgraded to newer APKs. Users would have to uninstall first, which deletes the app's keyring and every secret key in it.

Local `./gradlew assembleRelease` builds stay unsigned: signing is enabled only when `ANDROID_KEYSTORE_PATH` is set, which only the release workflow does.

## License

MIT — see [LICENSE](LICENSE).
