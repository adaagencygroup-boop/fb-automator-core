import GroupHistoryModule from "@/modules/module_07_group_spam/history";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử Spam Group (/groups/history)
export const metadata = pageMetadata("groups.history");

export default function Page() {
  return <GroupHistoryModule />;
}

