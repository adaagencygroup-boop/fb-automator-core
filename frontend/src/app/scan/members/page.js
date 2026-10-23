import GroupScanModule from "@/modules/module_10_group_scan";
import { pageMetadata } from "@/config/navigation";

export const metadata = pageMetadata("scan.members");

export default function Page() {
  return <GroupScanModule subPage="scan.members" />;
}
