"use client";

import GroupPostModule from "./post";
import GroupCommentModule from "./comment";
import GroupHistoryModule from "./history";
import GroupCampaignsModule from "./campaigns";

export { GroupPostModule, GroupCommentModule, GroupHistoryModule, GroupCampaignsModule };

export default function GroupSpamModule({ subPage = "groups.post" }) {
  if (subPage === "groups.comment") {
    return <GroupCommentModule />;
  }
  if (subPage === "groups.history") {
    return <GroupHistoryModule />;
  }
  if (subPage === "groups.campaigns") {
    return <GroupCampaignsModule />;
  }
  return <GroupPostModule />;
}
