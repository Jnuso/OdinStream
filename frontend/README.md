# OdinStream frontend

React with TypeScript and Vite.

## Prerequisites

Node.js 22.12+ and npm. Use a supported Node LTS release.

## Development

From this directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No API keys or environment variables are required for the app shell.

## Checks and production preview

```sh
npm run lint
npm run build
npm run preview
```

The build runs TypeScript checking and writes production assets to `dist/`. Both `dist/` and `node_modules/` are ignored by Git.

## Structure

- `src/main.tsx`: React entry point.
- `src/App.tsx`: application shell.
- `src/index.css`: global styles and focus treatment.
- `src/App.css`: application styles.
- `public/`: static assets.

The backend and database are separate work; this scaffold does not connect to them.
