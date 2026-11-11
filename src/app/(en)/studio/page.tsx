import { DeskScreen, deskMetadata } from "@/app/studio/screen";

export default function Page() {
  return <DeskScreen locale="en" />;
}

export const metadata = deskMetadata("en");
