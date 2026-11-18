import { StudioLayout, studioLayoutMetadata } from "@/app/studio/studio-layout";

type Props = Readonly<{ children: React.ReactNode }>;

export default function Layout({ children }: Props) {
  return <StudioLayout locale="en">{children}</StudioLayout>;
}

export const metadata = studioLayoutMetadata("en");
