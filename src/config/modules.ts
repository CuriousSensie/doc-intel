import type { FeatureKey } from "@/config/features";

export type ModuleStatus = "required" | "optional" | "recommended";

export type ModuleDefinition = {
  key: string;
  name: string;
  status: ModuleStatus;
  dependency: string;
  feature?: FeatureKey;
};

export const moduleMatrix: ModuleDefinition[] = [
  { key: "auth", name: "Authentication", status: "required", dependency: "Supabase" },
  { key: "profiles", name: "Profiles", status: "required", dependency: "Auth" },
  { key: "email", name: "Email", status: "required", dependency: "SMTP" },
  {
    key: "organizations",
    name: "Organizations",
    status: "optional",
    dependency: "Auth",
    feature: "organizations"
  },
  {
    key: "rbac",
    name: "RBAC",
    status: "optional",
    dependency: "Organizations",
    feature: "organizations"
  },
  { key: "billing", name: "Billing", status: "optional", dependency: "Stripe", feature: "billing" },
  { key: "credits", name: "Credits", status: "optional", dependency: "Billing", feature: "credits" },
  {
    key: "notifications",
    name: "Notifications",
    status: "optional",
    dependency: "Auth",
    feature: "notifications"
  },
  { key: "admin", name: "Admin", status: "optional", dependency: "Auth", feature: "admin" },
  { key: "audit", name: "Audit Logs", status: "recommended", dependency: "Admin", feature: "admin" },
  {
    key: "outgoing-webhooks",
    name: "Outgoing Webhooks",
    status: "optional",
    dependency: "Organizations",
    feature: "outgoingWebhooks"
  }
];
