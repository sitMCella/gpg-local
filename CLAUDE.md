# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project motivation

GPG Local is a desktop application that provides a graphical interface for encrypting and decrypting local files using GPG. The goal is to make GPG key management and file operations accessible without requiring command-line knowledge, distributed as a native desktop binary on Windows, macOS, and Linux.

The planned delivery mechanism is **Tauri 2** (see `01-tauri-wrapper.md`): a Rust-based shell that hosts the React UI in the OS's native WebView, giving the app access to the local filesystem and the ability to invoke the `gpg` binary directly. The UI layer (React + Vite) is intentionally kept framework-agnostic so it can also run in a browser during development and testing.

## Architecture

```
src/           React + TypeScript UI (Vite bundled)
e2e/           Playwright end-to-end tests (run against Vite dev server)
public/        Static assets served as-is (SVG icon sprite)
```

The application is a standard Vite + React 19 SPA. `src/main.tsx` mounts the React root; `src/App.tsx` is the root component. There is no router or state management library yet — the component tree is flat at this stage.

`vite.config.ts` doubles as the Vitest config: unit tests run in jsdom, use Vitest globals, and are picked up from `src/**/*.{test,spec}.{ts,tsx}`. The test setup file (`src/test/setup.ts`) imports `@testing-library/jest-dom` matchers globally.

Playwright e2e tests live in `e2e/` and target `http://localhost:5173`. The Playwright config starts the Vite dev server automatically when running locally (`reuseExistingServer: true`), so `pnpm dev` does not need to be running beforehand.

## Commands

```bash
pnpm dev                # Vite dev server with HMR at http://localhost:5173
pnpm build              # Type-check + production build → dist/
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
