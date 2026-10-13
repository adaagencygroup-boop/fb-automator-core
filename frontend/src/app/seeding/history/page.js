import InteractionSeedingModule from "@/modules/module_08_interaction_seeding";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử Seeding (/seeding/history)
export const metadata = pageMetadata("seeding.history");

export default function Page() {
  return <InteractionSeedingModule subPage="seeding.history" />;
}
