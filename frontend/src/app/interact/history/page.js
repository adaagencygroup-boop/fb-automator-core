import { Suspense } from "react";
import AccFarmModule from "@/modules/module_03_acc_farm";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử đăng bài & tương tác (/interact/history)
// ?campaign=<id>[&slot=<id>]: lọc bài của 1 chiến dịch đăng bài (từ Quản lý chiến dịch)
export const metadata = pageMetadata("interact.history");

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Đang tải lịch sử...</div>}>
      <AccFarmModule subPage="interact.history" />
    </Suspense>
  );
}
