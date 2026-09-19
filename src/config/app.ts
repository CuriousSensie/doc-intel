import { billingConfig } from "@/config/billing";
import { featureConfig } from "@/config/features";

export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "Documenti",
  description:
    "Documenti turns Paperless documents, entities, rules, imports, and team workflows into one connected document intelligence workspace.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "https://www.documenti.net",
  supportEmail: process.env.SUPPORT_EMAIL ?? "support@documenti.net",
  logo: {
    label: "Documenti"
  },
  social: {
    github: "https://github.com/documenti/documenti"
  },
  auth: {
    password: true,
    magicLink: true,
    google: true,
    github: true,
    mfa: featureConfig.mfa
  },
  features: featureConfig,
  billing: billingConfig
} as const;
