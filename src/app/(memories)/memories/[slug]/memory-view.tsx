import Link from "next/link";
import { Fragment } from "react";

import type {
  PublicMemory,
  PublicMemoryMusic,
} from "@/modules/publication/public";

import { NoteIcon } from "@/app/(public)/_components/note-icon";
import { PUBLIC_CONTENT_ID } from "@/app/(public)/_components/public-frame";
import { RecordIcon } from "@/app/(public)/_components/record-icon";
import { renderDocument } from "@/app/(public)/_components/rich-text";

// The public memory (M3.7; the approved V4.4 `Memory` screen): the notebook
// layout, a 220px margin beside one writing column. The margin holds when it
// was, when it was published, the language it is written in, and "The music";
// the column holds the kind, the title in Kalam, and the writing. On a phone
// the writing comes first and the margin follows it.
//
// It renders only what the Publication read model returned, which is already
// limited to what a reader may see. It has no author control, no draft
// marker, no private metadata, no rating, no favourite, and no artwork (none
// is shown with a memory in this milestone): each song sits in the empty
// frame with the record mark. A song links nowhere by itself; its album links
// to that album's journal only when that journal is public, and a credited
// artist links to the artist's page only when it already has one.

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
};

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

function Artists({ song }: Readonly<{ song: PublicMemoryMusic }>) {
  return (
    <>
      {song.artists.map((artist, index) => (
        <Fragment key={index}>
          {index > 0 ? ", " : null}
          {artist.address ? (
            <Link className="pm-song-link" href={`/artists/${artist.address}`}>
              {artist.name}
            </Link>
          ) : (
            artist.name
          )}
        </Fragment>
      ))}
    </>
  );
}

function Song({ song }: Readonly<{ song: PublicMemoryMusic }>) {
  // For an album link the title is the album's own, so it is not repeated.
  const album = song.kind === "recording" ? song.album : null;
  const albumOwnJournal = song.kind === "album" ? song.album : null;
  return (
    <li className="pm-song">
      <span className="ph-art pm-song-art" aria-hidden="true">
        <span className="ph-art-fallback">
          <RecordIcon className="ph-art-icon" size={22} />
        </span>
      </span>
      <span className="pm-song-text">
        <span className="pm-song-title">
          {albumOwnJournal?.journalSlug ? (
            <Link
              className="pm-song-link"
              href={`/albums/${albumOwnJournal.journalSlug}`}
            >
              {song.title}
            </Link>
          ) : (
            song.title
          )}
        </span>
        {song.kind === "album" ? (
          // A whole album, not one recording: said in words, as the
          // reference's quiet line names the release ("Single").
          <span className="pm-song-line">Album</span>
        ) : null}
        {song.artists.length > 0 ? (
          <span
            className={`pm-song-line${song.artists.some((artist) => artist.address) ? " pm-song-line-links" : ""}`}
          >
            <Artists song={song} />
          </span>
        ) : null}
        {album ? (
          <span
            className={`pm-song-line${album.journalSlug ? " pm-song-line-links" : ""}`}
          >
            {album.journalSlug ? (
              <Link
                className="pm-song-link"
                href={`/albums/${album.journalSlug}`}
              >
                {album.title}
              </Link>
            ) : (
              album.title
            )}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function MemoryView({ memory }: Readonly<{ memory: PublicMemory }>) {
  const body = renderDocument(memory.body, 2);
  return (
    <main className="public-shell pm" id={PUBLIC_CONTENT_ID} tabIndex={-1}>
      <div className="pm-grid">
        <article className="pm-article" aria-labelledby="pm-title">
          <p className="pj-kind pm-kind">
            <NoteIcon />
            Memory
          </p>
          <h1 className="pm-title" id="pm-title" lang={memory.locale}>
            {memory.title}
          </h1>
          {body ? (
            <div className="pm-body" lang={memory.locale}>
              {body}
            </div>
          ) : null}
        </article>

        <aside className="pm-margin" aria-label="About this memory">
          <p className="pm-facts">
            {memory.rememberedWhen ? (
              <span className="pm-when" lang={memory.locale}>
                {memory.rememberedWhen}
              </span>
            ) : null}
            <span>
              Published{" "}
              <time dateTime={memory.publishedAt.toISOString()}>
                {date.format(memory.publishedAt)}
              </time>
            </span>
            <span>{`Written in ${LANGUAGE_NAMES[memory.locale] ?? memory.locale}`}</span>
          </p>
          {memory.music.length > 0 ? (
            <section aria-labelledby="pm-music">
              <h2 className="pm-music-title" id="pm-music">
                The music
              </h2>
              <ol className="pm-songs" role="list">
                {memory.music.map((song) => (
                  <Song key={song.number} song={song} />
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
