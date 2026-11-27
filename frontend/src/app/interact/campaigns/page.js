import { Suspense } from "react";
import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Quản lý chiến dịch đăng bài Status nhiều khung giờ (/interact/campaigns)
export const metadata = pageMetadata("interact.campaigns");

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Đang tải chiến dịch...</div>}>
      <AccFarmModule subPage="interact.campaigns" />
    </Suspense>
  );
}
