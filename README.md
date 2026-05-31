# GPG Local

GPG Local is a desktop application that provides a GUI for encrypting and decrypting local files using GPG. It ships as a native binary on Windows, macOS, and Linux via [Tauri 2](https://tauri.app/), with a React + Vite UI that can also run in a browser during development.

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

## Releasing a new version

Releases are published automatically by the [Release workflow](.github/workflows/release.yml) when a version tag is pushed. The workflow builds platform installers for macOS (Apple Silicon + Intel), Windows, and Linux, then attaches them to a GitHub Release.

### Steps

**1. Bump the version in all three manifests** — they must all agree or the workflow will fail:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |

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

Pushing the tag triggers the release workflow. Once all four build jobs complete, the installers are attached to a new GitHub Release tagged `v0.2.0`.

## License

MIT — see [LICENSE](LICENSE).
