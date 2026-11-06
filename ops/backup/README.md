# ops/backup

The hosted-backup toolchain for Refrain's PostgreSQL 18 database (F-02,
issue #65). Read [docs/hosted-backups.md](../../docs/hosted-backups.md) first:
it is the design, the runbook, and the owner's drill.

| File | Purpose |
| --- | --- |
| `Dockerfile` | PostgreSQL 18 client tools and age, pinned; never runs a server |
| `refrain-backup.sh` | `backup`, `check`, `drill` |
| `fingerprint.sql` | Structure and per-table digests, compared after every restore |
| `inventory.sql` | Entry identifiers and states, for the recovery review |
| `backup-role.sql` | The read-only `refrain_backup` role (for owner review; not applied) |
| `backup-role-audit.sql` | Read-only audit of that role's privileges |
| `automation/` | Templates for the private automation repository. GitHub does not run them here |

Tests: `pnpm test:backup` (src/ops/hosted-backup.backup.test.ts), on the
disposable PostgreSQL 18 test server only.
