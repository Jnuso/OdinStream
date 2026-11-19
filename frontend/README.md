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

Open the local URL printed by Vite. During local development, Discover calls the FastAPI backend at `http://127.0.0.1:8000` by default; production builds default to the same origin. Set `VITE_API_BASE_URL` to the backend origin if different; use HTTPS outside local development. Configure the backend's TMDB token as described in `backend/README.md`. For account and library features, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in an ignored `frontend/.env.local` file and restart Vite. Use only the public/publishable key, never a service-role or secret key. Configure the frontend origin in Supabase Auth's redirect allow-list; email confirmation and password reset require email delivery.

## Checks and production preview

```sh
npm run lint
npm test
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

Discover, My Library, and Account preferences use FastAPI and Supabase Auth when configured. The social prototype remains separate: its accounts, posts, and preferences are fixtures with local-only state, not authenticated social data. Actual social authorization must be enforced by FastAPI when integrated. Recommendations remain future work.

Navigation is encoded in the URL hash. Refresh and browser Back/Forward retain the selected feed or profile and Following/Public tab.
