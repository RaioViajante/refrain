import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDate, plural } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { MemoryEditor } from "@/app/studio/memories/memory-editor";
import { recordingFacts } from "@/app/studio/memories/recordings";
import { RestoreMemoryButton } from "@/app/studio/memories/restore-memory-button";
import { StatusMark } from "@/app/studio/status-mark";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listRecordingChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { getMemory, textToParagraphs } from "@/modules/journals";

// A fixed title: the memory's own words never reach page metadata.
export const metadata: Metadata = { title: "Memory · refrain" };

type MemoryProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ restored?: string | string[] }>;
};

export default function MemoryPage({ params, searchParams }: MemoryProps) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Memory params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Memory({ params, searchParams }: MemoryProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const { author } = authorization;
  const { id } = await params;
  const [memory, choices] = await Promise.all([
    getMemory(author, id),
    listRecordingChoices(author),
  ]);
  if (!memory) {
    notFound();
  }
  const { restored } = await searchParams;

  if (memory.deletedAt !== null) {
    return <DeletedMemory memory={memory} />;
  }

  // Only a fixed word picks the notice; the query string is never shown.
  const restoredNotice =
    restored === "private"
      ? "Restored from Recently deleted. It was published when it was deleted, and it is private now. Restoring publishes nothing."
      : restored === "1"
        ? "Restored from Recently deleted, with its writing and its songs exactly as you left them."
        : null;

  return (
    <StudioFrame current="memories" layout="wide">
      {restoredNotice ? (
        <p role="status" className="studio-panel" style={{ marginBottom: 24 }}>
          {restoredNotice}
        </p>
      ) : null}
      {memory.body === null ? (
        <UnsupportedMemory />
      ) : (
        <MemoryEditor
          edit={{
            entryId: memory.entryId,
            version: memory.version,
            status: memory.status,
            albumLinks: memory.albumLinks,
          }}
          initial={{
            title: memory.title,
            rememberedWhen: memory.rememberedWhen ?? "",
            body: memory.body,
            recordings: memory.recordings,
          }}
          choices={choices}
        />
      )}
    </StudioFrame>
  );
}

// Writing with formatting the plain editor cannot show without loss is never
// put in a textarea, so a save can never flatten it.
function UnsupportedMemory() {
  return (
    <div className="studio-panel space-y-3">
      <p>
        <Link href="/studio/memories" className="studio-link">
          ← Memories
        </Link>
      </p>
      <h1 className="studio-section-title">This memory can’t be edited here</h1>
      <p>
        Its writing has formatting that the plain editor can’t show without
        losing it, so it is left untouched.
      </p>
    </div>
  );
}

function DeletedMemory({
  memory,
}: {
  memory: NonNullable<Awaited<ReturnType<typeof getMemory>>>;
}) {
  const paragraphs =
    memory.body === null ? null : textToParagraphs(memory.body);
  return (
    <StudioFrame current="memories">
      <p>
        <Link href="/studio/journals/deleted" className="studio-link">
          ← Recently deleted
        </Link>
      </p>
      <p className="studio-meta">Memory, in Recently deleted</p>
      <h1 className="studio-title" lang={memory.locale}>
        {memory.title}
      </h1>
      <p className="studio-meta">
        <StatusMark status={memory.status} /> ·{" "}
        {plural(memory.wordCount, "word")} · deleted{" "}
        {formatDate(memory.deletedAt!)} (UTC)
      </p>

      <div className="studio-panel space-y-3">
        <p>
          This memory has been in Recently deleted since{" "}
          {formatDate(memory.deletedAt!)}. Its writing and its songs are kept,
          and it can’t be changed there until you restore it.
          {memory.versions.some((version) => version.status === "published")
            ? " It was published, and it returns as private."
            : ""}
        </p>
        <RestoreMemoryButton
          entryId={memory.entryId}
          title={memory.title}
          wasPublished={memory.versions.some(
            (version) => version.status === "published",
          )}
        />
      </div>

      <article lang={memory.locale} className="space-y-6">
        {memory.rememberedWhen ? (
          <p className="studio-meta">{memory.rememberedWhen}</p>
        ) : null}
        {paragraphs === null ? (
          <p className="studio-panel" lang="en">
            This text has formatting that the plain editor can’t show without
            losing it. It is untouched.
          </p>
        ) : paragraphs.length === 0 ? (
          <p className="studio-hint" lang="en">
            Nothing written yet.
          </p>
        ) : (
          <div className="studio-reading">
            {paragraphs.map((lines, index) => (
              <p key={index}>
                {lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </p>
            ))}
          </div>
        )}
      </article>

      <section aria-labelledby="deleted-music" className="space-y-3">
        <h2 id="deleted-music" className="studio-section-title">
          The music
        </h2>
        {memory.recordings.length === 0 ? (
          <p className="studio-hint">No songs.</p>
        ) : (
          <ol className="studio-list">
            {memory.recordings.map((recording) => (
              <li key={recording.trackId} className="studio-row">
                <span className="studio-row-title">{recording.title}</span>
                <span className="studio-meta">{recordingFacts(recording)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </StudioFrame>
  );
}
