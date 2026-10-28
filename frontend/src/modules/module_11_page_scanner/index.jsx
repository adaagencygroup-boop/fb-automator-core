"use client";

import PageScannerSearch from "./search";
import PageScannerHistory from "./history";
import PageScannerFollowers from "./followers";
import PageScannerListFollowers from "./list-followers";
import PageScannerPosts from "./posts";
import PageScannerListPosts from "./list-posts";
import PageScannerListPages from "./list-pages";
import ComingSoon from "@/components/ComingSoon";

export {
  PageScannerSearch,
  PageScannerHistory,
  PageScannerFollowers,
  PageScannerListFollowers,
  PageScannerPosts,
  PageScannerListPosts,
  PageScannerListPages,
};

export default function PageScannerModule({ subPage = "scanner.search" }) {
  if (subPage === "scanner.history") {
    return <PageScannerHistory />;
  }
  if (subPage === "scanner.search") {
    return <PageScannerSearch />;
  }
  if (subPage === "scanner.followers") {
    return <PageScannerFollowers />;
  }
  if (subPage === "scanner.list-followers") {
    return <PageScannerListFollowers />;
  }
  if (subPage === "scanner.posts") {
    return <PageScannerPosts />;
  }
  if (subPage === "scanner.list-posts") {
    return <PageScannerListPosts />;
  }
  if (subPage === "scanner.list" || subPage === "scanner.groups") {
    return <PageScannerListPages />;
  }
  return <ComingSoon />;
}
