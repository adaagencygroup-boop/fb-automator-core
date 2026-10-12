import GroupPostModule from "@/modules/module_07_group_spam/post";
import { pageMetadata } from "@/config/navigation";

// Trang: Đăng bài vào Group (/groups/post)
export const metadata = pageMetadata("groups.post");

export default function Page() {
  return <GroupPostModule />;
}
