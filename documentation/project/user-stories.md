# User stories and acceptance criteria

Status: draft for review. Stories describe user outcomes rather than implementation tasks. Criteria are proposed starting points; unresolved policy and design choices are listed in [scope and decisions](scope-and-decisions.md). IDs are stable references for later tasks and tests.

## Accounts and preferences

**US-01 — Account access.** As a viewer, I want an account so my activity persists across sessions.

- A user can register, verify their email, sign in with valid credentials, sign out, and reset their password.
- Invalid or incomplete input receives a clear error. A user's saved data is available after signing back in.
- The server restricts changes to the authenticated owner's records.

**US-02 — Preferences.** As a viewer, I want to save favorite genres and streaming services so recommendations are relevant.

- A signed-in user can view and update favorite genres and selected streaming services; saved values remain after a new session.
- The app handles missing preferences with a prompt or fallback. Availability is limited to the United States in the MVP.

## Discovery and viewing information

**US-03 — Find titles.** As a viewer, I want to search movies and TV shows so I can find a title.

- Visitors can search without signing in. Search returns identifiable movie and show results and supports opening a result's details.
- The app communicates loading, no matches, and a failed request.

**US-04 — Explore a title.** As a viewer, I want title details and U.S. watch options so I can decide what to watch.

- A detail view shows available title metadata and a poster when supplied; a show exposes seasons and episodes when available.
- Streaming, rental, and purchase options are shown for the United States where supplied, with the provider link and required attribution.
- Missing images or metadata are handled gracefully. When provider information is missing, show: "Availability information is not available for this country."

## Library and progress

**US-05 — Manage a library.** As a viewer, I want to save and update titles so I can keep track of what to watch and what I have watched.

- A signed-in user can add and remove titles, use a watchlist, mark a movie watched, and update a show's watching, completed, paused, or dropped status.
- Library data is retained across sessions and can be filtered or viewed by status. Exact status transitions are to be confirmed.

**US-06 — Track episodes.** As a viewer, I want to record watched episodes or seasons so I know where to resume.

- A signed-in user can mark an episode or season watched and update a previous selection.
- Selections can be undone and persist across sessions. Show the episode after the last watched episode, rather than the first unwatched gap; the meaning of last watched for out-of-order updates and the end-of-series case need clarification.

## Reviews and social features

**US-07 — Rate and review.** As a viewer, I want to rate a title and optionally write a review so I can share my opinion.

- A signed-in user can submit a rating and optional review for a title and edit or delete their own post.
- Other users can read the published rating and review. The server rejects attempts to modify another user's post.
- A rating is required, the review is optional, and a user edits the original post rather than creating another for the same title. Posts from public accounts are public. The presentation proposes a five-star scale; confirm detailed rating rules. Spoiler controls are not in the MVP.

**US-08 — Profiles and following.** As a viewer, I want to see public profiles and follow people so I can keep up with their posts.

- A public profile displays the user's published ratings and reviews.
- A signed-in user can follow and unfollow another account; the saved following state is reflected after a new session. A user cannot follow their own account.

**US-09 — Feeds.** As a viewer, I want public and following feeds so I can discover opinions and see posts from accounts I follow.

- The public feed displays eligible public posts; the following feed displays eligible posts from followed accounts.
- A post identifies its author and title, and a viewer can open the related title. Empty feeds are explained.
- Both feeds show newest posts first. Viewing profiles and the public feed requires sign-in.

## Recommendations

**US-10 — Find something to watch.** As a viewer, I want recommendations based on my preferences and activity so I can find relevant titles.

- A user can view suggested titles and open their details.
- A new user can receive suggestions from selected favorite genres without requiring viewing history.
- Exclude watched movies and completed or dropped shows. Proposed inputs are favorite genres, ratings, viewing history, watchlist, and selected services; scoring and weighting require team review.

## Cross-cutting checks

- Core flows work at practical mobile and desktop screen sizes and are usable with a keyboard and readable labels.
- Account-owned writes are validated on the server; one user's private saved data cannot be modified by another.
- Unavailable external data and failed requests produce understandable states without exposing credentials.
- Required TMDB and JustWatch attribution is present wherever applicable.
