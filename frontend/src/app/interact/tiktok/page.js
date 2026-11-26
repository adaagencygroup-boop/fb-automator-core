import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Tải video từ TikTok (/interact/tiktok)
export const metadata = pageMetadata("interact.tiktok");

export default function Page() {
  return <AccFarmModule subPage="interact.tiktok" />;
}
