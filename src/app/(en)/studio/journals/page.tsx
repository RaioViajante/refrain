import { JournalsScreen, journalsMetadata } from "@/app/studio/journals/screen";

export default function Page() {
  return <JournalsScreen locale="en" />;
}

export const metadata = journalsMetadata("en");
