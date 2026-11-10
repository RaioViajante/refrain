import { PublicFrame } from "./_components/public-frame";

// Presentation only. A layout is not the control: the proxy decides the status
// of a public address, the page resolves it again through the publication
// queries, and the public-reads switch guards both.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PublicFrame current="albums" inside>
      {children}
    </PublicFrame>
  );
}
