import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { NotFoundView } from "@/app/not-found-view";

export const metadata = notFoundMetadata("pt-BR");

export default function NotFound() {
  return <NotFoundView locale="pt-BR" />;
}
