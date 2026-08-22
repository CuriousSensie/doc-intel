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
      stripe_customers: {
        Row: {
          id: string;
          owner_type: "user" | "organization";
          user_id: string | null;
          organization_id: string | null;
          stripe_customer_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_type: "user" | "organization";
          user_id?: string | null;
          organization_id?: string | null;
          stripe_customer_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_customer_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          owner_type: "user" | "organization";
          user_id: string | null;
          organization_id: string | null;
          stripe_customer_id: string;
          stripe_subscription_id: string | null;
          stripe_price_id: string | null;
          plan_key: string;
          status:
            | "incomplete"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_type: "user" | "organization";
          user_id?: string | null;
          organization_id?: string | null;
          stripe_customer_id: string;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          plan_key: string;
          status?:
            | "incomplete"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          plan_key?: string;
          status?:
            | "incomplete"
            | "trialing"
            | "active"
            | "past_due"
            | "canceled"
            | "unpaid"
            | "paused";
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          id: string;
          owner_type: "user" | "organization";
          user_id: string | null;
          organization_id: string | null;
          amount: number;
          type: "subscription_grant" | "purchase" | "usage" | "refund" | "admin_adjustment" | "promotion";
          reference: string | null;
          metadata: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_type: "user" | "organization";
          user_id?: string | null;
          organization_id?: string | null;
          amount: number;
          type: "subscription_grant" | "purchase" | "usage" | "refund" | "admin_adjustment" | "promotion";
          reference?: string | null;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      usage_counters: {
        Row: {
          id: string;
          owner_type: "user" | "organization";
          user_id: string | null;
          organization_id: string | null;
          feature: string;
          period: string;
          quantity: number;
          reset_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_type: "user" | "organization";
          user_id?: string | null;
          organization_id?: string | null;
          feature: string;
          period: string;
          quantity?: number;
          reset_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          quantity?: number;
          reset_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: string;
          event_id: string;
          event_type: string;
          status: "pending" | "processed" | "failed";
          payload: Json;
          error: string | null;
          processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          provider: string;
          event_id: string;
          event_type: string;
          status?: "pending" | "processed" | "failed";
          payload: Json;
          error?: string | null;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "pending" | "processed" | "failed";
          error?: string | null;
          processed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          message: string;
          metadata: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          message: string;
          metadata?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          read_at?: string | null;
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
      increment_usage_counter: {
        Args: {
          p_owner_type: "user" | "organization";
          p_user_id: string | null;
          p_organization_id: string | null;
          p_feature: string;
          p_period: string;
          p_amount: number;
          p_limit: number;
        };
        Returns: number;
      };
      consume_credits: {
        Args: {
          p_owner_type: "user" | "organization";
          p_user_id: string | null;
          p_organization_id: string | null;
          p_amount: number;
          p_reference: string;
          p_metadata?: Json;
        };
        Returns: number;
      };
    };
    Enums: {
      organization_role: "owner" | "admin" | "member";
      billing_owner_type: "user" | "organization";
      subscription_status: "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
      credit_transaction_type: "subscription_grant" | "purchase" | "usage" | "refund" | "admin_adjustment" | "promotion";
      webhook_processing_status: "pending" | "processed" | "failed";
    };
    CompositeTypes: Record<string, never>;
  };
};
