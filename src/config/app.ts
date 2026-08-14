import { billingConfig } from "@/config/billing";
import { featureConfig } from "@/config/features";

export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "MVP Boilerplate",
  description:
    "A production-ready full-stack SaaS boilerplate for reusable authentication, billing, organizations, emails, files, admin tooling, and security.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportEmail: process.env.SUPPORT_EMAIL ?? "support@example.com",
  logo: {
    label: "MVP"
  },
  social: {
    github: "https://github.com/CuriousSensie/mvp-boilerplate"
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
