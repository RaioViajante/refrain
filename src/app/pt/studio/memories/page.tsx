import { MemoriesScreen, memoriesMetadata } from "@/app/studio/memories/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <MemoriesScreen searchParams={searchParams} locale="pt-BR" />;
}

export const metadata = memoriesMetadata("pt-BR");
