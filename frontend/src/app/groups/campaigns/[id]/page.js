import CampaignDetailModule from "@/modules/module_07_group_spam/campaigns/detail";
import { pageMetadata } from "@/config/navigation";

export const metadata = pageMetadata("groups.campaigns");

export default async function Page({ params }) {
  const resolvedParams = params && typeof params.then === "function" ? await params : params;
  return <CampaignDetailModule campaignId={resolvedParams?.id} />;
}
