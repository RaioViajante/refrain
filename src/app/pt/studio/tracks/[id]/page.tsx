import { TrackScreen, trackMetadata } from "@/app/studio/tracks/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <TrackScreen params={params} locale="pt-BR" />;
}

export const metadata = trackMetadata("pt-BR");
