# Odin Stream project handoff

## Current status

The repository is https://github.com/Jnuso/OdinStream. The planning documents, draft backlog, and TMDB live checks were prepared on `test/tmdb-api`; check Git status and the remote before making changes. The `main` branch was at `4b010a2` when this handoff was updated. Remote branches `chore/frontend-setup` and `feat/social-prototype` contain frontend work; check their current status before integrating. The social prototype was described as using mock data and local storage rather than a live backend.

## Planning and design

Start with [the planning overview](README.md), which links the current scope, decisions, user stories, collaboration guidance, backlog, and Figma sketches. Public profiles, following, and public and following feeds are included in the MVP; spoiler controls are excluded. Kanban is the chosen workflow. The backlog is a draft for review and has not been transferred to Trello; the direct Trello connection was returning errors. The user created a board at https://trello.com/b/zJ40oEY3/odinstream and asked that cards remain unassigned initially.

The project proposal and presentation are in this folder. They differ in some assignments and dates; the collaboration document records the presentation's assignments and timeline as initial guidance. Resolve the remaining questions in the scope document with the team rather than assuming a decision.

## TMDB checks and credentials

`tests/test_tmdb_live.py` exercises sampled TMDB search, details, episodes, provider availability, and image retrieval. The checks passed using a locally configured token; see `tests/README.md`. `.env` is ignored and must not be committed or shared. `.env.example` contains placeholders only. API tests are not a substitute for testing the application integration.

## Repository guidance

`AGENTS.md` describes the agreed commit convention: `type: description`, without sequential numbers. Commit and push only when authorized. Course requirements are in `documentation/guidelines/4095/`; the general guides under `documentation/guidelines/other/` are optional reference material synthesized from earlier course materials. Preserve teammates' changes and check the remote before editing.
