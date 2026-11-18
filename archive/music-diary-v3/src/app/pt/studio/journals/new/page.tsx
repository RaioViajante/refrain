import {
  NewJournalScreen,
  newJournalMetadata,
} from "@/app/studio/journals/new/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <NewJournalScreen searchParams={searchParams} locale="pt-BR" />;
}

export const metadata = newJournalMetadata("pt-BR");
