import type { FeatureKey } from "@/config/features";

export type NavigationIcon =
  | "ArrowLeft"
  | "Bell"
  | "Building2"
  | "CreditCard"
  | "FileText"
  | "History"
  | "LayoutDashboard"
  | "Lock"
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
  {
    label: "Notifications",
    href: "/dashboard/notifications",
    feature: "notifications",
    icon: "Bell"
  },
  {
    label: "Documents",
    href: "/dashboard/documents",
    feature: "documents",
    icon: "FileText"
  },
  { label: "Billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  { label: "Organizations", href: "/organizations", feature: "organizations", icon: "Building2" },
  { label: "Team", href: "/settings/team", feature: "organizations", icon: "Users" },
  { label: "Admin", href: "/admin", feature: "admin", icon: "ShieldCheck" }
];

export const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/admin", icon: "LayoutDashboard" },
  { label: "Users", href: "/admin/users", icon: "Users" },
  { label: "Organizations", href: "/admin/organizations", icon: "Building2" },
  { label: "Audit Log", href: "/admin/audit-log", icon: "History" },
  { label: "Back to dashboard", href: "/dashboard", icon: "ArrowLeft" }
];

export const settingsNavigation: NavigationItem[] = [
  { label: "Profile", href: "/settings/profile", icon: "User" },
  { label: "Security", href: "/settings/security", icon: "Lock" },
  { label: "Billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  {
    label: "Notifications",
    href: "/settings/notifications",
    feature: "notifications",
    icon: "Bell"
  },
  { label: "Team", href: "/settings/team", feature: "organizations", icon: "Users" }
];
