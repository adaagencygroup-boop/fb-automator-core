import InteractionSeedingModule from "@/modules/module_08_interaction_seeding";
import { pageMetadata } from "@/config/navigation";

// Trang: Seeding Trang cá nhân (/seeding/profile)
export const metadata = pageMetadata("seeding.profile");

export default function Page() {
  return <InteractionSeedingModule subPage="seeding.profile" />;
}
