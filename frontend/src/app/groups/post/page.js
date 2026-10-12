import GroupSpamModule from "@/modules/module_07_group_spam";
import { pageMetadata } from "@/config/navigation";

// Trang: Đăng bài vào Group (/groups/post)
export const metadata = pageMetadata("groups.post");

export default function Page() {
  return <GroupSpamModule subPage="groups.post" />;
}
