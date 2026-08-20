export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          timezone: string | null;
          locale: string | null;
          onboarding_completed: boolean;
          is_app_admin: boolean;
          suspended_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          locale?: string | null;
          onboarding_completed?: boolean;
          is_app_admin?: boolean;
          suspended_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          locale?: string | null;
          onboarding_completed?: boolean;
          is_app_admin?: boolean;
          suspended_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          logo_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member";
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: "owner" | "admin" | "member";
          token_hash: string;
          invited_by: string | null;
          accepted_by: string | null;
          accepted_at: string | null;
          revoked_at: string | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email: string;
          role?: "owner" | "admin" | "member";
          token_hash: string;
          invited_by?: string | null;
          accepted_by?: string | null;
          accepted_at?: string | null;
          revoked_at?: string | null;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member";
          accepted_by?: string | null;
          accepted_at?: string | null;
          revoked_at?: string | null;
          expires_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: { org_name: string; org_slug: string };
        Returns: string;
      };
      get_organization_invitation: {
        Args: { p_token: string };
        Returns: {
          invitation_id: string;
          organization_id: string;
          organization_name: string;
          email: string;
          role: "owner" | "admin" | "member";
          expires_at: string;
          accepted_at: string | null;
          revoked_at: string | null;
        }[];
      };
      accept_organization_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      transfer_organization_ownership: {
        Args: { p_org_id: string; p_new_owner_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      organization_role: "owner" | "admin" | "member";
      billing_owner_type: "user" | "organization";
    };
    CompositeTypes: Record<string, never>;
  };
};
