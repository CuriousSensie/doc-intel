import { env } from "@/lib/env";
import { featureConfig } from "@/config/features";

export type BillingOwnerType = "user" | "organization";

export type PlanKey = "free" | "pro" | "team";

export type PlanFeatureMap = {
  teamMembers: number;
  storageMb: number;
  credits: number;
};

export type BillingPlan = {
  key: PlanKey;
  name: string;
  description: string;
  priceMonthlyCents: number;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  features: PlanFeatureMap;
};

export type CreditPack = {
  key: string;
  name: string;
  credits: number;
  priceCents: number;
  stripePriceId?: string;
};

/**
 * Which entity billing belongs to is derived from whether organizations are enabled, not an
 * independent setting — a product either bills individual users (no organizations) or bills the
 * organization on behalf of all its members (organizations enabled). Mixing the two is not a
 * supported configuration.
 */
export const billingOwnerType: BillingOwnerType = featureConfig.organizations ? "organization" : "user";

export const billingConfig = {
  currency: "usd",
  creditPacks: [
    { key: "starter", name: "Starter credits", credits: 100, priceCents: 1000, stripePriceId: env.STRIPE_PRICE_CREDITS_STARTER },
    { key: "growth", name: "Growth credits", credits: 500, priceCents: 4000, stripePriceId: env.STRIPE_PRICE_CREDITS_GROWTH },
    { key: "scale", name: "Scale credits", credits: 1000, priceCents: 7000, stripePriceId: env.STRIPE_PRICE_CREDITS_SCALE }
  ] satisfies CreditPack[],
  plans: {
    free: {
      key: "free",
      name: "Free",
      description: "For trying the product with sensible limits.",
      priceMonthlyCents: 0,
      features: {
        teamMembers: 1,
        storageMb: 100,
        credits: 0
      }
    },
    pro: {
      key: "pro",
      name: "Pro",
      description: "For individual customers building real workflows.",
      priceMonthlyCents: 1900,
      stripePriceIdMonthly: env.STRIPE_PRICE_PRO_MONTHLY,
      stripePriceIdYearly: env.STRIPE_PRICE_PRO_YEARLY,
      features: {
        teamMembers: 1,
        storageMb: 10_000,
        credits: 500
      }
    },
    team: {
      key: "team",
      name: "Team",
      description: "For small companies using organizations and shared billing.",
      priceMonthlyCents: 4900,
      stripePriceIdMonthly: env.STRIPE_PRICE_TEAM_MONTHLY,
      stripePriceIdYearly: env.STRIPE_PRICE_TEAM_YEARLY,
      features: {
        teamMembers: 10,
        storageMb: 50_000,
        credits: 2_000
      }
    }
  } satisfies Record<PlanKey, BillingPlan>
} as const;
