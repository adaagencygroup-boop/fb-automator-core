import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Tải Video Tiktok (/pages/tiktok)
export const metadata = pageMetadata("pages.tiktok");

export default function Page() {
  return <PageManagerModule subPage="pages.tiktok" />;
}
