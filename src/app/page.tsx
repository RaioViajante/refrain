import { connection } from "next/server";
import { Suspense } from "react";

import { checkDatabaseConnection } from "@/db";

// Development page for the application foundation (M1.1). The approved V4.4
// homepage replaces it in M3; docs/design-system.md remains authoritative.
export default function DevelopmentPage() {
  return (
    <main className="mx-auto max-w-prose space-y-4 px-4 py-16">
      <h1 className="text-2xl">refrain</h1>
      <p>Development build. The journal is not available yet.</p>
      <Suspense fallback={<p>Database: checking…</p>}>
        <DatabaseStatus />
      </Suspense>
    </main>
  );
}

async function DatabaseStatus() {
  // Checked on every request, never at build time.
  await connection();
  const connected = await checkDatabaseConnection();
  return <p>Database: {connected ? "connected" : "not reachable"}</p>;
}
