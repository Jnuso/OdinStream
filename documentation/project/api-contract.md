# OdinStream API contract

**Status: working implementation contract for the local backend integration branch.** This records the interfaces currently used by Medha's backend and frontend plus the setup, privacy and progress changes on this branch. It is for team review before merging. It does not claim that this branch has been deployed or that every proposed feature has been completed.

We kept the existing frontend-compatible routes and shapes rather than renaming them solely to match the earlier proposal. Remaining gaps and deliberate tradeoffs are listed below. Supabase handles signup, confirmation, sign-in, password recovery and session refresh; the browser sends its access token to FastAPI as `Authorization: Bearer <token>`. Catalog routes are public unless noted. All other routes below require a completed account setup and a verified token; setup and account deletion are exceptions. IDs are UUIDs for app records and numeric TMDB IDs paired with `movie` or `tv`.

## Errors

Application errors return `{"error":"code", "message":"Readable message"}`. Validation errors use the same fields plus `"details": [{"field":"query.page", "message":"..."}]`. This preserves the existing frontend's use of `message`. `401` means authentication failed; `403` means access is forbidden or setup is incomplete; `404` means the resource or verified TMDB title does not exist; `409` means a conflict; `422` means invalid input; `429`, `502` and `503` can indicate upstream limits or failures. A catalog outage must not be treated as a missing title or create an unverified saved item or post. Framework HTTP errors use the same top-level fields with code `http_error`; unexpected server failures are not yet standardized.

## Catalog and search

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/catalog/search?query=...&page=1` | Public TMDB multi-search. `items` contains movies and TV only; `page` and `total_pages` are TMDB search pages. |
| GET | `/api/me/catalog/search?query=...&page=1` | Signed-in search filtered to titles included with the user's selected services in the US. Requires at least one saved service. |
| GET | `/api/catalog/{movie_or_tv}/{tmdb_id}` | Public title metadata, seasons, and US streaming, rental, and purchase providers. |
| GET | `/api/catalog/tv/{tmdb_id}/seasons/{season_number}` | Public episode metadata. |

Search item fields are `id`, `media_type`, `name`, `release_date`, `overview`, and `poster_path`. A filtered search checks subscription (`flatrate`) availability for results on each TMDB search page. Its page counts describe the unfiltered search, so a filtered page can be empty even when later pages contain matches. Missing US provider data excludes a title from filtered results; lookup failures return an error instead of silently hiding results. Search normally shows all titles, regardless of services. Availability may be incomplete or change, and displayed availability is not a guarantee.

## Accounts and setup

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/me/setup` | Returns `{"setup_complete": boolean}`; available before setup. |
| PUT | `/api/me/setup` | Requires `username` and `visibility`; accepts optional `favorite_genres` and `streaming_services` arrays. Saves all in one transaction. |
| GET | `/api/me` | Returns the verified owner's `id` and `email`. |
| GET / PUT | `/api/me/preferences` | Gets or replaces `favorite_genres` and `streaming_services`, currently arrays of supported display names. |
| DELETE | `/api/me` | Accepts `{"password":"..."}`, reauthenticates and requests deletion from Supabase Auth. Returns 204 only on success. |

New users must explicitly choose public/private and a unique username before accessing signed-in app features. Usernames preserve case but are unique case-insensitively; they allow 3–30 ASCII letters, digits, dots or underscores. Incomplete profiles are private and hidden. Existing accounts keep their visibility when migrated. Account deletion is locally tested with mocked Supabase calls and still needs an end-to-end hosted test and external-data review.

## Library and episodes

`GET /api/me/saved-titles` returns `{"items":[...]}` with optional `media_type` and `status` filters. It uses `limit` (default 20, maximum 50) and `offset`, returns `next_offset` (or null), and orders by creation time, newest first. Each item contains `id`, `media_type`, `tmdb_id`, `status`, `created_at`, and `updated_at`; the frontend loads metadata separately. A metadata outage must not remove saved records.

`POST /api/me/saved-titles` accepts `media_type`, `tmdb_id`, and `status`; it verifies the title with TMDB and returns 201. `PATCH /api/me/saved-titles/{id}` changes status and returns 200. `DELETE /api/me/saved-titles/{id}` returns 204. Movies allow `watchlist`, `watched`; TV allows `watchlist`, `watching`, `completed`, `paused`, `dropped`. Any valid transition is allowed; an owner cannot access another user's entry.

| Method | Route below `/api/me/saved-titles/{id}` | Behavior |
| --- | --- | --- |
| GET | `/episodes` | Returns `items` of `{season_number, episode_number}` and `last_watched` (or null). |
| PUT / DELETE | `/seasons/{season}/episodes/{episode}` | Mark or unmark an episode, returning 204. |
| PUT / DELETE | `/seasons/{season}/episodes` | Mark or clear an entire season, returning 204. |

Adding watched marks verifies the episodes with TMDB; removing marks works without TMDB. Progress survives removing and re-adding a show and is removed with the account. The most recently marked episode is last watched; unmarking it falls back to the most recent remaining mark. Bulk-marking a season makes its final episode most recent. The frontend computes the following episode from metadata and reports when it cannot do so.

## Profiles, posts, and feeds

`GET /api/me/profile` and `GET /api/profiles/{id}` return a profile containing `id`, `display_name`, `handle`, `bio`, `visibility`, counts, `viewer_follows`, `viewer_requested`, and `can_view_posts`. `PATCH /api/me/profile` replaces display name, handle, and bio. `PATCH /api/me/profile/visibility` accepts `{"visibility":"public"}` or `"private"`.

`GET /api/profiles` returns suggested profiles with `limit` (default 5, maximum 20). `GET /api/profiles/{id}/posts` returns `items` and uses `limit` (default 30, maximum 50) and `offset`. Unauthorized access to private profile posts returns 403.

`PUT /api/profiles/{id}/follow` follows a public profile or requests to follow a private one; `DELETE` on the same route unfollows or cancels. Both return 204. Inspect the profile's relationship fields to see the resulting state. `GET /api/me/follow-requests` lists incoming requests with `limit` (default 20, maximum 50), `offset`, and `next_offset`; `POST /api/me/follow-requests/{requester_id}/approve` and `/decline` resolve them; `DELETE /api/me/followers/{user_id}` removes a follower. Resolution/removal returns 204. When a private profile becomes public, pending requests are approved; changing to private retains existing followers.

`GET /api/feed?scope=public|following` returns `items`, with `limit` (default 30, maximum 50) and `offset`, newest first. Private posts never appear in the public feed. `GET /api/titles/{media_type}/{tmdb_id}/posts` returns up to 30 visible posts. `POST` on that route verifies the title and creates a post from `rating` and optional `review`; `PATCH /api/posts/{id}` updates those fields and `DELETE /api/posts/{id}` removes it. Ratings are 0.5–5 in half-star increments and reviews are at most 2,000 characters. Posts contain title snapshots and an `author` object; a user can create one post per title.

## Recommendations and health

`GET /api/me/recommendations?limit=12` returns `{"items":[...], "basis":"genres"|"popular"}`. The current simple rules use favorite genres and exclude watched movies and completed/dropped shows; without favorite genres, popular titles are used. This endpoint does **not** yet account for selected services. The optional search filter above is separate.

`GET /health` returns `{"status":"ok"}` and verifies only the API process, not database, Auth, or TMDB connectivity.

## Remaining integration work

- Review these choices with the team and update both frontend and backend together if interfaces change. The frontend still needs follow-request management and account-deletion screens.
- Cursor pagination from the original proposal is not implemented. Feed, profile posts, saved titles, and incoming follow requests use offset pagination and return `next_offset` (or null). Offsets are simple for this MVP but concurrent inserts or deletions can shift later pages. The frontend currently exposes page navigation for search, library and feed; profile post and follow-request navigation still need UI work.
- The original proposal's standalone genre/provider endpoints, rich `/progress` summary, direct single-post GET, follower listing, and provider-aware recommendations are not implemented. The current episode endpoint returns raw marks and the frontend computes the next episode.
- Availability lookup currently uses saved service mappings and US data only. Review mappings and test against live TMDB/JustWatch before relying on them.
- Full hosted authentication, migrations, role permissions, deletion, failures, and cross-user behavior remain to be verified with disposable accounts. The development migration workflow applies changes on qualifying merges to main.
