import {
  AddAlbumScreen,
  addAlbumMetadata,
} from "@/app/studio/catalog/add/album/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <AddAlbumScreen params={params} locale="en" />;
}

export const metadata = addAlbumMetadata("en");
