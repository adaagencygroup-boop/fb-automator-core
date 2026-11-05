import PageCreatorModule from "@/modules/module_04_page_creator";
import { pageMetadata } from "@/config/navigation";

export const metadata = pageMetadata("creator.history");

export default function Page() {
  return <PageCreatorModule subPage="creator.history" />;
}

