# Odin Stream — Trello card set

Derived from [the draft backlog](project-backlog.md) and [the course requirements](../guidelines/4095/project-proposal.txt) (proposal §6 asks for major development tasks, responsibilities, collaboration, and milestones; [the organizing guideline](../guidelines/other/01-organize.md) asks for a shared board of small outcomes with status). Status reflects `main` after PR #14. Cards stay **unassigned**, as requested.

## How to create the cards

In Trello, open a list's "Add a card" composer and paste the block for that list — Trello creates one card per line. Keep the five lists below as the Kanban columns; nothing here needs a due date or an owner yet.

Labels to create once on the board: `frontend`, `backend`, `database`, `docs`, `testing`, `blocked`.

## Done

```
Live TMDB search, title details, seasons and episodes
U.S. streaming, rental and purchase options with TMDB and JustWatch attribution
TMDB response caching, timeouts and rate-limit handling
Sign-up, sign-in and sign-out on Supabase Auth
Password reset and recovery screens
Email verification and resend screens with invalid-link handling
Favorite genres and streaming services stored per user with RLS
Account setup flow for display name and preferences
Watchlist and movie/show statuses with owner-scoped API
Episode and season marking with next-episode selection and season metadata edge cases
Half-star ratings from 0.5 to 5 with 2,000-character reviews
Create, edit and delete own posts with ownership and duplicate validation
Post screen backed by TMDB instead of fixtures
Public profile with counts, follow and unfollow without self-follow
Private profiles with visibility settings, follow requests, approve and decline
Remove followers and view incoming requests
Public and following feeds ordered newest first, with suggested accounts
Account deletion endpoint
Favorites-genre recommendations with popularity tie-break and watched exclusions
FastAPI structure with configuration, health endpoint, readiness probe and security middleware
Frontend structure, dependencies and run/check/build scripts
Migrations with RLS hardening, least-privilege API login and pgTAP suites
CI workflows for frontend tests, backend tests and database migrations
render.yaml for a free Render service and all migrations applied to the hosted project
Deploy smoke test against a running API
Remove the social prototype's fixtures and local storage
```

## In review

```
Review and merge the Trello card set and documentation updates
```

## In progress

```
Deliver email verification and password reset through an SMTP provider
Provision the Render web service and verify the deployed API health check
Publish the frontend and confirm it reaches the deployed API
Adapt navigation and layout for desktop and phone screen sizes
Add accessible labels, keyboard navigation, visible focus and readable contrast
Add status filtering and status-based views to My Library
```

## Backlog

```
Review and approve the MVP scope and user stories with the team
Confirm whether the MVP supports private accounts and define post and feed visibility
Define "last watched" when episodes are marked out of order
Define season unmarking and behavior for missing or changed episode metadata
Agree on recommendation inputs, scoring, weighting and fallback behavior
Confirm initial owners and reviewers for each feature
Agree on Kanban columns, work-in-progress limits and review cadence
Check course deliverables and update the presentation timeline
Review the Figma sketches and identify desktop and mobile variations
Map the main user flows, including browsing as a visitor
Define a common definition of done and a defect reporting path
Decide how to share the local API test branch without exposing credentials
Build the sign-in prompts for protected screens and actions
Create consistent loading, empty, error and success states
Verify layouts and navigation across representative screen sizes and browsers
Provide onboarding or a fallback for users without preference data
Handle missing posters or metadata, empty results and slow external requests
Test representative movies, shows, missing data, provider categories and API failures
Test persistence, status changes, episode updates and cross-user access
Test required ratings, duplicate posts, edits, deletes and permissions
Test feed membership and ordering, follow/unfollow, visibility and access control
Document the ranking with examples so the team can review it
Test ranking with sample histories, new accounts, excluded titles and unavailable data
Run meaningful automated checks for backend, frontend and integrations
Test the complete visitor path: search, view a title, see U.S. watch information
Test the complete account path: register, verify email, sign in, reset password, sign out
Test the complete tracking path: save, update status, mark episodes, return later
Test the complete social path: rate, edit, view a profile, follow, check both feeds
Check server-side authorization, invalid inputs, duplicate actions and ownership
Exercise API failures, rate limits, empty results, expired sessions and recovery
Review TMDB and JustWatch attribution and confirm no credentials are exposed
Record defects, prioritize MVP blockers and repeat affected checks
Add SPECIFICATION, SECURITY, DEPLOYMENT and UI guidelines documentation
Write the root README with prerequisites, configuration, run and test commands
Prepare safe sample accounts and representative demo data
Review the course submission requirements and prepare all deliverables
Prepare the demo script and presentation with roles and a rehearsal
Conduct final acceptance review, fix blockers and submit
```

## Deferred

```
Spoiler controls
Viewing statistics
Upcoming-episode calendars
Release reminders
Viewing-history import and export
```
