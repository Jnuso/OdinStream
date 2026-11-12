# MVP scope and decisions

Status: draft for team review. The decisions explicitly made in this project chat are distinguished from proposed details and unresolved questions.

## Product and users

Odin Stream is a browser-based movie and television tracking application. It helps viewers discover titles and where to watch them, maintain a personal library and episode progress, and share ratings and reviews. See [users and goals](users/users-and-goals.md).

## Confirmed direction

- Public profiles, following, and both public and following feeds are required for the MVP.
- Spoiler controls are outside the MVP.
- Visitors can search and browse titles without signing in; profiles and the public feed require sign-in.
- Accounts support registration, sign-in, sign-out, password reset, and email verification.
- The MVP supports U.S. availability only. When provider information is missing, show: "Availability information is not available for this country."
- Posts require a rating and may include a review. Users edit their original post for a title rather than create another. Posts from public accounts are public; whether private accounts are supported is unresolved.
- Feeds are newest first for the MVP. Users cannot follow themselves.
- The primary audience is casual viewers. The product name is Odin Stream.
- Use the presentation's five screen areas: Discover, My Library, Feed, Profile, and Post. The [Figma sketches](https://www.figma.com/design/ma8S3CmWx675i5hsZFCk2k) are the initial design direction, which the team may refine during development.

## Proposed MVP capabilities

These follow the proposal and presentation and should be reviewed as a single achievable release:

1. **Accounts and preferences:** create an account and sign in; persist user data and support favorite-genre and streaming-service preferences; availability is U.S.-only for the MVP.
2. **Discover:** search movies and shows, view details and episodes, and see U.S. streaming, rental, and purchase information where available.
3. **Library and progress:** save and remove titles, maintain a watchlist and viewing statuses, and track watched episodes or seasons and the episode following the last watched episode in series order, rather than the first unwatched gap.
4. **Ratings and posts:** rate a title, optionally write a review, and edit or delete one's own post. The proposal allows reviews; the presentation describes posts and ratings.
5. **Profiles and feeds:** show public profiles and posts, follow and unfollow users, and display public and following feeds.
6. **Recommendations:** suggest titles based on user preferences and activity, with a way for new users to start. Use favorite genres, ratings, viewing history, watchlist, and selected streaming services as a proposed starting point; use favorite genres for new users and exclude watched movies and completed or dropped shows. The exact scoring and weighting remain for team review.
7. **Quality:** persist user data; protect account-owned changes; support desktop and mobile; show useful loading, empty, and error states.

The draft stories provide more specific acceptance criteria. They are proposals until reviewed, not evidence that the functionality is already built.

## Outside the MVP

Spoiler controls are excluded. The proposal and presentation also describe statistics, reminders, calendars, and import/export as optional or later work. The team can reconsider these after the MVP.

## Technology and current evidence

The proposal and presentation propose React with TypeScript, FastAPI, PostgreSQL, and TMDB, with GitHub for collaboration. These are planned choices and may be revised by the team. TMDB supplies metadata and JustWatch-powered availability; displaying this data requires the applicable attribution.

A local live test successfully checked TMDB search, details, episodes, availability responses, and a poster download using a credential. That confirms the sampled API calls worked at the time; it does not establish that the application integration is complete. The remote social prototype uses fixtures and local browser storage, not a live backend. Its branch and the frontend setup branch have not been merged into main as of the last repository check.

## Open decisions for review

- Are accounts all public in the MVP, or will private accounts be supported? If private accounts exist, define their post and feed visibility.
- What counts as the last watched episode when watched selections are changed out of order: the most recently marked episode or the furthest watched in series order? Define behavior when the last watched episode has no following episode.
- How should a whole season be unmarked, and how should progress handle missing episode metadata?
- What recommendation scoring, weighting, and fallback should apply when data or streaming-service preferences are missing? The input list above is a proposed recommendation awaiting team agreement.
- Confirm the one-to-five star scale shown in the presentation, and any half-star or validation rules.
- Confirm initial work ownership with the team; the presentation and proposal assign some areas differently.
- Agree on Kanban work-in-progress limits, review cadence, and any revisions to the presentation's approximate dates.
