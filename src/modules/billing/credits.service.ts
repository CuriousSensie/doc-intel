import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingOwner } from "@/modules/billing/owner";
import type { Database, Json } from "@/types/database";

type CreditTransactionType = Database["public"]["Tables"]["credit_transactions"]["Row"]["type"];

function ownerColumns(owner: BillingOwner) {
  return owner.type === "user"
    ? { owner_type: "user" as const, user_id: owner.id, organization_id: null }
    : { owner_type: "organization" as const, user_id: null, organization_id: owner.id };
}

function ownerIdColumn(owner: BillingOwner) {
  return owner.type === "user" ? ("user_id" as const) : ("organization_id" as const);
}

export async function getCreditBalance(owner: BillingOwner): Promise<number> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("credit_transactions")
    .select("amount")
    .eq("owner_type", owner.type)
    .eq(ownerIdColumn(owner), owner.id);

  if (error) {
    throw error;
  }

  return (data ?? []).reduce((sum, row) => sum + row.amount, 0);
}

export async function grantCredits(
  owner: BillingOwner,
  amount: number,
  type: Exclude<CreditTransactionType, "usage">,
  options: { reference?: string; metadata?: Json; createdBy?: string } = {}
): Promise<void> {
  if (amount <= 0) {
    throw new Error("Amount to grant must be positive");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("credit_transactions").insert({
    ...ownerColumns(owner),
    amount,
    type,
    reference: options.reference ?? null,
    metadata: options.metadata ?? {},
    created_by: options.createdBy ?? null
  });

  if (error) {
    throw error;
  }
}

export async function consumeCredits(
  owner: BillingOwner,
  amount: number,
  reference: string,
  metadata: Json = {}
): Promise<number> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("consume_credits", {
    p_owner_type: owner.type,
    p_user_id: owner.type === "user" ? owner.id : null,
    p_organization_id: owner.type === "organization" ? owner.id : null,
    p_amount: amount,
    p_reference: reference,
    p_metadata: metadata
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function refundCredits(
  owner: BillingOwner,
  amount: number,
  reference: string,
  metadata: Json = {}
): Promise<void> {
  await grantCredits(owner, amount, "refund", { reference, metadata });
}

export async function adminAdjustCredits(
  owner: BillingOwner,
  amount: number,
  adminUserId: string,
  reference?: string,
  metadata: Json = {}
): Promise<void> {
  if (amount === 0) {
    throw new Error("Adjustment amount must not be zero");
  }

  if (amount > 0) {
    await grantCredits(owner, amount, "admin_adjustment", { reference, metadata, createdBy: adminUserId });
    return;
  }

  await consumeCredits(owner, -amount, reference ?? "admin_adjustment", metadata);
}
