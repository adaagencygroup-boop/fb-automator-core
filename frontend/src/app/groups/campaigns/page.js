import GroupCampaignsModule from "@/modules/module_07_group_spam/campaigns";
import { pageMetadata } from "@/config/navigation";

// Trang: Quản lý chiến dịch Group (/groups/campaigns)
export const metadata = pageMetadata("groups.campaigns");

export default function Page() {
  return <GroupCampaignsModule />;
}

