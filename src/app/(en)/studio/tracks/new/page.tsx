import {
  NewTrackScreen,
  newTrackMetadata,
} from "@/app/studio/tracks/new/screen";

export default function Page() {
  return <NewTrackScreen locale="en" />;
}

export const metadata = newTrackMetadata("en");
