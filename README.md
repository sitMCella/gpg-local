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

## License

MIT — see [LICENSE](LICENSE).
