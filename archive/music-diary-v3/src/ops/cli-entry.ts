// Entry point of the local backup commands (./backup.ts), run through the
// package scripts `db:backup` and `db:backup:verify`.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  COMPARED_TABLES,
  OpsError,
  parseArguments,
  runBackup,
  runVerify,
} from "./backup";

const root = resolve(__dirname, "..", "..");

async function main(): Promise<number> {
  // Local configuration lives in .env; variables already set take precedence.
  if (existsSync(resolve(root, ".env"))) {
    process.loadEnvFile(resolve(root, ".env"));
  }
  try {
    const command = parseArguments(process.argv.slice(2));
    if (command.command === "backup") {
      const result = await runBackup({
        target: command.target,
        output: command.output,
        env: process.env,
        repositoryRoot: root,
      });
      console.log(
        [
          `Backup written: ${result.output}`,
          `  size: ${result.bytes} bytes, sha256: ${result.sha256}`,
          `  source: the ${result.service} service (sessions and rate-limit data are not included)`,
          "",
          "This backup is NOT verified. It holds private writing and the author's",
          "password hash. Keep it off this device's repository, and prove it can be",
          "restored before relying on it:",
          `  pnpm db:backup:verify --file=${result.output} --compare-with=${command.target}`,
        ].join("\n"),
      );
      return 0;
    }
    const result = await runVerify({
      file: command.file,
      compareWith: command.compareWith,
      postgres: command.postgres,
      env: process.env,
      repositoryRoot: root,
    });
    console.log(
      [
        `Restored into a new scratch database on the disposable PostgreSQL ${result.serverMajor} test container (${result.restoreServer}): ${result.scratch}`,
        `  migrations applied: ${result.migrations}`,
        ...Object.entries(result.counts).map(([t, n]) => `  ${t}: ${n} rows`),
        result.checksumChecked
          ? "The archive matches its .sha256 file."
          : "No .sha256 file was found next to the archive, so its integrity was not checked.",
        result.compared
          ? `Every row of the ${COMPARED_TABLES.length} compared tables (the writing, its status and publication history, deletion, versions, slugs, the catalog, and the author's account) equals the source's, and the migration count matches. The three session and rate-limit tables are deliberately empty in a backup.`
          : "Not compared with a source (no --compare-with): the archive restored without error, nothing more is claimed.",
        result.restoreServer === "postgres-test-18"
          ? "The scratch database is discarded by pnpm db:test18:down."
          : "The scratch database is discarded by pnpm db:test:down.",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    // Only messages written for the person: never a connection string.
    console.error(
      error instanceof OpsError
        ? error.message
        : "The command failed unexpectedly. Nothing was printed that could hold a secret.",
    );
    return 1;
  }
}

void main().then((code) => process.exit(code));
