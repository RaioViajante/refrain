import {
  AddReleaseScreen,
  addReleaseMetadata,
} from "@/app/studio/catalog/add/release/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <AddReleaseScreen params={params} locale="en" />;
}

export const metadata = addReleaseMetadata("en");
