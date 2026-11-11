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
- `src/App.tsx`: feed and profile views with local demo state.
- `src/components/`: post composer, title artwork, and accessible dialogs.
- `src/data/`: typed mock fixtures and local storage validation.
- `src/index.css`: global styles and focus treatment.
- `src/App.css`: application styles.
- `public/`: static assets.

## Social prototype

The frontend includes Following/Public feeds, public profiles, follow/unfollow controls, and a post composer with title search, 1–5 star ratings, and optional reviews. Users can edit or delete their own demo posts. My Profile also saves country and streaming-service preferences.

All users, reviews, and catalog entries are fixtures. Demo state persists in localStorage under `odinstream-social-demo-v1`; **Reset demo** restores the fixtures. When storage is unavailable, the app works for the session and reports that in the footer. Original CSS poster concepts require no external image service.

This prototype has no backend, real authentication, database connection, live TMDB requests, or recommendation algorithm. Ownership checks in the UI demonstrate the intended experience; actual authentication and authorization must be enforced by FastAPI when integrated. Discover and My Library are separate feature work.

Navigation is encoded in the URL hash. Refresh and browser Back/Forward retain the selected feed or profile and Following/Public tab.
