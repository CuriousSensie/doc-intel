import type { FeatureKey } from "@/config/features";

export type NavigationIcon =
  | "Bell"
  | "Building2"
  | "CreditCard"
  | "FolderKanban"
  | "LayoutDashboard"
  | "Lock"
  | "Paperclip"
  | "ShieldCheck"
  | "User"
  | "Users";

export type NavigationItem = {
  label: string;
  href: string;
  feature?: FeatureKey;
  icon?: NavigationIcon;
};

export const marketingNavigation: NavigationItem[] = [
  { label: "Pricing", href: "/pricing", feature: "billing" },
  { label: "Login", href: "/login" }
];

export const dashboardNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "Projects", href: "/dashboard/projects", icon: "FolderKanban" },
  { label: "Notifications", href: "/dashboard/notifications", feature: "notifications", icon: "Bell" },
  { label: "Files", href: "/dashboard/files", feature: "files", icon: "Paperclip" },
  { label: "Billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  { label: "Organizations", href: "/organizations", feature: "organizations", icon: "Building2" },
  { label: "Team", href: "/settings/team", feature: "organizations", icon: "Users" },
  { label: "Admin", href: "/admin", feature: "admin", icon: "ShieldCheck" }
];

export const settingsNavigation: NavigationItem[] = [
  { label: "Profile", href: "/settings/profile", icon: "User" },
  { label: "Security", href: "/settings/security", icon: "Lock" },
  { label: "Billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  { label: "Notifications", href: "/settings/notifications", feature: "notifications", icon: "Bell" },
  { label: "Team", href: "/settings/team", feature: "organizations", icon: "Users" }
];
