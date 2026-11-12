# Delivery and collaboration

Status: draft for team review. Kanban and the review expectations below reflect project decisions; the schedule and ownership are initial guidance, not fixed commitments.

## Suggested delivery order

1. Agree on the MVP, open questions, screen sketches, owners, and working process.
2. Establish a reproducible frontend, backend, database, and local configuration; agree on API request and response formats. Review existing frontend and social prototype branches before integration.
3. Deliver a thin working path through catalog search, details, and saved user data. Add authentication and ownership checks for protected operations.
4. Build library and episode tracking, then ratings, profiles, following, and feeds. Integrate each feature with real persisted data rather than leaving the social prototype on fixtures.
5. Add recommendations and country-specific availability; run end-to-end checks and prepare a deployment and demonstration.

Steps can overlap where dependencies allow. This is a suggested sequence, not an assignment or a replacement for the team's current deadlines.

## Dependencies to consider when planning

- Saved library, progress, preferences, follows, and posts depend on accounts, persistence, and server-side authorization.
- Title screens, episode progress, and watch options depend on TMDB data and handling missing or failed responses.
- Following feeds depend on accounts, follows, posts, and visibility rules.
- Personalized recommendations depend on agreed inputs and saved preferences or activity.
- The frontend and backend need agreed API contracts before integration.

## Verification before a story is complete

For each selected story, agree on its acceptance criteria and demonstrate the intended user flow. Include relevant validation and error cases, persistence where applicable, and attempts to change another user's data for protected operations. Check mobile and desktop layouts, keyboard access, and required data attribution. Record defects and resolve or explicitly defer them with the team.

## Initial ownership guidance

The presentation assigns **Jack** to Discover and My Library screens, **Medha** to accounts, database, and TMDB integration, and **Raif** to Feed, Profile, Post, and recommendations. Use these as initial owners, subject to team confirmation and reassignment as needed. The proposal assigns work differently (Raif: frontend and library; Medha: authentication, database, library/episode endpoints and deployment; Jack: recommendations, reviews and integration testing). All members participate in planning, reviews, testing, and demo preparation. Backend ownership for each feature and a reviewer should be agreed when work is picked up.

## Rough timeline from the presentation

These are the presentation's original guide dates, not a revised schedule or evidence of completion:

- **Nov 4–10:** scope, five-tab sketches, repository, and API access.
- **Nov 11–17:** accounts, search, title details, and database storage.
- **Nov 18–24:** library, watchlist, and episode progress.
- **Nov 25–Dec 1:** profiles, following, posts, and both feeds.
- **Dec 2–8:** recommendations, integration, testing, and demo rehearsal.

The team should update this guide based on actual progress and course deadlines. Include password reset and email verification in account planning and allow time for streaming availability, deployment, and testing.

## Collaboration process

- **Method:** Kanban, with work flowing continuously through visible stages rather than fixed sprints. Agree on work-in-progress limits and review cadence as a team.
- **Git:** use feature branches and pull requests; at least one teammate reviews each change before merging.
- **Trello:** create the board and initial cards after this documentation is reviewed. Organize the board for Kanban rather than sprint commitments.
- **Credentials:** keep `.env` files and tokens out of Git; share credentials through an approved secure channel and provide placeholder configuration.
- **Definition of done:** acceptance criteria are met, relevant checks pass, code is reviewed, and the feature is demonstrated or otherwise verified. Update documentation where needed.
