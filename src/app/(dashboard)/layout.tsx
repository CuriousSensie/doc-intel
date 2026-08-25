import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { isFeatureEnabled } from "@/config/features";
import { dashboardNavigation } from "@/config/navigation";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-cookie";
import { requireUser } from "@/modules/auth/session";
import { getActiveOrganizationId } from "@/modules/organizations/active-organization";
import { listUserOrganizations } from "@/modules/organizations/organizations.service";
import { getUnreadCount } from "@/modules/notifications/notifications.service";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { profile, user } = await requireUser();

  const [cookieStore, unreadCount, memberships, activeOrganizationId] = await Promise.all([
    cookies(),
    isFeatureEnabled("notifications") ? getUnreadCount(user.id) : Promise.resolve(0),
    isFeatureEnabled("organizations") ? listUserOrganizations(user.id) : Promise.resolve([]),
    isFeatureEnabled("organizations") ? getActiveOrganizationId(user.id) : Promise.resolve(null)
  ]);

  const navigation = dashboardNavigation.filter(
    (item) => !item.feature || isFeatureEnabled(item.feature)
  );
  const defaultCollapsed = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true";

  return (
    <DashboardShell
      defaultCollapsed={defaultCollapsed}
      isAdmin={isFeatureEnabled("admin") && Boolean(profile?.is_app_admin)}
      navigation={navigation}
      notificationsHref={isFeatureEnabled("notifications") ? "/dashboard/notifications" : undefined}
      organizationSwitcher={
        memberships.length > 0 ? (
          <OrganizationSwitcher
            activeOrganizationId={activeOrganizationId}
            organizations={memberships.map((membership) => membership.organization)}
          />
        ) : undefined
      }
      settingsHref="/settings/profile"
      unreadCount={unreadCount}
      user={{ name: profile?.name ?? user.email ?? "Account", email: user.email ?? "" }}
    >
      {children}
    </DashboardShell>
  );
}
