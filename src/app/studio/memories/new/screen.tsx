import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { MemoryEditor } from "@/app/studio/memories/memory-editor";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listRecordingChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Write a memory · refrain" };

type NewMemoryProps = {
  searchParams: Promise<{ track?: string | string[] }>;
};

export default function NewMemoryPage({ searchParams }: NewMemoryProps) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <NewMemory searchParams={searchParams} />
    </Suspense>
  );
}

async function NewMemory({ searchParams }: NewMemoryProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const choices = await listRecordingChoices(authorization.author);
  // "Write a memory about this song" arrives with the recording. Only a
  // recording that exists and is not archived is taken; anything else starts
  // with no songs.
  const { track } = await searchParams;
  const preselected = choices.filter((choice) => choice.trackId === track);

  return (
    <StudioFrame current="memories" layout="wide">
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
