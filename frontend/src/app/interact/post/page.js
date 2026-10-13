import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Đăng bài viết Facebook (/interact/post)
export const metadata = pageMetadata("interact.post");

export default function Page() {
  return <AccFarmModule subPage="interact.post" />;
}
