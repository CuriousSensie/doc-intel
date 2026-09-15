import type { FeatureKey } from "@/config/features";

export type NavigationIcon =
  | "ArrowLeft"
  | "Bell"
  | "Building2"
  | "CreditCard"
  | "FileText"
  | "FolderKanban"
  | "History"
  | "LayoutDashboard"
  | "ListFilter"
  | "Lock"
  | "ShieldCheck"
  | "Sparkles"
  | "Upload"
  | "User"
  | "Users";

export type NavigationLabelKey =
  | "nav.admin"
  | "nav.auditLog"
  | "nav.backToDashboard"
  | "nav.billing"
  | "nav.dashboard"
  | "nav.documents"
  | "nav.entities"
  | "nav.imports"
  | "nav.login"
  | "nav.notifications"
  | "nav.organizations"
  | "nav.pricing"
  | "nav.profile"
  | "nav.rules"
  | "nav.security"
  | "nav.team"
  | "nav.users"
  | "nav.views";

export type NavigationItem = {
  // Dotted key into the "common" message namespace's "nav" object (e.g. "nav.dashboard") —
  // this file is plain data, not a component, so it can't call useTranslations() itself; the
  // consuming sidebar/topbar components resolve this via t(item.labelKey).
  labelKey: NavigationLabelKey;
  href: string;
  feature?: FeatureKey;
  icon?: NavigationIcon;
};

export const marketingNavigation: NavigationItem[] = [
  { labelKey: "nav.pricing", href: "/pricing", feature: "billing" },
  { labelKey: "nav.login", href: "/login" }
];

export const dashboardNavigation: NavigationItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  {
    labelKey: "nav.notifications",
    href: "/dashboard/notifications",
    feature: "notifications",
    icon: "Bell"
  },
  {
    labelKey: "nav.documents",
    href: "/dashboard/documents",
    feature: "documents",
    icon: "FileText"
  },
  {
    labelKey: "nav.entities",
    href: "/dashboard/entities",
    feature: "entities",
    icon: "FolderKanban"
  },
  {
    labelKey: "nav.views",
    href: "/dashboard/views",
    feature: "entities",
    icon: "ListFilter"
  },
  {
    labelKey: "nav.imports",
    href: "/dashboard/imports",
    feature: "imports",
    icon: "Upload"
  },
  {
    labelKey: "nav.rules",
    href: "/dashboard/rules",
    feature: "rules",
    icon: "Sparkles"
  },
  { labelKey: "nav.billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  {
    labelKey: "nav.organizations",
    href: "/organizations",
    feature: "organizations",
    icon: "Building2"
  },
  { labelKey: "nav.team", href: "/settings/team", feature: "organizations", icon: "Users" },
  { labelKey: "nav.admin", href: "/admin", feature: "admin", icon: "ShieldCheck" }
];

export const adminNavigation: NavigationItem[] = [
  { labelKey: "nav.dashboard", href: "/admin", icon: "LayoutDashboard" },
  { labelKey: "nav.users", href: "/admin/users", icon: "Users" },
  { labelKey: "nav.organizations", href: "/admin/organizations", icon: "Building2" },
  { labelKey: "nav.auditLog", href: "/admin/audit-log", icon: "History" },
  { labelKey: "nav.backToDashboard", href: "/dashboard", icon: "ArrowLeft" }
];

export const settingsNavigation: NavigationItem[] = [
  { labelKey: "nav.profile", href: "/settings/profile", icon: "User" },
  { labelKey: "nav.security", href: "/settings/security", icon: "Lock" },
  { labelKey: "nav.billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" },
  {
    labelKey: "nav.notifications",
    href: "/settings/notifications",
    feature: "notifications",
    icon: "Bell"
  },
  { labelKey: "nav.team", href: "/settings/team", feature: "organizations", icon: "Users" }
];
