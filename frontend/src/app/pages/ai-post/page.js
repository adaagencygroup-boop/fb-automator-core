import PageManagerModule from "@/modules/module_05_page_manager";
import { pageMetadata } from "@/config/navigation";

// Trang: Đăng bài AI (/pages/ai-post)
export const metadata = pageMetadata("pages.ai_post");

export default function Page() {
  return <PageManagerModule subPage="pages.ai_post" />;
}
