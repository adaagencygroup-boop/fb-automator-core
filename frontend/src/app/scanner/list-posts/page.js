import PageScannerModule from "@/modules/module_11_page_scanner";
import { pageMetadata } from "@/config/navigation";

export const metadata = pageMetadata("scanner.list-posts");

export default function Page() {
  return <PageScannerModule subPage="scanner.list-posts" />;
}
