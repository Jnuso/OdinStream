# Odin Stream — draft project backlog

Status: **for review**, not an approved Trello board or a set of assignments. This is a comprehensive starting list for delivering the MVP and course demonstration. The team can split, combine, reorder, or remove items when turning them into cards. An unchecked box means the work still needs to be completed or verified; it does not imply that nobody has started it.

The scope, stories, and decisions are in [scope and decisions](scope-and-decisions.md), [user stories](user-stories.md), and [delivery and collaboration](delivery-and-collaboration.md). Suggested work areas reflect the presentation and do not assign ownership automatically. Work flows through Kanban; there are no sprint commitments here. Nested checkboxes are suggested smaller pieces that can be assigned to different people; coordinate shared interfaces and integration. A parent is complete only when its applicable substeps and acceptance criteria are complete.

## 1. Planning and decisions

- [ ] Review and approve the MVP scope, user stories, and acceptance criteria with the team.
  - [ ] Review scope and identify any missing or conflicting requirements.
  - [ ] Review each user story and agree on observable acceptance criteria.
  - [ ] Record decisions and confirm the team is ready to plan work.
- [ ] Confirm whether the MVP supports private accounts and define post and feed visibility accordingly.
- [ ] Define “last watched” when episodes are marked out of order, and what to show when there is no next episode.
- [ ] Define season unmarking and behavior for missing or changed episode metadata.
- [ ] Confirm the rating scale and whether half-stars are supported.
- [ ] Agree on recommendation inputs, scoring, weighting, and fallback behavior.
- [ ] Confirm initial owners and reviewers, including who implements the backend portions of each feature.
- [ ] Agree on Kanban columns, work-in-progress limits, review cadence, and how blocked work is handled.
- [ ] Check course deliverables and deadlines; update the presentation's rough timeline to reflect actual progress.
- [ ] Review the five Figma screen sketches as the starting design and identify required desktop and mobile variations.
- [ ] Map the main user flows, including browsing as a visitor and actions that require sign-in.
- [ ] Define a common definition of done and a way to report defects and track decisions.

## 2. Repository, setup, and integration foundation

- [x] Create the public repository and establish a feature-branch and pull-request workflow in the project proposal.
- [ ] Review the existing frontend setup and social prototype branches; integrate appropriate work through reviewed pull requests.
  - [ ] Inspect each branch and document what is implemented versus mocked.
  - [ ] Resolve integration conflicts and verify the frontend locally.
  - [ ] Open pull requests and obtain a teammate review before merging.
- [ ] Review the local API test branch and decide how to share and integrate it without exposing credentials.
- [ ] Establish the frontend project structure, dependencies, and scripts for running, checking, and building the app.
- [ ] Establish the FastAPI backend project structure, dependencies, and local run instructions.
  - [ ] Create the backend application entry point and dependency configuration.
  - [ ] Add configuration and a basic health endpoint.
  - [ ] Document how to install dependencies and start the server.
- [ ] Configure PostgreSQL for local development and establish migrations and seed data where useful.
  - [ ] Choose a repeatable local database setup and configure a development connection.
  - [ ] Add migration tooling and an initial migration.
  - [ ] Document database setup and provide non-sensitive sample data if needed.
- [ ] Provide a safe example configuration for frontend, backend, database, email, and TMDB; keep real secrets out of Git and client code.
- [ ] Document setup, environment variables, commands, troubleshooting, and how team members obtain development access.
- [ ] Agree on frontend/backend API contracts, error formats, naming, and data ownership before implementing integrations.
- [ ] Configure automated checks for relevant linting, builds, and meaningful tests; run them on pull requests.
  - [ ] Add frontend lint and build checks.
  - [ ] Add backend checks and an automated test command.
  - [ ] Configure pull request checks and verify that a failing check is reported.
- [ ] Establish development, test, and deployment configuration without sharing production credentials unnecessarily.
- [ ] Require at least one teammate's review before merging a change.

## 3. Application shell and design

- [ ] Build a responsive application shell and navigation for Discover, My Library, Feed, Profile, and Post.
  - [ ] Implement the shared page shell and routes for the five areas.
  - [ ] Build mobile navigation based on the Figma sketches.
  - [ ] Adapt navigation and layout for desktop and verify route changes.
- [ ] Implement navigation and appropriate sign-in prompts for protected screens and actions.
- [ ] Translate the sketches into accessible mobile and desktop layouts, refining the designs with the team.
- [ ] Define reusable styles and common UI elements, including buttons, inputs, cards, and feedback messages.
- [ ] Add accessible labels, keyboard navigation, visible focus, and readable text and contrast.
- [ ] Create consistent loading, empty, error, and success states for relevant flows.
- [ ] Verify layouts and navigation across representative screen sizes and supported browsers.

## 4. Accounts, authentication, and preferences

- [ ] Design account data and authentication/session flows, including validation and server-side access control.
- [ ] Implement registration and clear handling of invalid or duplicate account details.
  - [ ] Create the registration form and client-side feedback.
  - [ ] Add server-side validation and create an account record.
  - [ ] Handle duplicate accounts and verify that invalid submissions do not create records.
- [ ] Implement email verification, including expired or invalid verification links and a way to request another.
  - [ ] Generate and store a time-limited verification token.
  - [ ] Send a verification link and implement the confirmation endpoint.
  - [ ] Build confirmation and resend states; check expired and invalid links.
- [ ] Implement sign-in and sign-out, including invalid credentials and session expiration.
  - [ ] Build sign-in and sign-out interfaces.
  - [ ] Authenticate credentials and create and end sessions.
  - [ ] Handle invalid credentials and expired sessions; protect authenticated routes.
- [ ] Implement password reset, including an expiring reset link, confirmation, and appropriate error handling.
  - [ ] Build request-reset and new-password screens.
  - [ ] Generate a time-limited reset token and send the link.
  - [ ] Validate the token, update the password securely, and handle expired links.
- [ ] Select and configure a development and production email delivery approach for verification and password reset.
- [ ] Store passwords securely and protect authenticated actions and account-owned records on the server.
- [ ] Implement user settings for favorite genres and selected streaming services, and save them across sessions.
  - [ ] Define the preference fields and persistence model.
  - [ ] Add endpoints to read and update preferences for the signed-in user.
  - [ ] Build settings controls and verify changes persist after sign-out and sign-in.
- [ ] Provide onboarding or a fallback for users without preference data.
- [ ] Check authentication, persistence, expired links, and attempts to access or change another user's data.

## 5. TMDB integration and Discover

- [x] Verify sampled live TMDB calls for movie and TV search, details, episodes, watch-provider responses, and a poster download.
- [ ] Make the live checks available to the team and confirm developers can run them with their own configured credentials.
- [ ] Implement backend access to TMDB with server-side credentials, timeouts, useful errors, and appropriate handling of rate limits.
  - [ ] Read the token from backend configuration without exposing it to the client.
  - [ ] Create a shared request helper with timeouts and error handling.
  - [ ] Handle rate-limit responses and make failures understandable to the frontend.
- [ ] Implement movie and TV search and connect it to the Discover screen; allow visitors to browse without an account.
  - [ ] Create a backend search operation for movies and shows.
  - [ ] Build the search input and result list in Discover.
  - [ ] Connect results to the backend and support loading, no results, and errors.
- [ ] Display recognizable search results and let users open a movie or show detail page.
- [ ] Show available metadata, poster, release information, runtime, genres, and show seasons/episodes.
  - [ ] Fetch movie and TV details using the selected title ID.
  - [ ] Build reusable detail and poster display components.
  - [ ] Display show seasons and episode information with appropriate missing-data states.
- [ ] Handle missing posters or metadata, empty search results, and failed or slow external requests.
- [ ] Retrieve and display U.S. streaming, rental, and purchase options where TMDB provides them.
  - [ ] Request watch-provider data for a selected movie or show.
  - [ ] Extract U.S. streaming, rental, and purchase categories.
  - [ ] Render available providers and the TMDB watch-options link.
- [ ] Show the agreed message when U.S. availability information is missing and link to the supplied TMDB watch-options page.
- [ ] Add required TMDB and JustWatch attribution in the appropriate app locations.
- [ ] Review permitted caching and avoid unnecessary repeated requests; verify behavior when TMDB returns HTTP 429.
- [ ] Test representative movies, shows, missing data, provider categories, and API failures.

## 6. Personal library and episode tracking

- [ ] Design persistent library and progress records linked to the user and external title IDs.
  - [ ] Define library entries, statuses, and their relationship to accounts and TMDB IDs.
  - [ ] Define episode progress records and uniqueness rules.
  - [ ] Create and review migrations for the resulting tables.
- [ ] Implement add/remove title and watchlist operations with server-side ownership checks.
  - [ ] Add authenticated endpoints for creating, listing, and removing entries.
  - [ ] Validate title identifiers and enforce ownership.
  - [ ] Connect add/remove and watchlist controls to the endpoints.
- [ ] Implement movie watched status and show statuses: watching, completed, paused, and dropped.
  - [ ] Define valid statuses and transitions for movies and shows.
  - [ ] Implement server-side status updates and validation.
  - [ ] Add status controls and display the saved value in the library.
- [ ] Build the My Library views and filtering or status-based views; preserve changes across sessions.
- [ ] Implement marking individual episodes or entire seasons as watched and undoing selections.
  - [ ] Add endpoints for marking and unmarking individual episodes.
  - [ ] Add season-level actions using the agreed unmarking behavior.
  - [ ] Connect episode and season controls and refresh progress after changes.
- [ ] Calculate and display progress and the episode after the last watched episode according to the agreed rule.
  - [ ] Implement the agreed last-watched selection and next-episode calculation.
  - [ ] Calculate progress from available episode records.
  - [ ] Display progress and an appropriate state when no next episode exists.
- [ ] Handle incomplete metadata, the end of a season or series, and changes to previously recorded progress.
- [ ] Test persistence, status changes, episode/season updates, next-episode behavior, and cross-user access restrictions.

## 7. Ratings, reviews, and posts

- [ ] Design persistent posts and ratings linked to users and titles, enforcing one original post per user and title.
  - [ ] Define post fields, rating constraints, author, and title reference.
  - [ ] Create a migration with a uniqueness constraint for user and title.
  - [ ] Specify server-side ownership and visibility checks.
- [ ] Build the Post screen with title selection, required rating, and optional written review.
- [ ] Implement post creation, validation, and clear success and error feedback.
  - [ ] Create an endpoint that validates the required rating and optional review.
  - [ ] Connect the Post screen and title selection to the endpoint.
  - [ ] Show success, validation errors, and duplicate-post guidance.
- [ ] Allow a user to edit or delete their own post and reject changes by other users on the server.
  - [ ] Add authenticated edit and delete operations with ownership checks.
  - [ ] Build edit and delete controls on the relevant views.
  - [ ] Verify the displayed post and feeds update after changes.
- [ ] Display public posts and ratings with their author and related title; connect posts to title details.
- [ ] Test required ratings, optional reviews, duplicate-post handling, edits, deletes, persistence, and permissions.

## 8. Profiles, following, and feeds

- [ ] Design profile and follow records and implement the agreed account-visibility rules.
- [ ] Build public profile views showing the user's published ratings and reviews.
- [ ] Implement follow and unfollow; prevent a user from following themselves and persist changes.
  - [ ] Create follow and unfollow operations and persist relationships.
  - [ ] Prevent self-following and duplicate follows on the server.
  - [ ] Connect profile controls and show the current following state.
- [ ] Implement the public feed and following feed, ordered newest first for the MVP.
  - [ ] Create a public-feed query using the agreed visibility rules.
  - [ ] Create a following-feed query restricted to followed accounts.
  - [ ] Build feed switching and render posts in newest-first order.
- [ ] Require sign-in to view profiles and the public feed; apply the agreed visibility rules on the server.
- [ ] Connect feed items to their authors' profiles and related title details.
- [ ] Handle empty feeds, accounts with no posts, loading, and request failures.
- [ ] Replace the social prototype's fixtures and local-only state with real backend data where appropriate.
- [ ] Test feed membership and ordering, follow/unfollow, visibility, empty states, and access controls.

## 9. Recommendations

- [ ] Confirm how favorite genres, ratings, viewing history, watchlist, and selected services contribute to recommendations.
- [ ] Design a simple, explainable ranking approach and decide how to obtain candidate titles.
  - [ ] Identify a source of candidate titles.
  - [ ] Define how each agreed input contributes to the score.
  - [ ] Document fallback behavior and examples so the team can review the ranking.
- [ ] Create a new-user path based on favorite genres and a fallback for missing inputs.
- [ ] Exclude movies marked watched and shows marked completed or dropped.
- [ ] Implement recommendation generation and connect results to Discover and title details.
  - [ ] Implement candidate selection, exclusions, and scoring on the backend.
  - [ ] Expose results through a frontend-facing endpoint.
  - [ ] Render recommendations in Discover and link each result to its details.
- [ ] Test ranking with sample user histories, new accounts, excluded titles, and unavailable data.

## 10. Integration, testing, and quality

- [ ] Run meaningful automated checks for backend behavior, frontend behavior, and integrations.
- [ ] Test the complete visitor path: search, view a title, and see U.S. watch information.
- [ ] Test the complete account path: register, verify email, sign in, reset password, and sign out.
- [ ] Test the complete tracking path: save a title, update a status, mark episodes, return later, and resume.
- [ ] Test the complete social path: rate a title, edit the post, view a profile, follow, and check both feeds.
- [ ] Test recommendations for both new and returning users and verify exclusions.
- [ ] Check server-side authorization, invalid inputs, duplicate actions, and ownership boundaries.
- [ ] Exercise API failures, rate limits, empty results, missing data, expired sessions, and recovery.
- [ ] Check responsive layouts, keyboard use, focus, labels, and readable feedback.
- [ ] Review TMDB and JustWatch attribution and ensure no credentials are exposed in the repository or frontend.
- [ ] Record defects, prioritize and fix MVP blockers, and repeat checks affected by fixes.

## 11. Deployment, documentation, and final demonstration

- [ ] Choose and configure hosting, a production database, environment variables, and an email delivery method.
  - [ ] Choose hosting and a database suitable for the team and course.
  - [ ] Configure secrets and environment settings for each deployed service.
  - [ ] Configure email delivery and verify the domain or sender requirements.
- [ ] Configure the deployed frontend and backend to communicate, and verify database persistence and authentication.
- [ ] Apply database migrations and confirm deployment and recovery procedures appropriate for the project.
- [ ] Verify a deployed end-to-end flow, including TMDB data, provider attribution, account email, and protected actions.
  - [ ] Test registration and email verification on the deployed app.
  - [ ] Test search, provider information, attribution, and saved data.
  - [ ] Test a protected social action and verify access controls.
- [ ] Prepare safe sample accounts and representative demo data without exposing real credentials.
- [ ] Finish the project README, setup and deployment notes, known limitations, and required course documentation.
- [ ] Review the course submission requirements and prepare all required deliverables.
- [ ] Prepare the demo script and presentation; assign speaking or demonstration roles and rehearse.
  - [ ] Choose a short end-to-end scenario and prepare demo data.
  - [ ] Divide presentation and demonstration responsibilities.
  - [ ] Rehearse the flow, prepare a backup, and fix issues discovered.
- [ ] Conduct final acceptance review, address blocking issues, and submit the project.

## Deferred / optional after MVP

These are not initial MVP commitments: spoiler controls, viewing statistics, upcoming-episode calendars, release reminders, and viewing-history import/export. Private-account functionality is a decision still to be made, not an approved deferred feature.
