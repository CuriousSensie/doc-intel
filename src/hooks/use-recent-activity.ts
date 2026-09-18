"use client";

import { useSyncExternalStore } from "react";

import { getRecentDocuments, getRecentViews } from "@/lib/dashboard/recent-activity";

// Same "server has no localStorage" gating as theme-toggle.tsx's `mounted` — server snapshot
// false, client snapshot true, so the first client render matches SSR before flipping.
const emptySubscribe = () => () => {};

export function useRecentActivity() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  return {
    documents: mounted ? getRecentDocuments() : [],
    views: mounted ? getRecentViews() : [],
    isLoading: !mounted
  };
}
