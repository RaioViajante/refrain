import { TrackScreen, trackMetadata } from "@/app/studio/tracks/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <TrackScreen params={params} locale="en" />;
}

export const metadata = trackMetadata("en");
