import { SystemScreen, systemMetadata } from "@/app/studio/system/screen";

export default function Page() {
  return <SystemScreen locale="en" />;
}

export const metadata = systemMetadata("en");
