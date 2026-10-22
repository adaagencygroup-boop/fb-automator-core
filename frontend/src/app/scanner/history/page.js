import { PageScannerHistory } from "@/modules/module_11_page_scanner";
import { pageMetadata } from "@/config/navigation";

// Trang: Lịch sử quét page (/scanner/history)
export const metadata = pageMetadata("scanner.history");

export default function Page() {
  return <PageScannerHistory />;
}
