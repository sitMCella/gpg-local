# GPG Local

GPG Local is a desktop application that provides a GUI for encrypting and decrypting local files using GPG.

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
├── e2e/
│   └── app.spec.ts       # Playwright end-to-end tests
├── public/               # Static files served as-is (favicon, icon sprites)
├── dist/                 # Production build output (generated)
├── index.html            # HTML entry point
├── vite.config.ts        # Vite + Vitest configuration
├── playwright.config.ts  # Playwright configuration
├── tsconfig.json         # TypeScript project references root
├── tsconfig.app.json     # TypeScript config for application source
├── tsconfig.node.json    # TypeScript config for build tooling (vite.config.ts)
└── eslint.config.js      # ESLint configuration
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
