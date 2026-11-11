import {
  AddMusicScreen,
  addMusicMetadata,
} from "@/app/studio/catalog/add/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <AddMusicScreen searchParams={searchParams} locale="pt-BR" />;
}

export const metadata = addMusicMetadata("pt-BR");
