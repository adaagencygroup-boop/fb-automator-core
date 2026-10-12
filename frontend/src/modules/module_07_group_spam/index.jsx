"use client";

import GroupPostModule from "./post";
import GroupCommentModule from "./comment";
import GroupHistoryModule from "./history";

export { GroupPostModule, GroupCommentModule, GroupHistoryModule };

export default function GroupSpamModule({ subPage = "groups.post" }) {
  if (subPage === "groups.comment") {
    return <GroupCommentModule />;
  }
  if (subPage === "groups.history") {
    return <GroupHistoryModule />;
  }
  return <GroupPostModule />;
}
