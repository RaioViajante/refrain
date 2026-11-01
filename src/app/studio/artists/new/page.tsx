import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { ArtistForm } from "@/app/studio/artists/artist-form";
import { StudioFrame } from "@/app/studio/frame";
import { StudioLoading } from "@/app/studio/studio-loading";
import { authorizeAuthor } from "@/modules/identity";

export const metadata: Metadata = { title: "Add an artist · refrain" };

export default function NewArtistPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <NewArtist />
    </Suspense>
  );
}

async function NewArtist() {
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason);
  }
  return (
    <StudioFrame current="artists">
      <p>
        <Link href="/studio/artists" className="studio-link">
          ← Artists
        </Link>
      </p>
      <h1 className="studio-title">Add an artist</h1>
      <ArtistForm />
    </StudioFrame>
  );
}
