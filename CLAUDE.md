# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@specs/features/01-tauri-wrapper.md
@specs/features/02-gpg-library.md
@specs/features/03-file-browse.md
@specs/features/04-encrypt-file.md

## Project motivation

GPG Local is a desktop application that provides a graphical interface for encrypting and decrypting local files using GPG. The goal is to make GPG key management and file operations accessible without requiring command-line knowledge, distributed as a native desktop binary on Windows, macOS, and Linux.

The delivery mechanism is **Tauri 2**: a Rust-based shell (`src-tauri/`) that hosts the React UI in the OS's native WebView, giving the app access to the local filesystem and the ability to invoke the `gpg` binary directly. The UI layer (React + Vite) is intentionally kept framework-agnostic so it can also run in a browser during development and testing.

## Architecture

```
gpg-local/
├── src/
│   ├── main.tsx          # Application entry point — mounts React root
│   ├── App.tsx           # Root component
│   ├── App.css           # Root component styles
│   ├── index.css         # Global styles
│   ├── assets/           # Static assets (images, SVGs)
│   └── test/
│       └── setup.ts      # Vitest global test setup
├── src-tauri/
│   ├── Cargo.toml        # Rust crate manifest
│   ├── build.rs          # Tauri build script
│   ├── tauri.conf.json   # Tauri configuration (window, bundle, CSP)
│   ├── capabilities/     # Tauri permission scopes
│   ├── icons/            # App icons for all platforms (generated)
│   └── src/
│       ├── main.rs       # Tauri entry point
│       └── lib.rs        # Command registrations
├── e2e/
│   └── app.spec.ts       # Playwright end-to-end tests
├── public/               # Static files served as-is (favicon, icon sprites)
├── dist/                 # Production web build output (generated)
├── index.html            # HTML entry point
├── vite.config.ts        # Vite + Vitest configuration
├── playwright.config.ts  # Playwright configuration
├── tsconfig.json         # TypeScript project references root
├── tsconfig.app.json     # TypeScript config for application source
├── tsconfig.node.json    # TypeScript config for build tooling (vite.config.ts)
└── eslint.config.js      # ESLint configuration
```

The UI layer is a Vite + React 19 SPA (`src/`). `src/main.tsx` mounts the React root; `src/App.tsx` is the root component. There is no router or state management library yet — the component tree is flat at this stage.

The Tauri core (`src-tauri/`) wraps the UI in an OS-native window. In development, Tauri points at the Vite dev server (`http://localhost:5173`). In production, it serves the compiled `dist/` output. GPG invocations will be wired as Tauri commands in `src-tauri/src/lib.rs` (tracked separately).

`vite.config.ts` doubles as the Vitest config: unit tests run in jsdom, use Vitest globals, and are picked up from `src/**/*.{test,spec}.{ts,tsx}`. The test setup file (`src/test/setup.ts`) imports `@testing-library/jest-dom` matchers globally.

Playwright e2e tests live in `e2e/` and target `http://localhost:5173`. The Playwright config starts the Vite dev server automatically when running locally (`reuseExistingServer: true`), so `pnpm dev` does not need to be running beforehand.

## Commands

```bash
pnpm dev                # Vite dev server with HMR at http://localhost:5173
pnpm dev:tauri          # Vite dev server + native Tauri desktop window
pnpm build              # Type-check + web build → dist/
pnpm build:tauri        # Web build + Rust compile + platform installers
pnpm preview            # Serve dist/ locally
pnpm lint               # ESLint

pnpm test               # Vitest unit tests (watch mode)
pnpm test:coverage      # Vitest with v8 coverage report
pnpm test:e2e           # Playwright e2e (auto-starts dev server)
pnpm test:e2e:ui        # Playwright interactive UI
```

Run a single unit test file:

```bash
pnpm vitest run src/App.test.tsx
```

Run a single Playwright test by title:

```bash
pnpm playwright test --grep "homepage loads"
```
