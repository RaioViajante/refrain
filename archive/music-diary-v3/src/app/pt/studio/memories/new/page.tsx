import {
  NewMemoryScreen,
  newMemoryMetadata,
} from "@/app/studio/memories/new/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <NewMemoryScreen searchParams={searchParams} locale="pt-BR" />;
}

export const metadata = newMemoryMetadata("pt-BR");
