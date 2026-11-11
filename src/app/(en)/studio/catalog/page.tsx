import { CatalogScreen, catalogMetadata } from "@/app/studio/catalog/screen";

export default function Page() {
  return <CatalogScreen locale="en" />;
}

export const metadata = catalogMetadata("en");
