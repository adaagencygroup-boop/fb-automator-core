import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Danh sách Fanpage (/pages/list)
export const metadata = pageMetadata("pages.list");

export default function Page() {
  return <PageManagerModule subPage="pages.list" />;
}
