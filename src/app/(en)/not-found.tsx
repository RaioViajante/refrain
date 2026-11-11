import { notFoundMetadata } from "@/app/(public)/_components/page-metadata";
import { NotFoundView } from "@/app/not-found-view";

export const metadata = notFoundMetadata("en");

export default function NotFound() {
  return <NotFoundView locale="en" />;
}
