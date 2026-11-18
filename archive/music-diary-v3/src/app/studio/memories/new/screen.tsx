import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { MemoryEditor } from "@/app/studio/memories/memory-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { listRecordingChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function newMemoryMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.newMemory };
}

type NewMemoryProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
};

export function NewMemoryScreen({ searchParams, locale }: NewMemoryProps) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <NewMemory searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function NewMemory({ searchParams, locale }: NewMemoryProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const choices = await listRecordingChoices(authorization.author);
  // "Write a memory about this song" arrives with the recording. Only a
  // recording that exists and is not archived is taken; anything else starts
  // with no songs.
  const { track } = await searchParams;
  const preselected = choices.filter((choice) => choice.trackId === track);

  return (
    <StudioFrame
      locale={locale}
      path={
        preselected.length > 0
          ? `/studio/memories/new?track=${preselected[0]!.trackId}`
          : "/studio/memories/new"
      }
      current="memories"
      layout="wide"
    >
      <MemoryEditor
        create
        initial={{
          title: "",
          rememberedWhen: "",
          body: "",
          recordings: preselected,
        }}
        choices={choices}
      />
    </StudioFrame>
  );
}
