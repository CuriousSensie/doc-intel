import Stripe from "stripe";

import { requireEnv } from "@/lib/env";

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!cachedClient) {
    cachedClient = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-08-27.basil"
    });
  }

  return cachedClient;
}
