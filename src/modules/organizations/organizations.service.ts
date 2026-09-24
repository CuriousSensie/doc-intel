import { createHash, randomBytes } from "crypto";
import { cache } from "react";

import { ConflictError } from "@/lib/errors";
import { enqueue, QUEUE_NAMES } from "@/lib/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { Database } from "@/types/database";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember = Database["public"]["Tables"]["organization_members"]["Row"];
export type OrganizationInvitation =
  Database["public"]["Tables"]["organization_invitations"]["Row"];
export type OrganizationRole = OrganizationMember["role"];
export type AssignableRole = Exclude<OrganizationRole, "owner">;
export type MemberWithProfile = OrganizationMember & {
  profile: { id: string; name: string | null; email: string; avatar_url: string | null } | null;
};

const INVITATION_TTL_DAYS = 7;

export async function listUserOrganizations(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organization:organizations(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    role: row.role,
    organization: row.organization as unknown as Organization
  }));
}

export async function getOrganization(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

// cache()'d for the same reason as getCurrentUser()/getCurrentProfile() (src/modules/auth/
// session.ts) — getActiveOrganizationId() already calls this once to validate the active-org
// cookie, and several write paths (updateDocument, deleteDocument, ...) call it again for the
// role check with the exact same (organizationId, userId) pair. Found measuring a document
// save: that redundant round trip was real, measurable latency stacked on top of the several
// other sequential Supabase calls a single server action already pays for.
export const getMembership = cache(async (organizationId: string, userId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
});

export async function createOrganization(name: string, requestedSlug?: string) {
  const supabase = await createClient();

  if (requestedSlug) {
    const { data, error } = await supabase.rpc("create_organization", {
      org_name: name,
      org_slug: requestedSlug
    });

    if (error) {
      throw error.code === "23505" ? new ConflictError("That URL slug is already taken") : error;
    }

    await enqueue(QUEUE_NAMES.provisionTenant, { orgId: data });
    return data;
  }

  const baseSlug = slugify(name) || "organization";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(3).toString("hex")}`;
    const { data, error } = await supabase.rpc("create_organization", {
      org_name: name,
      org_slug: slug
    });

    if (!error) {
      await enqueue(QUEUE_NAMES.provisionTenant, { orgId: data });
      return data;
    }

    if (error.code !== "23505") {
      throw error;
    }
  }

  throw new ConflictError("Could not generate a unique organization slug");
}

export async function updateOrganization(
  organizationId: string,
  values: Database["public"]["Tables"]["organizations"]["Update"]
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update(values)
    .eq("id", organizationId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteOrganization(organizationId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", organizationId);

  if (error) {
    throw error;
  }
}

export async function listMembers(organizationId: string): Promise<MemberWithProfile[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  if (members.length === 0) {
    return [];
  }

  // profiles' RLS ("own row or app admin") blocks a regular member from seeing teammates'
  // profiles — every member showed up as "Unknown <uuid>" in the team table before this. The
  // admin client is safe here: the ids being looked up were already confirmed to be members of
  // this same organization by the query above, so this reveals nothing beyond "this teammate's
  // name/email", not an open profile lookup.
  const admin = createAdminClient();
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, name, email, avatar_url")
    .in(
      "id",
      members.map((member) => member.user_id)
    );

  if (profilesError) {
    throw profilesError;
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return members.map((member) => ({
    ...member,
    profile: profileById.get(member.user_id) ?? null
  }));
}

// ADR-0008: role changes are a "permission change" mutation that needs its audit row written
// in the same transaction, not via a separate best-effort logEvent() call — update_member_role()
// does the role update, its own owner/admin authorization check, and the audit insert
// atomically.
export async function updateMemberRole(memberId: string, role: AssignableRole) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member_role", {
    p_member_id: memberId,
    p_role: role
  });

  if (error) {
    throw error;
  }
}

// Same ADR-0008 transactional-audit shape as updateMemberRole()/removeMember(). Blocking
// is org-scoped and reversible (unlike remove) — the member row and role are preserved,
// only blocked_at is set. is_organization_member()/has_organization_role() both exclude
// blocked rows, so this cuts the member's access everywhere those gates are used.
export async function blockMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_member", { p_member_id: memberId });

  if (error) {
    throw error;
  }
}

export async function unblockMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unblock_member", { p_member_id: memberId });

  if (error) {
    throw error;
  }
}

// ADR-0008: same reasoning as updateMemberRole() above.
export async function removeMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", { p_member_id: memberId });

  if (error) {
    throw error;
  }
}

// ADR-0008: same reasoning as updateMemberRole() above — voluntary self-removal is still a
// "permission change". The RPC scopes to auth.uid() itself, so this no longer needs a userId
// parameter the way the old plain-delete version did.
export async function leaveOrganization(organizationId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_organization", {
    p_organization_id: organizationId
  });

  if (error) {
    throw error;
  }
}

export async function listInvitations(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}

// The inviting admin can't see other users' profiles under normal RLS, and the one-org-
// per-account rule (organization_members_user_id_key) needs to be checked before an
// invitation is created, not just at accept time — otherwise the invite silently can never
// be accepted. Scoped to admin client because this is the one place we intentionally look
// up another user's account by email.
export async function emailAlreadyHasOrganization(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile) {
    return false;
  }

  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("id")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  return membership !== null;
}

export async function createInvitation(
  organizationId: string,
  invitedBy: string,
  email: string,
  role: AssignableRole,
  inviteeName: string
) {
  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("organization_invitations")
    .select("accepted_at")
    .eq("organization_id", organizationId)
    .eq("email", email)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.accepted_at) {
    throw new ConflictError("This person is already a member of this organization.");
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("organization_invitations")
    .upsert(
      {
        organization_id: organizationId,
        email,
        invitee_name: inviteeName,
        role,
        token_hash: tokenHash,
        invited_by: invitedBy,
        expires_at: expiresAt,
        accepted_at: null,
        accepted_by: null,
        revoked_at: null
      },
      { onConflict: "organization_id,email" }
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { invitation: data, token };
}

// Invited employees skip Supabase's email-verification step entirely — the invitation link
// already proved they control the inbox — so the account is created pre-confirmed via the
// admin API (auth.signUp() would otherwise always queue a confirmation email) and then
// signed in immediately with the same client so the SSR cookie session is actually set.
export async function createAccountForInvitation(input: {
  email: string;
  name: string;
  password: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name }
  });

  if (error) {
    throw error;
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password
  });

  if (signInError) {
    throw signInError;
  }

  return data.user;
}

export async function revokeInvitation(invitationId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId);

  if (error) {
    throw error;
  }
}

export async function getInvitationPreview(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_invitation", { p_token: token });

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}

export async function acceptInvitation(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_organization_invitation", { p_token: token });

  if (error) {
    throw error;
  }

  return data;
}

export async function transferOwnership(organizationId: string, newOwnerId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_organization_ownership", {
    p_org_id: organizationId,
    p_new_owner_id: newOwnerId
  });

  if (error) {
    throw error;
  }
}
