# Repository guidance for AI agents

## Commit messages

When asked or authorized to create a commit, use `type: description`. Keep the description concise, lowercase, and action-oriented, describing the actual change. For example: `docs: add project planning guidelines`.

Use the type that best fits the change:

- `docs`: documentation
- `feat`: new functionality
- `fix`: bug fixes
- `test`: tests
- `refactor`: code restructuring without an intended behavior change
- `chore`: maintenance or configuration

Do not add sequential commit numbers. If a change is associated with a GitHub issue, include its number when useful, for example `fix: handle expired sessions (#12)`. Review the changes before committing, and follow the user's instructions about committing and pushing.

## Development and database workflow

- Read `documentation/project/database/saved-title-design.md` and `supabase/README.md` before working on saved titles or migrations. The first migration is a starting point; it does not implement application authentication or TMDB verification.
- Keep database changes in timestamped SQL files in `supabase/migrations/`; create a new migration for later changes instead of editing one already applied to a shared database. Add relevant database tests under `supabase/tests/`.
- Use Docker and the pinned Supabase CLI version shown in `supabase/README.md` to run migrations and `supabase test db` locally before requesting review. `supabase db reset` destroys local database contents; check the target before using it. Never run a reset against a hosted database.
- The `Database migrations` GitHub Actions workflow tests pull requests using an isolated local database. After changes to Supabase files are reviewed and merged to `main`, it tests again and deploys pending migrations to the development project. Manual runs deploy only from `main`. No workflow has been configured for production.
- The `supabase-development` GitHub environment needs the project reference variable and secrets documented in `supabase/README.md`. Confirm the target and that Supabase's own GitHub automatic deployment is disabled for that same database; do not deploy using two mechanisms. Do not print, commit, or request credentials in chat. Ask a project administrator to enter secrets directly in GitHub.
- Pull requests to `main` require a teammate's approval. Preserve uncommitted work and coordinate changes to shared branches. When implemented, the backend must verify Supabase Auth tokens and TMDB titles before account-owned writes; the migration does not implement those checks. Direct browser roles cannot access `saved_titles`, and privileged database roles can bypass RLS. Design and test a least-privilege backend role and server-side ownership checks before enabling application data access.
