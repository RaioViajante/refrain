import {
  MemoryScreen,
  memoryMetadata,
} from "@/app/studio/memories/[id]/screen";

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ params, searchParams }: Props) {
  return (
    <MemoryScreen params={params} searchParams={searchParams} locale="en" />
  );
}

export const metadata = memoryMetadata("en");
