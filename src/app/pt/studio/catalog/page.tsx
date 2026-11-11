import { CatalogScreen, catalogMetadata } from "@/app/studio/catalog/screen";

export default function Page() {
  return <CatalogScreen locale="pt-BR" />;
}

export const metadata = catalogMetadata("pt-BR");
