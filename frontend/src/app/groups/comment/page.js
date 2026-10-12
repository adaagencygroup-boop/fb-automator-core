import GroupSpamModule from "@/modules/module_07_group_spam";
import { pageMetadata } from "@/config/navigation";

// Trang: Bình luận trong Group (/groups/comment)
export const metadata = pageMetadata("groups.comment");

export default function Page() {
  return <GroupSpamModule subPage="groups.comment" />;
}
