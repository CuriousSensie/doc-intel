import type common from "@/../messages/en/common.json";
import type marketing from "@/../messages/en/marketing.json";
import type auth from "@/../messages/en/auth.json";
import type onboarding from "@/../messages/en/onboarding.json";
import type dashboard from "@/../messages/en/dashboard.json";
import type organizations from "@/../messages/en/organizations.json";
import type settings from "@/../messages/en/settings.json";
import type admin from "@/../messages/en/admin.json";
import type billing from "@/../messages/en/billing.json";
import type emails from "@/../messages/en/emails.json";
import type documents from "@/../messages/en/documents.json";
import type entities from "@/../messages/en/entities.json";
import type entityTypes from "@/../messages/en/entityTypes.json";
import type connections from "@/../messages/en/connections.json";
import type imports from "@/../messages/en/imports.json";
import type savedViews from "@/../messages/en/savedViews.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: {
      common: typeof common;
      marketing: typeof marketing;
      auth: typeof auth;
      onboarding: typeof onboarding;
      dashboard: typeof dashboard;
      organizations: typeof organizations;
      settings: typeof settings;
      admin: typeof admin;
      billing: typeof billing;
      emails: typeof emails;
      documents: typeof documents;
      entities: typeof entities;
      entityTypes: typeof entityTypes;
      connections: typeof connections;
      savedViews: typeof savedViews;
      imports: typeof imports;
    };
    Locale: "en" | "sl";
  }
}
