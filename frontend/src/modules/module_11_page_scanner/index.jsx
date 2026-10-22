"use client";

import PageScannerSearch from "./search";
import PageScannerHistory from "./history";
import ComingSoon from "@/components/ComingSoon";

export { PageScannerSearch, PageScannerHistory };

export default function PageScannerModule({ subPage = "scanner.search" }) {
  if (subPage === "scanner.history") {
    return <PageScannerHistory />;
  }
  if (subPage === "scanner.search") {
    return <PageScannerSearch />;
  }
  return <ComingSoon />;
}
