"use client";

import ProfileScanHistory from "./history";
import ProfileList from "./profile-list";
import ProfileScanInfo from "./scan-info";

export { ProfileList, ProfileScanHistory, ProfileScanInfo };

export default function ProfileScanModule({ subPage = "profile_scan.info" }) {
  if (subPage === "profile_scan.info") return <ProfileScanInfo />;
  if (subPage === "profile_scan.history") return <ProfileScanHistory />;
  return <ProfileList />;
}
