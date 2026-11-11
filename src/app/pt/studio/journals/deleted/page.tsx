import {
  DeletedScreen,
  deletedMetadata,
} from "@/app/studio/journals/deleted/screen";

export default function Page() {
  return <DeletedScreen locale="pt-BR" />;
}

export const metadata = deletedMetadata("pt-BR");
