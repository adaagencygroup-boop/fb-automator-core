import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Tương tác tài khoản (/interact/engage)
export const metadata = pageMetadata("interact.engage");

export default function Page() {
  return <AccFarmModule subPage="interact.engage" />;
}
