"use client";

import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { recordViewOpen } from "@/lib/dashboard/recent-activity";

// Views list is a server component (dashboard/views/page.tsx) — Easy Access's "most-used views"
// tracking (localStorage only, see recent-activity.ts) has to hook onto the click itself.
export function TrackedViewLink({
  id,
  name,
  href,
  className,
  children
}: {
  id: string;
  name: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link className={className} href={href} onClick={() => recordViewOpen({ id, name, href })}>
      {children}
    </Link>
  );
}
