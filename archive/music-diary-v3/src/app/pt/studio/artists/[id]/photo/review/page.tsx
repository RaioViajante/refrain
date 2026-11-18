import {
  PhotoReviewScreen,
  photoReviewMetadata,
} from "@/app/studio/artists/[id]/photo/review/screen";

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default function Page({ params, searchParams }: Props) {
  return (
    <PhotoReviewScreen
      params={params}
      searchParams={searchParams}
      locale="pt-BR"
    />
  );
}

export const metadata = photoReviewMetadata("pt-BR");
