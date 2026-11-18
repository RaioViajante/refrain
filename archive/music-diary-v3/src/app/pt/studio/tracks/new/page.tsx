import {
  NewTrackScreen,
  newTrackMetadata,
} from "@/app/studio/tracks/new/screen";

export default function Page() {
  return <NewTrackScreen locale="pt-BR" />;
}

export const metadata = newTrackMetadata("pt-BR");
