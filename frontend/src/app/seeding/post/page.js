import InteractionSeedingModule from "@/modules/module_08_interaction_seeding";
import { pageMetadata } from "@/config/navigation";

// Trang: Seeding Bài viết (/seeding/post)
export const metadata = pageMetadata("seeding.post");

export default function Page() {
  return <InteractionSeedingModule subPage="seeding.post" />;
}
