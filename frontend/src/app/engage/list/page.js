import PostEngagementModule from "@/modules/module_12_post_engagement";
import { pageMetadata } from "@/config/navigation";

export const metadata = pageMetadata("engage.list");

export default function Page() {
  return <PostEngagementModule subPage="engage.list" />;
}
