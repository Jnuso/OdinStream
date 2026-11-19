# Local database development

The saved titles table is accessible to FastAPI through the non-login, non-bypass `odin_api` role after all migrations are applied. FastAPI validates the Supabase token, sets the verified user ID transaction-locally, scopes its queries to that user, and verifies the TMDB title before insertion. Direct browser roles have no table privileges. RLS provides defense in depth; privileged database roles can bypass it. Configure a dedicated login with membership in `odin_api` for the backend connection, with no elevated or unrelated privileges; provision its password outside migrations and keep it out of Git. Do not use the migration administrator credential at runtime. The connection identity can set the user context and must therefore be kept private to the trusted backend.

With Docker running, from the repository root use the pinned CLI version:

```sh
npx --yes supabase@2.95.3 start
npx --yes supabase@2.95.3 test db
```

Tests run inside a transaction and roll back their changes. `supabase db reset` recreates the local database and deletes its local data; never use it against a hosted database. The local config uses PostgreSQL 17, matching the OdinStream development project's reported major version. Confirm the target and version again before connecting or deploying elsewhere.

## GitHub Actions: development migrations

`.github/workflows/database-migrations.yml` tests migrations and database policies in a local PostgreSQL instance on pull requests. After the tests pass on a push to `main` involving `supabase/` or the workflow, it applies pending migrations to the configured development project. A manual run is allowed only for `main` and can apply pending migrations; it is not a dry run. Deployments are serialized. Do not use this environment for production.

Before merging the first migration, a repository administrator should:

1. Confirm the intended target is the OdinStream development project and Supabase's own GitHub automatic deployment is disabled for that database.
2. In GitHub repository settings, create the `supabase-development` environment. Configure the environment secret `SUPABASE_DB_URL` with the development database session-pooler URL, including the migration administrator credentials. Enter secrets directly in GitHub, not in chat or repository files.
3. Review the migration and verify the PR's database tests pass. Merging this PR to `main` triggers a real development database deployment; check the Actions run afterward. Missing configuration fails the deployment rather than applying the migration.

The connection password used by the migration CLI is an administrative credential and must stay separate from the least-privileged role planned for the FastAPI application. Database CI exercises the backend role's row-level policies, but does not verify API authentication, live TMDB verification, or the security of the configured runtime login.

## Profile privacy

New profiles are private and hidden from other users until required setup is completed; existing profiles keep their current visibility. Private profiles expose posts only to the owner and approved followers; the public feed never includes private posts. A follow of a private profile creates a request. The owner can approve or decline it, and either participant can remove the relationship. Switching a public profile to private keeps existing followers. Pending requests are automatically approved when the profile becomes public. The frontend still needs controls for visibility and request management.
