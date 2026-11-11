import { StudioLayout, studioLayoutMetadata } from "@/app/studio/studio-layout";

type Props = Readonly<{ children: React.ReactNode }>;

export default function Layout({ children }: Props) {
  return <StudioLayout locale="pt-BR">{children}</StudioLayout>;
}

export const metadata = studioLayoutMetadata("pt-BR");
