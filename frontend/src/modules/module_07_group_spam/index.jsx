"use client";

import GroupPostModule from "./post";
import GroupCommentModule from "./comment";

export { GroupPostModule, GroupCommentModule };

export default function GroupSpamModule({ subPage = "groups.post" }) {
  if (subPage === "groups.comment") {
    return <GroupCommentModule />;
  }
  return <GroupPostModule />;
}
