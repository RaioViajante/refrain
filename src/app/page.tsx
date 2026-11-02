// Placeholder for the homepage. The approved V4.4 homepage replaces it in M3;
// docs/design-system.md remains authoritative. It is public, so it says nothing
// about the system: M1.1's database status line was removed in M3.1, because an
// anonymous visitor could read whether the database was reachable.
export default function DevelopmentPage() {
  return (
    <main className="mx-auto max-w-prose space-y-4 px-4 py-16">
      <h1 className="text-2xl">refrain</h1>
      <p>Development build. The approved homepage is not built yet.</p>
    </main>
  );
}
