# OdinStream MVP API contract

**Status: working proposal for team review, November 17, 2026.** This document describes the intended interface, not completed functionality. The group should review the decisions and open questions before treating the contract as final. The [Figma sketches](https://www.figma.com/design/ma8S3CmWx675i5hsZFCk2k) are the initial UI direction and can evolve independently. The [saved-title design](database/saved-title-design.md) provides background; this document proposes the broader contract and supersedes its unresolved API examples where they differ.

## Conventions

- FastAPI serves JSON under `/api`, except the existing `/health` endpoint. Fields use `snake_case`; timestamps are UTC ISO 8601; internal IDs are UUID strings. TMDB title IDs are positive integers paired with `media_type` (`movie` or `tv`).
- Public catalog endpoints allow visitors. All `/api/me`, posts, profiles, feeds, and recommendations require a Supabase bearer access token in `Authorization: Bearer <token>`. FastAPI verifies signature, issuer, audience and expiration and derives identity from the token. A client-supplied user ID is never proof of ownership.
- React uses Supabase Auth for registration, email verification, sign-in, sign-out, password reset and session refresh. Only publishable credentials may be used in the browser; service-role and TMDB credentials stay on the server. Auth error and session handling must be tested with the selected Supabase client.
- Non-owners cannot mutate account-owned records. Return `404` for a missing or inaccessible owned record, without revealing whether another user's record exists. Private profile posts return `403 PROFILE_PRIVATE` to a signed-in non-follower; an inaccessible individual post returns `404`.
- List endpoints for app-owned records use `?limit=20&cursor=...`, maximum 50. Return `{ "items": [], "next_cursor": null }`; cursors are opaque. Stable ordering uses the specified timestamp and ID as a tie-breaker. TMDB search uses page numbers instead.
- `POST` creation returns `201` and the object, updates return `200` and the object, and deletes return `204` with no body unless specified below. Omitted PATCH fields are unchanged; explicit `null` clears nullable fields. Empty collections are successful responses.

### Errors

All FastAPI errors, including validation errors, use the following envelope; `details` is `null` or an array of `{ "field": "status", "message": "Invalid status." }`:

```json
{ "error": { "code": "TITLE_NOT_FOUND", "message": "This title could not be found.", "details": null } }
```

Use `400` for malformed requests, `401` for missing/invalid/expired authentication, `403` for forbidden actions, `404` for missing/inaccessible resources, `409` for conflicts, `422` for validation, `429` for rate limiting, `500` for unexpected failures, `502` for invalid or unsuccessful upstream responses, `503` for unavailable upstream services, and `504` for upstream timeouts. Include `Retry-After` with `429` when known. Do not expose secrets or internal errors. Distinguish a title confirmed absent from TMDB from an upstream outage.

## Shared objects

`TitleSummary`:

```json
{ "media_type": "tv", "tmdb_id": 1396, "title": "Example show", "original_title": null, "poster_url": null, "release_date": "2020-01-01", "overview": null }
```

`original_title`, `poster_url`, `release_date`, and `overview` may be null. Images are URLs; the frontend handles absent images. Metadata is informational and must not be required to retain a saved record.

`UserSummary`:

```json
{ "id": "2b2c8152-71a5-4ea2-a290-571d5e9a6c7c", "username": "example_user", "display_name": "Example User", "avatar_url": null }
```

`SavedTitle`:

```json
{ "id": "a5a4d9ea-c10f-458b-a89e-4ed85d78c8fa", "media_type": "tv", "tmdb_id": 1396, "status": "watching", "created_at": "2026-11-17T12:00:00Z", "updated_at": "2026-11-17T12:00:00Z", "title": null }
```

`title` is a `TitleSummary` when available, otherwise null. A TMDB outage must not hide or delete saved records.

`Post`:

```json
{ "id": "6d53f985-8adb-4bb1-93df-5724d4713578", "author": { "id": "2b2c8152-71a5-4ea2-a290-571d5e9a6c7c", "username": "example_user", "display_name": "Example User", "avatar_url": null }, "media_type": "movie", "tmdb_id": 550, "title": null, "rating": 4.5, "review": "Optional review.", "created_at": "2026-11-17T12:00:00Z", "updated_at": "2026-11-17T12:00:00Z" }
```

`title` and `review` may be null. Email and private preferences are never included in public-facing objects.

## Catalog and Discover — public

### Search

`GET /api/titles/search?query=example&page=1&media_type=all`

`query` is required and nonblank; `page` is a positive integer, default 1; `media_type` is `all` (default), `movie`, or `tv`. Returns `200`:

```json
{ "items": [{ "media_type": "movie", "tmdb_id": 550, "title": "Example", "original_title": null, "poster_url": null, "release_date": null, "overview": null }], "page": 1, "total_pages": 1 }
```

No matches returns an empty `items` array. Blank input returns `422`. Only movie and TV results are returned.

### Title details and episodes

`GET /api/titles/{media_type}/{tmdb_id}` returns `200`:

```json
{ "media_type": "tv", "tmdb_id": 1396, "title": "Example show", "original_title": null, "overview": null, "poster_url": null, "backdrop_url": null, "release_date": null, "runtime_minutes": null, "genres": [{ "id": 18, "name": "Drama" }], "seasons": [{ "season_number": 1, "name": "Season 1", "episode_count": 7 }] }
```

For movies, `seasons` is empty. Missing metadata is null; a confirmed unknown title is `404 TITLE_NOT_FOUND`.

`GET /api/titles/tv/{tmdb_id}/seasons/{season_number}` returns `200`:

```json
{ "tmdb_id": 1396, "season_number": 1, "name": "Season 1", "episodes": [{ "episode_number": 1, "name": "Pilot", "overview": null, "air_date": null, "runtime_minutes": null }] }
```

### U.S. watch options and preference choices

`GET /api/titles/{media_type}/{tmdb_id}/watch-options` returns `200`:

```json
{ "country": "US", "tmdb_watch_url": null, "streaming": [{ "provider_id": 1, "name": "Example service", "logo_url": null }], "rent": [], "buy": [], "available": true }
```

If no U.S. provider data exists, arrays are empty and `available` is false; the link may be null. The UI displays: **Availability information is not available for this country.** Display required TMDB and JustWatch attribution. Backend access must use timeouts, meaningful errors, and appropriate rate-limit handling.

`GET /api/genres` and `GET /api/watch-providers?country=US` return `{ "items": [{ "id": 18, "name": "Drama" }] }`. Provider entries may include `logo_url`. The backend uses consistent provider/genre IDs.

## Account and preferences — signed in

`GET /api/me` returns the owner's `{ "id", "email", "username", "display_name", "avatar_url", "visibility" }`, with visibility `public` or `private`. Email is owner-only.

`PATCH /api/me` accepts any subset of `username`, `display_name`, and `visibility`; returns the updated `/api/me` object. Usernames are proposed to be unique case-insensitively (`409` on conflict); exact validation rules need review. Avatar upload is not specified in this MVP contract.

`GET /api/me/preferences` and `PUT /api/me/preferences` return `200` with the following. PUT replaces the entire object; empty arrays mean no choices. IDs must be valid supported options.

```json
{ "favorite_genre_ids": [18, 35], "watch_provider_ids": [1, 2] }
```

`DELETE /api/me` returns `204` only after deleting the account and all account-owned records. The team must design and test deletion across Supabase Auth, database records, retained progress, and external copies; handle partial failures explicitly. A clear user confirmation and any required recent authentication belong in the UI flow.

## Saved titles — owner only

Movies support `watchlist` and `watched`; TV supports `watchlist`, `watching`, `completed`, `paused`, and `dropped`. Any transition between valid statuses for the same media type is allowed. There is one record per user and `(media_type, tmdb_id)`.

| Method and path | Behavior |
| --- | --- |
| `GET /api/me/saved-titles` | Cursor-paginated `SavedTitle` objects; optional `media_type` and `status` filters; most recently updated first. |
| `POST /api/me/saved-titles` | Body `{ "media_type": "tv", "tmdb_id": 1396, "status": "watchlist" }`; returns `201 SavedTitle`. |
| `PATCH /api/me/saved-titles/{id}` | Body `{ "status": "watching" }`; returns updated record. |
| `DELETE /api/me/saved-titles/{id}` | Removes the library entry, returning `204`; retained episode history is not deleted. |

The server verifies type and ID with TMDB before creation. A confirmed nonexistent title returns `404 TITLE_NOT_FOUND`; an outage returns an upstream error and does not create an unverified record. A duplicate returns `409 SAVED_TITLE_EXISTS`; invalid type/status combinations return `422`. Database constraints and server-side ownership checks both apply. Direct browser table access must not bypass backend TMDB verification.

## Episode progress — owner only

Progress is associated with the user and TV title independently enough to survive removal of the saved-title entry. Re-adding the same TV title restores retained progress. Account deletion removes it. The endpoints below use the current saved-title ID and return `404` when the caller has no matching saved entry.

`GET /api/me/saved-titles/{id}/progress` returns `200`:

```json
{ "saved_title_id": "a5a4d9ea-c10f-458b-a89e-4ed85d78c8fa", "watched_episodes": [{ "season_number": 1, "episode_number": 1 }], "watched_count": 1, "total_episode_count": 7, "last_watched": { "season_number": 1, "episode_number": 1 }, "next_episode": { "season_number": 1, "episode_number": 2 }, "next_episode_state": "available" }
```

The total, last and next episode may be null. `next_episode_state` is `available`, `none_watched`, `end_of_series`, or `metadata_unavailable`. The next episode follows the last watched episode in series order, not the first gap. For now, last watched means **most recently marked watched**; this rule may change. Proposed behavior when that mark is removed: use the remaining episode most recently marked watched. Season bulk-mark ordering and missing/changed episode metadata need team confirmation.

`PUT /api/me/saved-titles/{id}/episodes/{season_number}/{episode_number}` with `{ "watched": true }` marks or unmarks an episode, returning the updated progress. Repeating the same request leaves state unchanged. Episode validity must be checked against available title metadata.

`PUT /api/me/saved-titles/{id}/seasons/{season_number}` with `{ "watched": true }` marks all known episodes in the season watched; `false` clears every watched mark in that season. It returns updated progress. If required metadata cannot be obtained, return an upstream error and make no partial change.

## Posts and ratings — signed in

One original post per user and title. A rating is required, from 0.5 to 5.0 in half-star steps; a review is optional, maximum 2,000 characters. Empty review strings normalize to null. Spoiler controls are outside the MVP.

| Method and path | Behavior |
| --- | --- |
| `POST /api/posts` | Body `{ "media_type": "movie", "tmdb_id": 550, "rating": 4.5, "review": "Optional text" }`; verify title via TMDB; return `201 Post`. Duplicate returns `409 POST_EXISTS`. |
| `GET /api/posts/{id}` | Return `200 Post` if visible to caller. |
| `PATCH /api/posts/{id}` | Owner changes `rating` and/or nullable `review`; title and author cannot be changed; return updated post. |
| `DELETE /api/posts/{id}` | Owner deletes post; return `204`. |

Private post access must be enforced on every endpoint, including direct IDs. A TMDB outage must not create an unverified post or delete an existing post.

## Profiles, visibility, following, and feeds — signed in

Public accounts can be followed immediately. Their posts are visible to signed-in users and appear in the public feed. Private profiles expose only the user's name, username and avatar to other signed-in users. A private account's posts are visible to the owner and approved followers on its profile and in the following feed; they never appear in the public feed. The backend enforces these rules. Private follow requests require approval; owners can decline requests or remove followers; requesters can cancel pending requests.

`GET /api/profiles/{user_id}` returns:

```json
{ "user": { "id": "2b2c8152-71a5-4ea2-a290-571d5e9a6c7c", "username": "example_user", "display_name": "Example User", "avatar_url": null }, "visibility": "private", "relationship": "requested", "is_self": false, "can_view_posts": false }
```

`relationship` is `none`, `requested`, or `following`; for self, `is_self` is true and relationship is `none`. A pending request is visible only to its requester and recipient.

| Method and path | Behavior |
| --- | --- |
| `GET /api/profiles/{user_id}/posts` | Cursor-paginated visible posts, newest first. A non-follower of a private account receives `403 PROFILE_PRIVATE`. |
| `PUT /api/me/following/{user_id}` | Follow a public account or request a private account; `200 { "user_id": "...", "relationship": "following" }` or `requested`. Idempotent. |
| `DELETE /api/me/following/{user_id}` | Unfollow or cancel pending outgoing request; idempotent `204`. |
| `GET /api/me/follow-requests` | Cursor-paginated incoming pending requests: `{ "id", "requester": UserSummary, "created_at" }`. |
| `POST /api/me/follow-requests/{request_id}/approve` | Recipient approves a pending request; `200 { "user_id": "...", "relationship": "following" }`. |
| `POST /api/me/follow-requests/{request_id}/decline` | Recipient declines a pending request; `204`. |
| `GET /api/me/followers` | Cursor-paginated approved follower `UserSummary` objects. |
| `DELETE /api/me/followers/{user_id}` | Remove an approved follower; idempotent `204`. |
| `GET /api/feed?scope=public` | Cursor-paginated visible public-account posts, newest first. |
| `GET /api/feed?scope=following` | Cursor-paginated posts from accounts the caller follows, including approved private accounts, newest first. |

Self-follow returns `422`. Request approval or decline for an absent, already resolved, or inaccessible request returns `404`. Only the private account owner can approve, decline, or remove its followers. Existing approved followers remain followers if an account changes from public to private. **Open:** whether pending requests are approved or cleared when an account changes from private to public; do not assume a behavior until the team decides. Proposed default for new accounts is public; confirm with the team.

## Recommendations — signed in

`GET /api/me/recommendations?limit=20` returns `200`:

```json
{ "items": [{ "title": { "media_type": "movie", "tmdb_id": 550, "title": "Example", "original_title": null, "poster_url": null, "release_date": null, "overview": null }, "reason": "Matches a favorite genre" }], "basis": "favorite_genres" }
```

`basis` is `personalized`, `favorite_genres`, or `fallback`; `reason` may be null. Start with simple rules: favorite-genre matches and selected streaming services where availability exists, excluding watched movies and completed/dropped shows. Use favorite genres for new users and a popular-title fallback when preferences are missing. Improve the algorithm once the basic flow works. Return an empty list when no candidates qualify; return an upstream error if required data is unavailable and results cannot be produced. Candidate source, exact scoring, service handling, and ownership need team review.

## Health and verification

`GET /health` is public and checks that the FastAPI process responds. Preserve the existing endpoint's actual response until intentionally changed; it does not prove database or TMDB connectivity.

Before integration, test authentication and expired tokens; cross-user isolation and private-post access by direct ID; follow request approval, decline, cancellation, removal, and visibility changes; duplicate saves and posts; status validation; retained progress on remove/re-add; episode/season actions and metadata failures; TMDB outages and rate limits; pagination; account deletion; and empty states. No API contract here implies that an endpoint, migration, role, or integration already exists.

## Remaining decisions

1. Confirm default visibility and the treatment of pending follow requests on private-to-public changes.
2. Confirm username rules and avatar scope.
3. Confirm the proposed fallback when the most recently marked episode is unmarked, and define ordering when a whole season is marked at once, specials, missing metadata, and later episode changes.
4. Agree recommendation candidate source, weights, service behavior, and implementation owner.
5. Finalize least-privilege backend database access, token verification, and account-deletion failure handling. Review the endpoint and error choices together before implementation.
