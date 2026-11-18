import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { formatDuration } from "@/app/studio/format";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { studio, type StudioSpeech } from "@/app/studio/studio-words";
import type { InterfaceLocale } from "@/i18n/locales";
import { listTracks, type TrackSummary } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export function tracksMetadata(locale: InterfaceLocale): Metadata {
  return { title: studio(locale).words.meta.tracks };
}

export function TracksScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <Tracks locale={locale} />
    </Suspense>
  );
}

async function Tracks({ locale }: { locale: InterfaceLocale }) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const speech = studio(locale);
  const { href } = speech;
  const w = speech.words.tracks;
  const tracks = await listTracks(authorization.author);
  const active = tracks.filter((track) => !track.archived);
  const archived = tracks.filter((track) => track.archived);

  return (
    <StudioFrame locale={locale} path="/studio/tracks" current="tracks">
      <h1 className="studio-title">{w.title}</h1>
      <p className="studio-lede">{w.lead}</p>
      <p>
        <Link href={href("/studio/tracks/new")} className="studio-button">
          {w.add}
        </Link>
      </p>

      {tracks.length === 0 ? (
        <div className="studio-panel">
          <p className="studio-section-title">{w.emptyTitle}</p>
          <p>{w.emptyBody}</p>
        </div>
      ) : (
        <>
          <TrackList speech={speech} tracks={active} label={w.listLabel} />
          {archived.length > 0 ? (
            <section aria-labelledby="archived-tracks">
              <h2 id="archived-tracks" className="studio-section-title">
                {w.archived}
              </h2>
              <TrackList
                speech={speech}
                tracks={archived}
                label={w.archivedLabel}
              />
            </section>
          ) : null}
        </>
      )}
    </StudioFrame>
  );
}

function TrackList({
  speech: { words, href },
  tracks,
  label,
}: {
  speech: StudioSpeech;
  tracks: TrackSummary[];
  label: string;
}) {
  return (
    <ul className="studio-list" aria-label={label}>
      {tracks.map((track) => (
        <li key={track.id} className="studio-row">
          <span className="studio-row-title">
            <Link href={href(`/studio/tracks/${track.id}`)}>{track.title}</Link>
          </span>
          <span className="studio-meta">
            {[
              track.artistNames,
              formatDuration(track.lengthMs),
              track.albumCount === 0
                ? words.tracks.onNoAlbum
                : words.tracks.onAlbums(track.albumCount),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
