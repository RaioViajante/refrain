import { JournalsScreen, journalsMetadata } from "@/app/studio/journals/screen";

export default function Page() {
  return <JournalsScreen locale="pt-BR" />;
}

export const metadata = journalsMetadata("pt-BR");
