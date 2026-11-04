import "server-only";

import type { DatabaseExecutor } from "@/db";

// One consistent snapshot, without a lock: a read-only REPEATABLE READ
// transaction, so every statement inside it sees the database as it was when
// the first one began. The previews use it (ADR 0006 § 7, L5), and so does the
// public Home (A6, item 8), which is why it lives apart from the locks: the
// reading entry point may import this file and never `lock.ts`.
//
// Inside a transaction already (a test, or a command that composes), it reads
// in that transaction.
export async function inSnapshot<Result>(
  db: DatabaseExecutor,
  work: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  if ("rollback" in db) {
    return work(db);
  }
  return db.transaction(work, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
