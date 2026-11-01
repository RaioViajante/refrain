import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { AlbumForm, emptyAlbum } from "@/app/studio/albums/album-form";
import { accessDenied } from "@/app/studio/access";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { listArtists } from "@/modules/catalog";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Add an album · refrain" };

export default function NewAlbumPage({
  searchParams,
}: {
  searchParams: Promise<{ artist?: string }>;
}) {
  return (
    <Suspense fallback={<StudioLoading />}>
      <NewAlbum searchParams={searchParams} />
    </Suspense>
  );
}

async function NewAlbum({
  searchParams,
}: {
  searchParams: Promise<{ artist?: string }>;
}) {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  const artists = (await listArtists(authorization.author)).filter(
    (artist) => !artist.archived,
  );
  // A link from an artist's page can name the first credit. It is only used if
  // it is one of the artists listed above.
  const { artist } = await searchParams;
  const preselected = artists.find((candidate) => candidate.id === artist);

  return (
    <StudioFrame current="albums">
      <p>
        <Link href="/studio/albums" className="studio-link">
          ← Albums
        </Link>
      </p>
      <h1 className="studio-title">Add an album</h1>
      <AlbumForm
        initial={{
          ...emptyAlbum,
          credits: [{ artistId: preselected?.id ?? "", creditedAs: "" }],
        }}
        artistOptions={artists.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
        }))}
      />
    </StudioFrame>
  );
}
