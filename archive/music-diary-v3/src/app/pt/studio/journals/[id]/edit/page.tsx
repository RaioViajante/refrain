import {
  EditJournalScreen,
  editJournalMetadata,
} from "@/app/studio/journals/[id]/edit/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <EditJournalScreen params={params} locale="pt-BR" />;
}

export const metadata = editJournalMetadata("pt-BR");
