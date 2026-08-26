import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { adminNavigation } from "@/config/navigation";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-cookie";
import { requireFeature } from "@/modules/auth/authorization";
import { requireAdmin } from "@/modules/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  requireFeature("admin");
  const { profile, user } = await requireAdmin();
  const cookieStore = await cookies();
  const defaultCollapsed = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true";

  return (
    <DashboardShell
      defaultCollapsed={defaultCollapsed}
      navigation={adminNavigation}
      settingsHref="/settings/profile"
      title="Admin"
      user={{ name: profile?.name ?? user.email ?? "Admin", email: user.email ?? "" }}
    >
      {children}
    </DashboardShell>
  );
}
