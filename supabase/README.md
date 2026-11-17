# Local database development

The first migration creates the owner-scoped saved titles table. Applying it alone does not implement authentication, the API, or TMDB title verification; FastAPI must verify titles before insertion and authorize every request. Direct browser roles have no table privileges, so they cannot bypass FastAPI's TMDB verification. RLS policies provide defense in depth if access is granted to an authenticated server role later; the test temporarily grants access inside a rolled-back transaction to exercise those policies. Privileged database roles can bypass RLS, so the server must enforce ownership too. The backend database role and connection method remain to be designed before implementation.

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
2. In the intended Supabase development project, open **Connect** and select the shared pooler **Session** connection string (port 5432). Insert the development database password, percent-encoding special characters in the password. In GitHub repository settings, configure that complete URL as the `SUPABASE_DB_URL` secret in the `supabase-development` environment. Enter it directly in GitHub, not in chat or repository files. Verify the project reference in the pooler username matches the intended development project. GitHub-hosted runners require the IPv4-compatible session pooler; do not use the direct IPv6 URL. The old access token, password, and project reference settings are no longer used by this workflow.
3. Review the migration and verify the PR's database tests pass. Merging this PR to `main` triggers a real development database deployment; check the Actions run afterward. Missing configuration fails the deployment rather than applying the migration.

The connection password used by the migration CLI is an administrative credential and must stay separate from the least-privileged role planned for the FastAPI application. Database CI does not verify API authentication, TMDB verification, or the eventual backend role.
