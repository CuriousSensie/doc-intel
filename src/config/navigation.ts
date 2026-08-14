import type { FeatureKey } from "@/config/features";

export type NavigationItem = {
  label: string;
  href: string;
  feature?: FeatureKey;
};

export const marketingNavigation: NavigationItem[] = [
  { label: "Pricing", href: "/pricing", feature: "billing" },
  { label: "Login", href: "/login" }
];

export const dashboardNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Projects", href: "/dashboard/projects" },
  { label: "Notifications", href: "/dashboard/notifications", feature: "notifications" },
  { label: "Files", href: "/dashboard/files", feature: "files" },
  { label: "Billing", href: "/settings/billing", feature: "billing" },
  { label: "Team", href: "/settings/team", feature: "organizations" },
  { label: "Admin", href: "/admin", feature: "admin" }
];

export const settingsNavigation: NavigationItem[] = [
  { label: "Profile", href: "/settings/profile" },
  { label: "Security", href: "/settings/security" },
  { label: "Billing", href: "/settings/billing", feature: "billing" },
  { label: "Notifications", href: "/settings/notifications", feature: "notifications" },
  { label: "Team", href: "/settings/team", feature: "organizations" }
];
