import {
  NewMemoryScreen,
  newMemoryMetadata,
} from "@/app/studio/memories/new/screen";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ searchParams }: Props) {
  return <NewMemoryScreen searchParams={searchParams} locale="en" />;
}

export const metadata = newMemoryMetadata("en");
