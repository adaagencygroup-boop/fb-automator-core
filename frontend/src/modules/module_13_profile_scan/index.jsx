"use client";

import ProfileList from "./profile-list";
import ProfileScanInfo from "./scan-info";

export { ProfileList, ProfileScanInfo };

export default function ProfileScanModule({ subPage = "profile_scan.info" }) {
  if (subPage === "profile_scan.info") return <ProfileScanInfo />;
  return <ProfileList />;
}
