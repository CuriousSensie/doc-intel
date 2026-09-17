"use client";

import { useEffect } from "react";

import { useRouter } from "@/i18n/navigation";

export function DocumentProcessingRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return null;
}
