import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Tải Youtube Short (/pages/youtube)
export const metadata = pageMetadata("pages.youtube");

export default function Page() {
  return <PageManagerModule subPage="pages.youtube" />;
}
