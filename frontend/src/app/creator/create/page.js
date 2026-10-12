import PageCreatorModule from "@/modules/module_04_page_creator";
import { pageMetadata } from "@/config/navigation";

// Trang: Tạo Fanpage (/creator/create)
export const metadata = pageMetadata("creator.create");

export default function Page() {
  return <PageCreatorModule subPage="creator.create" />;
}
