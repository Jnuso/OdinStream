# Live TMDB API checks

These read-only smoke tests check movie and TV search, title details, season episodes, country-specific watch-provider response structure, Breaking Bad US subscription providers, and retrieval of its poster image. Watch-provider information comes from TMDB's JustWatch-powered endpoints; no separate JustWatch API is used. Availability varies, so the tests do not require a particular provider or country to be present. They do not test Odin Stream's own backend, which has not yet been implemented on main.

1. Install Python 3. No third-party Python packages are required.
2. Obtain a TMDB **API Read Access Token** from https://developer.themoviedb.org/docs/getting-started.
3. Copy `.env.example` to `.env` in the project root if `.env` does not exist. Set `TMDB_READ_ACCESS_TOKEN` in `.env` to your token (no spaces around `=`). The API key is optional and is not used by these tests.
4. From the project root run:

```powershell
python -m unittest discover -s tests -p 'test_tmdb_live.py' -v
```

The local `.env` is ignored by Git. Keep credentials private and never commit them or paste them into chat. The test uses the token in `.env` first and falls back to `TMDB_READ_ACCESS_TOKEN` in the environment. It prints each request and a concise summary of the response, without printing credentials. Without a token, checks are skipped, not passed. Tests make live network requests and can fail if credentials, connectivity, rate limits, or TMDB data change. TMDB requires JustWatch attribution when its watch-provider data is displayed: https://developer.themoviedb.org/reference/tv-series-watch-providers
