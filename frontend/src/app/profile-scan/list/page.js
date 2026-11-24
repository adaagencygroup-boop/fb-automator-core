import { ProfileList } from "@/modules/module_13_profile_scan";
import { pageMetadata } from "@/config/navigation";

// Trang: Danh sách profile (/profile-scan/list)
export const metadata = pageMetadata("profile_scan.list");

export default function Page() {
  return <ProfileList />;
}
