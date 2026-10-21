import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";
export const metadata = pageMetadata("pages.history");
export default function Page() {
  return <PageManagerModule subPage="pages.history" />;
}
