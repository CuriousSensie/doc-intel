import { createHash, randomBytes } from "crypto";

import { ConflictError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { Database } from "@/types/database";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember = Database["public"]["Tables"]["organization_members"]["Row"];
export type OrganizationInvitation = Database["public"]["Tables"]["organization_invitations"]["Row"];
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

export async function getMembership(organizationId: string, userId: string) {
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
}

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

  const { data: profiles, error: profilesError } = await supabase
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

export async function updateMemberRole(memberId: string, role: AssignableRole) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function removeMember(memberId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("organization_members").delete().eq("id", memberId);

  if (error) {
    throw error;
  }
}

export async function leaveOrganization(organizationId: string, userId: string) {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("organization_members")
    .delete({ count: "exact" })
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  if (!count) {
    throw new ConflictError("You can't leave as the only owner. Transfer ownership first.");
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

export async function createInvitation(
  organizationId: string,
  invitedBy: string,
  email: string,
  role: AssignableRole
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
