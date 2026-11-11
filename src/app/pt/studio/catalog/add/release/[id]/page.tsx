import {
  AddReleaseScreen,
  addReleaseMetadata,
} from "@/app/studio/catalog/add/release/[id]/screen";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default function Page({ params }: Props) {
  return <AddReleaseScreen params={params} locale="pt-BR" />;
}

export const metadata = addReleaseMetadata("pt-BR");
