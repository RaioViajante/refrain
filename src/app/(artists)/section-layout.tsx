import { PublicFrame } from "@/app/(public)/_components/public-frame";

// Presentation only, as the album journal's layout is: the proxy decides the
// status of an artist address, the page resolves it again through the
// publication queries, and the public-reads switch guards both. A route group
// of its own so that the header marks "Artists" as the current section,
// without changing the album journal's route (M3.1, ADR 0006 A2).
export default function ArtistsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PublicFrame current="artists" inside>
      {children}
    </PublicFrame>
  );
}
