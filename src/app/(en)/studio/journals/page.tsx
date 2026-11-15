import { JournalsScreen, journalsMetadata } from "@/app/studio/journals/screen";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <JournalsScreen locale="en" searchParams={searchParams} />;
}

export const metadata = journalsMetadata("en");
