"use client";

import ComingSoon from "@/components/ComingSoon";
import FarmEngage from "./components/FarmEngage";
import FarmHistory from "./components/FarmHistory";

/**
 * Module 03: Đăng bài và tương tác tài khoản.
 *   interact.engage  -> Tab 1 Tương tác tài khoản (nuôi nick)
 *   interact.history -> Lịch sử (tab Tương tác tài khoản; tab Đăng Facebook thuộc Tab 2)
 *   interact.post    -> Tab 2 Đăng bài viết Facebook (làm riêng)
 */
export default function AccFarmModule({ subPage }) {
  if (subPage === "interact.engage") return <FarmEngage />;
  if (subPage === "interact.history") return <FarmHistory />;
  return <ComingSoon />;
}
