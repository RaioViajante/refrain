import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicMemoryArchive,
  publicReadsEnabled,
  type PublicMemoryCard,
} from "@/modules/publication/public";

import {
  archiveMetadata,
  NOT_FOUND_METADATA,
} from "@/app/(archives)/_components/archive-metadata";

import { MemoriesArchive, MEMORIES_LEAD } from "./memories-archive";

// The public Memories archive (M3.8a; the approved V4.4 `Memories` screen),
// anonymous, read through the Publication module's reading entry point alone:
// every memory whose address is served, the newest publication first. While
// public reads are off the proxy answers the unknown-address `404` before this
// page renders (ADR 0006, D4; src/proxy.ts); the page checks the switch again
// itself. Rendered per request in one pass (`instant = false`), cached
// nowhere, `no-store` (next.config.ts).

// The interface is English until next-intl arrives; this selects the version
// of each memory only (ADR 0002, D1.2).
const READER_LOCALE = "en";

type Loaded =
  | { kind: "list"; memories: PublicMemoryCard[] }
  | { kind: "unavailable" }
  | { kind: "not_found" };

async function load(): Promise<Loaded> {
  // Runtime only, never at build time; outside the `try`.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  try {
    return {
      kind: "list",
      memories: await listPublicMemoryArchive(READER_LOCALE),
    };
  } catch {
    // Never logged: a driver message can carry connection details.
    return { kind: "unavailable" };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return NOT_FOUND_METADATA;
  }
  return archiveMetadata("/memories", "Memories", MEMORIES_LEAD);
}

export default async function MemoriesArchivePage() {
  const loaded = await load();
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <MemoriesArchive
      memories={loaded.kind === "list" ? loaded.memories : null}
    />
  );
}
