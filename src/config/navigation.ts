import type { FeatureKey } from "@/config/features";

export type NavigationIcon =
  | "ArrowLeft"
  | "Bell"
  | "Building2"
  | "Columns3"
  | "ContactRound"
  | "CreditCard"
  | "FileType"
  | "FileText"
  | "FolderKanban"
  | "History"
  | "LayoutDashboard"
  | "ListFilter"
  | "Lock"
  | "Settings"
  | "ShieldCheck"
  | "Sparkles"
  | "Tags"
  | "Upload"
  | "User"
  | "Users";

export type NavigationLabelKey =
  | "nav.admin"
  | "nav.attributes"
  | "nav.auditLog"
  | "nav.backToDashboard"
  | "nav.billing"
  | "nav.correspondents"
  | "nav.customFields"
  | "nav.dashboard"
  | "nav.documents"
  | "nav.documentTypes"
  | "nav.entities"
  | "nav.imports"
  | "nav.login"
  | "nav.notifications"
  | "nav.organization"
  | "nav.organizations"
  | "nav.pricing"
  | "nav.profile"
  | "nav.rules"
  | "nav.security"
  | "nav.settings"
  | "nav.tags"
  | "nav.team"
  | "nav.users"
  | "nav.views";

export type NavigationPlacement = "main" | "bottom";

export type NavigationLinkItem = {
  kind?: "link";
  // Dotted key into the "common" message namespace's "nav" object (e.g. "nav.dashboard") —
  // this file is plain data, not a component, so it can't call useTranslations() itself; the
  // consuming sidebar/topbar components resolve this via t(item.labelKey).
  labelKey: NavigationLabelKey;
  href: string;
  feature?: FeatureKey;
  icon?: NavigationIcon;
  adminOnly?: boolean;
  placement?: NavigationPlacement;
};

export type NavigationGroupItem = {
  kind: "group";
  labelKey: NavigationLabelKey;
  icon?: NavigationIcon;
  feature?: FeatureKey;
  adminOnly?: boolean;
  placement?: NavigationPlacement;
  children: NavigationLinkItem[];
};

export type NavigationSeparatorItem = {
  kind: "separator";
  id: string;
  placement?: NavigationPlacement;
};

export type NavigationItem = NavigationLinkItem | NavigationGroupItem | NavigationSeparatorItem;

export const marketingNavigation: NavigationLinkItem[] = [
  { labelKey: "nav.pricing", href: "/pricing", feature: "billing" },
  { labelKey: "nav.login", href: "/login" }
];

export const dashboardNavigation: NavigationItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  {
    labelKey: "nav.documents",
    href: "/dashboard/documents",
    feature: "documents",
    icon: "FileText"
  },
  {
    labelKey: "nav.views",
    href: "/dashboard/views",
    feature: "entities",
    icon: "ListFilter"
  },
  { kind: "separator", id: "attributes" },
  {
    kind: "group",
    labelKey: "nav.attributes",
    icon: "Tags",
    children: [
      { labelKey: "nav.tags", href: "/dashboard/attributes/tags", feature: "documents", icon: "Tags" },
      {
        labelKey: "nav.correspondents",
        href: "/dashboard/attributes/correspondents",
        feature: "documents",
        icon: "ContactRound"
      },
      {
        labelKey: "nav.documentTypes",
        href: "/dashboard/attributes/document-types",
        feature: "documents",
        icon: "FileType"
      },
      {
        labelKey: "nav.customFields",
        href: "/dashboard/attributes/custom-fields",
        feature: "entities",
        icon: "Columns3"
      }
    ]
  },
  {
    labelKey: "nav.rules",
    href: "/dashboard/rules",
    feature: "rules",
    icon: "Sparkles"
  },
  {
    labelKey: "nav.entities",
    href: "/dashboard/entities",
    feature: "entities",
    icon: "FolderKanban"
  },
  {
    labelKey: "nav.imports",
    href: "/dashboard/imports",
    feature: "imports",
    icon: "Upload"
  },
  {
    labelKey: "nav.notifications",
    href: "/dashboard/notifications",
    feature: "notifications",
    icon: "Bell",
    placement: "bottom"
  },
  {
    kind: "group",
    labelKey: "nav.organization",
    feature: "organizations",
    icon: "Building2",
    placement: "bottom",
    children: [
      {
        labelKey: "nav.organizations",
        href: "/organizations",
        feature: "organizations",
        icon: "Building2"
      },
      { labelKey: "nav.team", href: "/organizations/team", feature: "organizations", icon: "Users" }
    ]
  },
  {
    kind: "group",
    labelKey: "nav.settings",
    icon: "Settings",
    placement: "bottom",
    children: [
      { labelKey: "nav.profile", href: "/settings/profile", icon: "User" },
      { labelKey: "nav.security", href: "/settings/security", icon: "Lock" },
      { labelKey: "nav.billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" }
    ]
  },
  {
    labelKey: "nav.admin",
    href: "/admin",
    feature: "admin",
    icon: "ShieldCheck",
    adminOnly: true,
    placement: "bottom"
  }
];

export const adminNavigation: NavigationLinkItem[] = [
  { labelKey: "nav.dashboard", href: "/admin", icon: "LayoutDashboard" },
  { labelKey: "nav.users", href: "/admin/users", icon: "Users" },
  { labelKey: "nav.organizations", href: "/admin/organizations", icon: "Building2" },
  { labelKey: "nav.auditLog", href: "/admin/audit-log", icon: "History" },
  { labelKey: "nav.backToDashboard", href: "/dashboard", icon: "ArrowLeft" }
];

export const settingsNavigation: NavigationLinkItem[] = [
  { labelKey: "nav.profile", href: "/settings/profile", icon: "User" },
  { labelKey: "nav.security", href: "/settings/security", icon: "Lock" },
  { labelKey: "nav.billing", href: "/settings/billing", feature: "billing", icon: "CreditCard" }
];
