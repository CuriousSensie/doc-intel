import type { ReactNode } from "react";

import { AppSidebar, MobileSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { SidebarProvider } from "@/components/layout/sidebar-provider";
import type { NavigationItem } from "@/config/navigation";

export function DashboardShell({
  children,
  defaultCollapsed = false,
  isAdmin = false,
  navigation,
  notificationsHref,
  organizationSwitcher,
  settingsHref,
  title,
  unreadCount,
  user
}: {
  children: ReactNode;
  defaultCollapsed?: boolean;
  isAdmin?: boolean;
  navigation: NavigationItem[];
  notificationsHref?: string;
  organizationSwitcher?: ReactNode;
  settingsHref?: string;
  title?: ReactNode;
  unreadCount?: number;
  user: { name: string; email: string; avatarUrl?: string | null };
}) {
  return (
    <SidebarProvider defaultCollapsed={defaultCollapsed}>
      <div className="flex min-h-screen">
        <AppSidebar items={navigation} />
        <MobileSidebar items={navigation} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar
            isAdmin={isAdmin}
            notificationsHref={notificationsHref}
            organizationSwitcher={organizationSwitcher}
            settingsHref={settingsHref}
            title={title}
            unreadCount={unreadCount}
            user={user}
          />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8" id="main">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
