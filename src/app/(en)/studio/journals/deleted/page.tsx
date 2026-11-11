import {
  DeletedScreen,
  deletedMetadata,
} from "@/app/studio/journals/deleted/screen";

export default function Page() {
  return <DeletedScreen locale="en" />;
}

export const metadata = deletedMetadata("en");
