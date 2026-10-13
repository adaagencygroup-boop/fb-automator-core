import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Đăng Video Reels (/pages/reels)
export const metadata = pageMetadata("pages.reels");

export default function Page() {
  return <PageManagerModule subPage="pages.reels" />;
}
