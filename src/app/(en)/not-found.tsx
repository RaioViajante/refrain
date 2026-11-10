import { NotFoundView, notFoundMetadata } from "@/app/not-found-view";

export const metadata = notFoundMetadata;

export default function NotFound() {
  return <NotFoundView />;
}
