# Feature: Tauri Desktop Wrapper

Wrap the existing React + Vite application in [Tauri 2](https://tauri.app/) so it ships as a native desktop binary on **Windows**, **macOS**, and **Linux**, while keeping the web-stack (React, Vite, TypeScript) unchanged as the UI layer.

---

## Motivation

GPG Local is a file-encryption tool that needs direct access to the host OS: reading/writing files, spawning the `gpg` binary, and accessing the user's keyring. Running it as a native desktop application via Tauri provides:

- A proper OS window with native title bar and menu.
- Access to the local filesystem and the ability to invoke `gpg` as a sidecar command through Tauri's shell API.
- Single-file distributable installers per platform (`.msi` on Windows, `.dmg` / `.app` on macOS, `.AppImage` / `.deb` / `.rpm` on Linux).
- No Electron overhead — Tauri uses the OS's native WebView and a minimal Rust core.

---

## Goals

1. Add a Tauri 2 Rust core to the repository alongside the existing `src/` React code.
2. The Vite dev server remains the UI source for `tauri dev`; the production build feeds `tauri build`.
3. All three platforms can be built from their respective CI environments without code changes.
4. Existing unit tests (Vitest) and e2e tests (Playwright) continue to pass without modification.

---

## Out of Scope

- Migrating GPG invocations to Tauri commands (tracked separately — that is the next feature after the wrapper is in place).
- Code-signing and notarization (tracked separately).
- Auto-updater configuration.

---

## Prerequisites

| Requirement             | Notes                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| Rust toolchain (stable) | Install via `rustup`                                                      |
| `cargo`                 | Included with Rust                                                        |
| Tauri CLI v2            | `cargo install tauri-cli --version "^2"` or `pnpm add -D @tauri-apps/cli` |
| Platform build deps     | See platform notes below                                                  |

### Platform-specific build dependencies

**macOS** — Xcode Command Line Tools (`xcode-select --install`).

**Windows** — WebView2 runtime (pre-installed on Windows 10 21H2+), Visual Studio Build Tools with the "Desktop development with C++" workload.

**Linux (Debian/Ubuntu)** —

```bash
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## Implementation Plan

### 1. Initialise the Tauri project

Run inside the repository root (where `package.json` lives):

```bash
pnpm tauri init
```

Answer the prompts:

- **App name:** `GPG Local`
- **Window title:** `GPG Local`
- **Web assets path:** `../dist` (relative to the `src-tauri/` directory Tauri will create)
- **Dev server URL:** `http://localhost:5173`
- **Dev command:** `pnpm dev`
- **Build command:** `pnpm build`

This scaffolds `src-tauri/` with:

```
src-tauri/
├── Cargo.toml          # Rust crate manifest
├── Cargo.lock
├── build.rs
├── icons/              # App icons (replace with project assets)
└── src/
    ├── main.rs         # Tauri entry point
    └── lib.rs          # Command registrations (initially empty)
```

### 2. Update `package.json` scripts

Add Tauri-specific scripts alongside the existing ones:

```json
"tauri": "tauri",
"dev:tauri": "tauri dev",
"build:tauri": "tauri build"
```

### 3. Update `vite.config.ts`

Tauri expects the dev server on a fixed port and needs no automatic browser opening:

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    open: false, // Tauri opens its own window
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext', // Tauri ships a modern WebView
  },
})
```

### 4. Update `.gitignore`

Append Rust / Tauri build artefacts:

```
# Tauri
src-tauri/target/
```

### 5. Configure `src-tauri/tauri.conf.json`

Key settings to verify after `tauri init`:

```json
{
  "productName": "GPG Local",
  "version": "0.1.0",
  "identifier": "com.gpglocal.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [
      {
        "title": "GPG Local",
        "width": 1024,
        "height": 768,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 6. Generate application icons

Replace the default Tauri icons with project-specific assets. Tauri provides a helper:

```bash
pnpm tauri icon public/icons.svg
```

This generates all required sizes under `src-tauri/icons/`.

### 7. Update `tsconfig.app.json`

Add the Tauri JS bindings type declarations so TypeScript resolves `@tauri-apps/api`:

```json
{
  "compilerOptions": {
    "types": ["@tauri-apps/api"]
  }
}
```

Install the bindings package:

```bash
pnpm add @tauri-apps/api
```

### 8. Verify the development workflow

```bash
pnpm dev:tauri
```

A native desktop window should open rendering the React UI. Hot-module replacement from Vite should work inside the Tauri window.

### 9. Verify the production build

```bash
pnpm build:tauri
```

Installers are written to `src-tauri/target/release/bundle/`.

---

## File Tree After Integration

```
gpg-local/
├── src/                    # React source (unchanged)
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs
│   ├── icons/
│   └── src/
│       ├── main.rs
│       └── lib.rs
├── public/
├── e2e/
├── index.html
├── package.json            # + tauri scripts
├── vite.config.ts          # + port / open / target settings
├── tauri.conf.json         # (symlinked or co-located per Tauri 2 conventions)
└── ...
```

---

## Updated Commands Reference

| Command            | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `pnpm dev`         | Start the Vite dev server only (browser)                     |
| `pnpm dev:tauri`   | Start Vite dev server + open Tauri desktop window            |
| `pnpm build`       | Production web build only (outputs `dist/`)                  |
| `pnpm build:tauri` | Production web build + compile Rust + produce installers     |
| `pnpm test`        | Vitest unit tests (unchanged)                                |
| `pnpm test:e2e`    | Playwright e2e tests against the Vite dev server (unchanged) |

---

## CI / CD Considerations

Native installers must be compiled on the target OS. A GitHub Actions matrix strategy covers all three platforms:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
runs-on: ${{ matrix.os }}
```

Each job installs Rust, platform build deps, Node, pnpm, then runs `pnpm build:tauri`. Artefacts (installers) are uploaded per platform.

---

## Acceptance Criteria

- [ ] `pnpm dev:tauri` opens a native desktop window on macOS, Windows, and Linux.
- [ ] `pnpm build:tauri` produces a runnable installer on each platform without errors.
- [ ] The existing `pnpm test` and `pnpm test:e2e` suites pass without modification.
- [ ] No secrets or build artefacts (`src-tauri/target/`) are committed to the repository.
