import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { OrganizationBadge } from "@/components/layout/organization-badge";
import { isFeatureEnabled } from "@/config/features";
import { dashboardNavigation, type NavigationItem, type NavigationLinkItem } from "@/config/navigation";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-cookie";
import { requireUser } from "@/modules/auth/session";
import { listUserOrganizations } from "@/modules/organizations/organizations.service";
import { getUnreadCount } from "@/modules/notifications/notifications.service";

function isLinkItem(item: NavigationItem): item is NavigationLinkItem {
  return item.kind !== "separator" && item.kind !== "group";
}

function filterNavigation(items: NavigationItem[], isAdmin: boolean): NavigationItem[] {
  return items
    .map((item): NavigationItem | null => {
      if (item.kind === "separator") return item;
      if (item.adminOnly && !isAdmin) return null;
      if (item.feature && !isFeatureEnabled(item.feature)) return null;

      if (item.kind === "group") {
        const children = filterNavigation(item.children, isAdmin).filter(isLinkItem);
        return children.length > 0 ? { ...item, children } : null;
      }

      return item;
    })
    .filter((item): item is NavigationItem => item !== null)
    .filter((item, index, filtered) => {
      if (item.kind !== "separator") return true;
      const previous = filtered[index - 1];
      const next = filtered[index + 1];
      return Boolean(previous && next && previous.kind !== "separator" && next.kind !== "separator");
    });
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { profile, user } = await requireUser();
  const t = await getTranslations("dashboard");
  const isAdmin = isFeatureEnabled("admin") && Boolean(profile?.is_app_admin);

  const [cookieStore, unreadCount, memberships] = await Promise.all([
    cookies(),
    isFeatureEnabled("notifications") ? getUnreadCount(user.id) : Promise.resolve(0),
    isFeatureEnabled("organizations") ? listUserOrganizations(user.id) : Promise.resolve([])
  ]);

  const navigation = filterNavigation(dashboardNavigation, isAdmin);
  const defaultCollapsed = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true";

  return (
    <DashboardShell
      defaultCollapsed={defaultCollapsed}
      isAdmin={isAdmin}
      navigation={navigation}
      notificationsHref={isFeatureEnabled("notifications") ? "/dashboard/notifications" : undefined}
      organizationSwitcher={
        memberships[0] ? <OrganizationBadge name={memberships[0].organization.name} /> : undefined
      }
      settingsHref="/settings/profile"
      unreadCount={unreadCount}
      user={{ name: profile?.name ?? user.email ?? t("layout.accountFallback"), email: user.email ?? "" }}
    >
      {children}
    </DashboardShell>
  );
}
