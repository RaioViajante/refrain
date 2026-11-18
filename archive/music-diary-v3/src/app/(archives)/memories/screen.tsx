import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  listPublicMemoryArchive,
  publicReadsEnabled,
  type PublicMemoryCard,
} from "@/modules/publication/public";

import { archiveMetadata } from "@/app/(archives)/_components/archive-metadata";
import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { dictionaryFor } from "@/i18n/dictionaries";
import type { InterfaceLocale } from "@/i18n/locales";

import { MemoriesArchive } from "./memories-archive";

// The public Memories archive (M3.8a; the approved V4.4 `Memories` screen),
// anonymous, read through the Publication module's reading entry point alone:
// every memory whose address is served, the newest publication first. While
// public reads are off the proxy answers the unknown-address `404` before this
// page renders (ADR 0006, D4; src/proxy.ts); the page checks the switch again
// itself. Rendered per request in one pass (`instant = false`), cached
// nowhere, `no-store` (next.config.ts).

// The interface language reaches the read only as the reader's locale, which
// selects among versions that are already public (ADR 0002, D1.2; ADR 0006
// A7, item 1). It is never an input to what is visible.

type Loaded =
  | { kind: "list"; memories: PublicMemoryCard[] }
  | { kind: "unavailable" }
  | { kind: "not_found" };

async function load(locale: InterfaceLocale): Promise<Loaded> {
  // Runtime only, never at build time; outside the `try`.
  await connection();
  if (!publicReadsEnabled()) {
    return { kind: "not_found" };
  }
  try {
    return {
      kind: "list",
      memories: await listPublicMemoryArchive(locale),
    };
  } catch {
    // Never logged: a driver message can carry connection details.
    return { kind: "unavailable" };
  }
}

export async function memoriesArchiveMetadata(
  locale: InterfaceLocale,
): Promise<Metadata> {
  await connection();
  if (!publicReadsEnabled()) {
    return notFoundMetadata(locale);
  }
  const t = dictionaryFor(locale).archives.memories;
  return archiveMetadata(locale, "/memories", t.title, t.lead.text);
}

export async function MemoriesArchiveScreen({
  locale,
}: Readonly<{ locale: InterfaceLocale }>) {
  const loaded = await load(locale);
  if (loaded.kind === "not_found") {
    notFound();
  }
  return (
    <MemoriesArchive
      memories={loaded.kind === "list" ? loaded.memories : null}
      locale={locale}
    />
  );
}
