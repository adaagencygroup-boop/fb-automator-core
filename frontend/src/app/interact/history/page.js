import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử đăng bài & tương tác (/interact/history)
export const metadata = pageMetadata("interact.history");

export default function Page() {
  return <AccFarmModule subPage="interact.history" />;
}
