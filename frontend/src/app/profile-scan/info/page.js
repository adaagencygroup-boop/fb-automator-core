import { ProfileScanInfo } from "@/modules/module_13_profile_scan";
import { pageMetadata } from "@/config/navigation";

// Trang: Quét thông tin profile (/profile-scan/info)
export const metadata = pageMetadata("profile_scan.info");

export default function Page() {
  return <ProfileScanInfo />;
}
