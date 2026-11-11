import {
  EditJournalScreen,
  editJournalMetadata,
} from "@/app/studio/journals/[id]/edit/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <EditJournalScreen params={params} locale="en" />;
}

export const metadata = editJournalMetadata("en");
