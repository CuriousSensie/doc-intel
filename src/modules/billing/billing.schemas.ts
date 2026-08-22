import { z } from "zod";

import { billingConfig, type PlanKey } from "@/config/billing";

export const checkoutSchema = z.object({
  planKey: z.string().refine((key): key is PlanKey => key in billingConfig.plans, "Unknown plan"),
  interval: z.enum(["monthly", "yearly"])
});

export const creditPurchaseSchema = z.object({
  packKey: z.string().refine(
    (key) => billingConfig.creditPacks.some((pack) => pack.key === key),
    "Unknown credit pack"
  )
});
