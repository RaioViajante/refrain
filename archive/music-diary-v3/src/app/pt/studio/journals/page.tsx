import { JournalsScreen, journalsMetadata } from "@/app/studio/journals/screen";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <JournalsScreen locale="pt-BR" searchParams={searchParams} />;
}

export const metadata = journalsMetadata("pt-BR");
