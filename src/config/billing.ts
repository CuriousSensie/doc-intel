export type BillingOwner = "user" | "organization";

export type PlanKey = "free" | "pro" | "team";

export type PlanFeatureMap = {
  teamMembers: number;
  projects: number;
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

export const billingConfig = {
  defaultOwner: "user" satisfies BillingOwner,
  currency: "usd",
  creditPacks: [
    { key: "starter", name: "Starter credits", credits: 100, priceCents: 1000 },
    { key: "growth", name: "Growth credits", credits: 500, priceCents: 4000 },
    { key: "scale", name: "Scale credits", credits: 1000, priceCents: 7000 }
  ],
  plans: {
    free: {
      key: "free",
      name: "Free",
      description: "For trying the product with sensible limits.",
      priceMonthlyCents: 0,
      features: {
        teamMembers: 1,
        projects: 3,
        storageMb: 100,
        credits: 0
      }
    },
    pro: {
      key: "pro",
      name: "Pro",
      description: "For individual customers building real workflows.",
      priceMonthlyCents: 1900,
      stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      stripePriceIdYearly: process.env.STRIPE_PRICE_PRO_YEARLY,
      features: {
        teamMembers: 1,
        projects: 50,
        storageMb: 10_000,
        credits: 500
      }
    },
    team: {
      key: "team",
      name: "Team",
      description: "For small companies using organizations and shared billing.",
      priceMonthlyCents: 4900,
      stripePriceIdMonthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
      stripePriceIdYearly: process.env.STRIPE_PRICE_TEAM_YEARLY,
      features: {
        teamMembers: 10,
        projects: 250,
        storageMb: 50_000,
        credits: 2_000
      }
    }
  } satisfies Record<PlanKey, BillingPlan>
} as const;
