import { TracksScreen, tracksMetadata } from "@/app/studio/tracks/screen";

export default function Page() {
  return <TracksScreen locale="en" />;
}

export const metadata = tracksMetadata("en");
