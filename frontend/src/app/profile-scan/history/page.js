import { ProfileScanHistory } from "@/modules/module_13_profile_scan";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử quét profile (/profile-scan/history)
export const metadata = pageMetadata("profile_scan.history");

export default function Page() {
  return <ProfileScanHistory />;
}
