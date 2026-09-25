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
import type savedViews from "@/../messages/en/savedViews.json";
import type rules from "@/../messages/en/rules.json";
import type folders from "@/../messages/en/folders.json";

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
      savedViews: typeof savedViews;
      rules: typeof rules;
      folders: typeof folders;
    };
    Locale: "en" | "sl";
  }
}
