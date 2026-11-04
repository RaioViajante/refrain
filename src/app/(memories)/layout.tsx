import { PublicFrame } from "@/app/(public)/_components/public-frame";

// Presentation only, as the album journal's and the artist pages' layouts
// are: the proxy decides the status of a memory address, the page resolves it
// again through the publication queries, and the public-reads switch guards
// both. A route group of its own so that the header marks "Memories" as the
// current section (M3.7).
export default function MemoriesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PublicFrame current="memories" inside>
      {children}
    </PublicFrame>
  );
}
