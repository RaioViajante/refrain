import {
  JournalScreen,
  journalMetadata,
} from "@/app/studio/journals/[id]/screen";

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ params, searchParams }: Props) {
  return (
    <JournalScreen params={params} searchParams={searchParams} locale="en" />
  );
}

export const metadata = journalMetadata("en");
