"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AccFarmModule from "@/modules/module_03_acc_farm";
import { PostSessionDetailView } from "@/modules/module_03_acc_farm/components/PostSessionDetailView";

function PostPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id") || searchParams.get("session_id");

  if (sessionId) {
    return <PostSessionDetailView sessionId={sessionId} />;
  }

  return <AccFarmModule subPage="interact.post" />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Đang tải dữ liệu phiên đăng...</div>}>
      <PostPageContent />
    </Suspense>
  );
}
