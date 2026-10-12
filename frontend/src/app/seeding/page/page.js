import InteractionSeedingModule from "@/modules/module_08_interaction_seeding";
import { pageMetadata } from "@/config/navigation";

// Trang: Seeding Page (/seeding/page)
export const metadata = pageMetadata("seeding.page");

export default function Page() {
  return <InteractionSeedingModule subPage="seeding.page" />;
}
