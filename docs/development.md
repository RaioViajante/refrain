# Development

**Status:** there is no application code, `package.json`, Docker Compose file, or CI workflow yet. This document defines the workflow. The *Local setup* section is filled in when the application is scaffolded (M1), with commands that have actually been run.

## Local setup

Not available yet. When it is written, it will cover:

- the required Node.js version, pinned in a version file;
- installing dependencies with pnpm from the committed lockfile;
- starting PostgreSQL with Docker Compose;
- creating `.env` from `.env.example`;
- applying migrations and loading synthetic seed data;
- running the app, tests, and checks.

Every command listed here must be one that has been run successfully on a clean checkout.

## Branches and commits

- `main` is the integration branch. It only changes through pull requests.
- Branch names follow `<type>/<short-topic>`, for example `docs/m0-foundations`, `feat/catalog-crud`, `fix/publish-revalidation`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, with an optional scope such as `feat(catalog): add album edit form`. Subjects are imperative, lowercase, and have no trailing period.
- Keep each branch to one concern, and keep pull requests small enough to review in one sitting.
- Never force-push `main`. Force-pushing your own unshared topic branch is acceptable.

## Pull requests

Each pull request description contains:

1. **Scope:** what changed and why, plus what is deliberately out of scope.
2. **Decisions:** any trade-off made, and a link to an ADR if one was written.
3. **Verification:** the commands run and their actual results, plus screenshots from the real application for UI changes.
4. **Risk:** effects on data, privacy, migrations, or accessibility.
5. **Follow-up:** known gaps.

Merge only after the required checks pass and the PR has had an independent review where one is available: a second person, or a review agent that did not write the change. Nobody merges their own PR automatically, and branch protection is never bypassed.

### Repository protection

The GitHub repository is private. On its current plan, GitHub refuses branch protection for private repositories (the API returned HTTP 403, "Upgrade to GitHub Pro or make this repository public", on 2026-10-31). Until protection is available, the rules above are enforced by convention and must be followed as if they were enforced:

- changes reach `main` only through pull requests;
- no force pushes and no branch deletion on `main`;
- required checks must pass before merging, once CI exists (M1).

If the plan changes or the repository becomes public, enable these as protection rules.

## Quality gates

Planned for CI (GitHub Actions) as soon as the scaffold exists:

| Gate | Purpose |
| --- | --- |
| Format check | Consistent formatting |
| Lint | Code rules, including import boundaries between modules |
| Type check | TypeScript strict mode |
| Unit tests | Domain rules (ratings, state transitions, slug rules) |
| Integration tests | Against a real PostgreSQL service container: constraints, transactions, the published-only filter, academic queries |
| Build | Production build succeeds |
| End-to-end smoke | Playwright: critical studio and public flows |

Workflows use minimal `permissions`, a concurrency group per branch, and no production secrets.

## Testing approach

- **Domain rules:** unit tests with no database.
- **Persistence and SQL:** integration tests against real PostgreSQL. Database behavior is not mocked: foreign keys, `CHECK` constraints, and transactions are exactly what these tests must prove.
- **Privacy:** the tests listed in [Security § Required tests](security.md#required-tests).
- **UI:** Playwright for complete flows, including keyboard operation of the rating input, the language menu, and dialogs. Run at desktop width and at 390px.
- **Fixtures:** synthetic and clearly labeled. Real writing never appears in tests.

## Database changes

1. Change the Drizzle schema.
2. Generate a migration and **read the generated SQL**.
3. Check for data loss: dropped columns, changed types, removed constraints on authored tables.
4. Apply it to a local database that contains data, not only to an empty one.
5. Commit the schema change and the migration together, and describe the migration in the PR.

## Documentation

- All repository documentation, code comments, commit messages, issues, and PR descriptions are in English. Interface strings are maintained in English and Brazilian Portuguese.
- When behavior changes, the relevant document changes in the same PR.
- A significant architectural or data decision gets an ADR in [`docs/decisions/`](decisions/).
- Write in present tense for what exists, and label planned functionality explicitly as planned.
