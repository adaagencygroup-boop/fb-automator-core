"use client";

import PageScannerSearch from "./search";
import PageScannerFollowers from "./followers";
import PageScannerPosts from "./posts";
import PageScannerGroupsList from "./groups";
import PageScannerListPosts from "./list_posts";
import PageScannerListFollowers from "./list_followers";
import PageScannerHistory from "./history";
import ComingSoon from "@/components/ComingSoon";

export {
  PageScannerSearch,
  PageScannerFollowers,
  PageScannerPosts,
  PageScannerGroupsList,
  PageScannerListPosts,
  PageScannerListFollowers,
  PageScannerHistory,
};

export default function PageScannerModule({ subPage = "scanner.search" }) {
  if (subPage === "scanner.search") {
    return <PageScannerSearch />;
  }
  if (subPage === "scanner.followers") {
    return <PageScannerFollowers />;
  }
  if (subPage === "scanner.posts") {
    return <PageScannerPosts />;
  }
  if (subPage === "scanner.groups") {
    return <PageScannerGroupsList />;
  }
  if (subPage === "scanner.list-posts") {
    return <PageScannerListPosts />;
  }
  if (subPage === "scanner.list-followers") {
    return <PageScannerListFollowers />;
  }
  if (subPage === "scanner.history") {
    return <PageScannerHistory />;
  }
  return <ComingSoon />;
}
