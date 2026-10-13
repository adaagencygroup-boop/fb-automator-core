import GroupCommentModule from "@/modules/module_07_group_spam/comment";
import { pageMetadata } from "@/config/navigation";

// Trang: Bình luận trong Group (/groups/comment)
export const metadata = pageMetadata("groups.comment");

export default function Page() {
  return <GroupCommentModule />;
}
