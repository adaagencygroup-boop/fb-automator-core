"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSyncAccounts } from "./service";
import { createAccountResource } from "./accountResource.mjs";

export default function useSyncAccounts() {
  const [resource] = useState(() => createAccountResource(getSyncAccounts));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    resource.activate();
    return resource.dispose;
  }, [resource]);
  return { ...snapshot, load: resource.load };
}
