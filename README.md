# GPG Local

GPG Local is a desktop application that provides a GUI for encrypting and decrypting local files using GPG.

## Architecture

```
src/           React + TypeScript UI (Vite bundled)
e2e/           Playwright end-to-end tests (run against Vite dev server)
public/        Static assets served as-is (SVG icon sprite)
```

**Stack:**

| Layer | Technology |
|---|---|
| UI framework | React 19 |
| Language | TypeScript 6 |
| Bundler / dev server | Vite 8 |
| Unit / component tests | Vitest 4 + Testing Library |
| End-to-end tests | Playwright |
| Package manager | pnpm |

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) — `npm install -g pnpm`
- [GPG](https://gnupg.org/) installed and available on `PATH`

## Install dependencies

```bash
pnpm install
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start the development server with HMR at `http://localhost:5173` |
| `pnpm build` | Type-check and produce an optimised production build in `dist/` |
| `pnpm preview` | Serve the production build locally for final verification |
| `pnpm lint` | Run ESLint across all source files |
| `pnpm test` | Run unit tests in watch mode (Vitest) |
| `pnpm test:ui` | Open the Vitest browser UI |
| `pnpm test:coverage` | Run unit tests and generate a coverage report |
| `pnpm test:e2e` | Run Playwright end-to-end tests (requires `pnpm dev` running) |
| `pnpm test:e2e:ui` | Open the Playwright interactive UI |

## License

MIT — see [LICENSE](LICENSE).
