import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { MemoryEditor } from "@/app/studio/memories/memory-editor";
import { recordingFacts } from "@/app/studio/memories/recordings";
import { RestoreMemoryButton } from "@/app/studio/memories/restore-memory-button";
import { StatusMark } from "@/app/studio/status-mark";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import { formatDate } from "@/i18n/format";
import type { InterfaceLocale } from "@/i18n/locales";
import { listRecordingChoices } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";
import { getMemory, textToParagraphs } from "@/modules/journals";

// A fixed title: the memory's own words never reach page metadata.
export function memoryMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.memory };
}

type MemoryProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: InterfaceLocale;
};

export function MemoryScreen({ params, searchParams, locale }: MemoryProps) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Memory params={params} searchParams={searchParams} locale={locale} />
    </Suspense>
  );
}

async function Memory({ params, searchParams, locale }: MemoryProps) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const w = speech.words.memory;
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
    return <DeletedMemory speech={speech} memory={memory} />;
  }

  // Only a fixed word picks the notice; the query string is never shown.
  const restoredNotice =
    restored === "private"
      ? w.restoredPrivate
      : restored === "1"
        ? w.restored
        : null;

  return (
    <StudioFrame
      locale={locale}
      path={`/studio/memories/${memory.entryId}`}
      current="memories"
      layout="wide"
    >
      {restoredNotice ? (
        <p role="status" className="studio-panel" style={{ marginBottom: 24 }}>
          {restoredNotice}
        </p>
      ) : null}
      {memory.body === null ? (
        <UnsupportedMemory speech={speech} />
      ) : (
        <MemoryEditor
          edit={{
            entryId: memory.entryId,
            version: memory.version,
            locale: memory.locale,
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
function UnsupportedMemory({
  speech: { words, href },
}: {
  speech: StudioSpeech;
}) {
  return (
    <div className="studio-panel space-y-3">
      <p>
        <Link href={href("/studio/memories")} className="studio-link">
          {words.memory.back}
        </Link>
      </p>
      <h1 className="studio-section-title">{words.memory.unsupportedTitle}</h1>
      <p>{words.memory.unsupportedBody}</p>
    </div>
  );
}

function DeletedMemory({
  speech: { locale, words, href },
  memory,
}: {
  speech: StudioSpeech;
  memory: NonNullable<Awaited<ReturnType<typeof getMemory>>>;
}) {
  const w = words.memory;
  const paragraphs =
    memory.body === null ? null : textToParagraphs(memory.body);
  const deletedOn = formatDate(locale, memory.deletedAt!);
  return (
    <StudioFrame
      locale={locale}
      path={`/studio/memories/${memory.entryId}`}
      current="memories"
    >
      <p>
        <Link href={href("/studio/journals/deleted")} className="studio-link">
          {w.backToDeleted}
        </Link>
      </p>
      <p className="studio-meta">{w.inDeletedKind}</p>
      <h1 className="studio-title" lang={memory.locale}>
        {memory.title}
      </h1>
      <p className="studio-meta">
        <StatusMark locale={locale} status={memory.status} />
        {w.deletedFacts(memory.wordCount, deletedOn)}
      </p>

      <div className="studio-panel space-y-3">
        <p>
          {w.inDeleted(deletedOn)}
          {memory.versions.some((version) => version.status === "published")
            ? w.wasPublished
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
          <p className="studio-panel" lang={locale}>
            {words.journal.unsupported}
          </p>
        ) : paragraphs.length === 0 ? (
          <p className="studio-hint" lang={locale}>
            {words.desk.nothingWritten}
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
          {w.music}
        </h2>
        {memory.recordings.length === 0 ? (
          <p className="studio-hint">{words.review.noSongs}</p>
        ) : (
          <ol className="studio-list">
            {memory.recordings.map((recording) => (
              <li key={recording.trackId} className="studio-row">
                <span className="studio-row-title">{recording.title}</span>
                <span className="studio-meta">
                  {recordingFacts(words, recording)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </StudioFrame>
  );
}
