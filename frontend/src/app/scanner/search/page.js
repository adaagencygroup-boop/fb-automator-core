import { PageScannerSearch } from "@/modules/module_11_page_scanner";
import { pageMetadata } from "@/config/navigation";

// Trang: Quét thông tin page (/scanner/search)
export const metadata = pageMetadata("scanner.search");

export default function Page() {
  return <PageScannerSearch />;
}
