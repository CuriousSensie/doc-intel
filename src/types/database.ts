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
          suspended_at: string | null;
          // provisioning_status/ai_enabled are system-managed — protect_system_columns().
          timezone: string;
          locale: string;
          default_currency: string;
          provisioning_status: "pending" | "provisioning" | "ready" | "provisioning_failed";
          ai_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          created_by?: string | null;
          suspended_at?: string | null;
          timezone?: string;
          locale?: string;
          default_currency?: string;
          provisioning_status?: "pending" | "provisioning" | "ready" | "provisioning_failed";
          ai_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          logo_url?: string | null;
          suspended_at?: string | null;
          timezone?: string;
          locale?: string;
          default_currency?: string;
          // provisioning_status/ai_enabled omitted — protect_system_columns() blocks tenant writes.
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "member" | "read-only";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member" | "read-only";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member" | "read-only";
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: "owner" | "admin" | "member" | "read-only";
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
          role?: "owner" | "admin" | "member" | "read-only";
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
          role?: "owner" | "admin" | "member" | "read-only";
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
            "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          platform_disabled_at: string | null;
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
            "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          platform_disabled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          plan_key?: string;
          status?:
            "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          platform_disabled_at?: string | null;
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
          type:
            | "subscription_grant"
            | "purchase"
            | "usage"
            | "refund"
            | "admin_adjustment"
            | "promotion";
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
          type:
            | "subscription_grant"
            | "purchase"
            | "usage"
            | "refund"
            | "admin_adjustment"
            | "promotion";
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
      // RLS-enabled, zero policies — admin-client only (src/lib/paperless/client.ts).
      tenant_paperless_config: {
        Row: {
          organization_id: string;
          base_url: string;
          service_user_id: number;
          group_id: number;
          api_token_encrypted: string; // bytea over the wire — see decodePostgresBytea()
          storage_path_id: number | null;
          last_reconciled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          base_url: string;
          service_user_id: number;
          group_id: number;
          api_token_encrypted: string;
          storage_path_id?: number | null;
          last_reconciled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          base_url?: string;
          service_user_id?: number;
          group_id?: number;
          api_token_encrypted?: string;
          storage_path_id?: number | null;
          last_reconciled_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      paperless_object_map: {
        Row: {
          id: number;
          organization_id: string;
          object_type:
            | "document"
            | "tag"
            | "document_type"
            | "custom_field"
            | "correspondent"
            | "storage_path"
            | "workflow"
            | "saved_view";
          paperless_id: number;
          local_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          object_type:
            | "document"
            | "tag"
            | "document_type"
            | "custom_field"
            | "correspondent"
            | "storage_path"
            | "workflow"
            | "saved_view";
          paperless_id: number;
          local_id?: string | null;
          created_at?: string;
        };
        Update: {
          local_id?: string | null;
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
      files: {
        Row: {
          id: string;
          owner_id: string;
          organization_id: string | null;
          bucket: string;
          path: string;
          filename: string;
          mime_type: string;
          size: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          organization_id?: string | null;
          bucket: string;
          path: string;
          filename: string;
          mime_type: string;
          size: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_type: "user" | "system" | "rule" | "import" | "ai";
          organization_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Json;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_type?: "user" | "system" | "rule" | "import" | "ai";
          organization_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      // specs/02-data-model.md, specs/05-level-1-structure.md. is_system rows are the four
      // seeded types (customer/project/employee/contract) — complete_provisioning().
      entity_types: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          name: string;
          name_plural: string;
          icon: string | null;
          is_system: boolean;
          field_schema: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          key: string;
          name: string;
          name_plural: string;
          icon?: string | null;
          is_system?: boolean;
          field_schema?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          name_plural?: string;
          icon?: string | null;
          field_schema?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Paperless mirror (specs/02-data-model.md). Written only by the sync worker — no
      // insert/update/delete policy, select-only for members.
      documents: {
        Row: {
          id: string;
          organization_id: string;
          paperless_document_id: number;
          title: string;
          document_type_key: string | null;
          document_date: string | null;
          correspondent_name: string | null;
          page_count: number | null;
          byte_size: number | null;
          mime_type: string | null;
          checksum: string | null;
          status: "pending" | "processing" | "ready" | "failed" | "orphaned";
          source: "upload" | "import" | "email" | "template";
          import_job_id: string | null;
          synced_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          paperless_document_id: number;
          title: string;
          document_type_key?: string | null;
          document_date?: string | null;
          correspondent_name?: string | null;
          page_count?: number | null;
          byte_size?: number | null;
          mime_type?: string | null;
          checksum?: string | null;
          status?: "pending" | "processing" | "ready" | "failed" | "orphaned";
          source?: "upload" | "import" | "email" | "template";
          import_job_id?: string | null;
          synced_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          title?: string;
          document_type_key?: string | null;
          document_date?: string | null;
          correspondent_name?: string | null;
          page_count?: number | null;
          byte_size?: number | null;
          mime_type?: string | null;
          checksum?: string | null;
          status?: "pending" | "processing" | "ready" | "failed" | "orphaned";
          synced_at?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      document_uploads: {
        Row: {
          id: string;
          organization_id: string;
          storage_path: string;
          filename: string;
          declared_mime_type: string;
          size_bytes: number;
          status:
            | "pending"
            | "uploaded"
            | "validating"
            | "validated"
            | "submitting"
            | "processing"
            | "completed"
            | "failed"
            | "expired";
          error_message: string | null;
          paperless_task_id: string | null;
          document_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          storage_path: string;
          filename: string;
          declared_mime_type: string;
          size_bytes: number;
          status?:
            | "pending"
            | "uploaded"
            | "validating"
            | "validated"
            | "submitting"
            | "processing"
            | "completed"
            | "failed"
            | "expired";
          error_message?: string | null;
          paperless_task_id?: string | null;
          document_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          expires_at: string;
        };
        Update: {
          status?:
            | "pending"
            | "uploaded"
            | "validating"
            | "validated"
            | "submitting"
            | "processing"
            | "completed"
            | "failed"
            | "expired";
          error_message?: string | null;
          paperless_task_id?: string | null;
          document_id?: string | null;
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
          role: "owner" | "admin" | "member" | "read-only";
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
      purge_old_audit_logs: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      complete_provisioning: {
        Args: {
          p_organization_id: string;
          p_base_url: string;
          p_service_user_id: number;
          p_group_id: number;
          p_api_token_encrypted: string;
          p_storage_path_id: number | null;
          p_object_map: Json;
        };
        Returns: undefined;
      };
      fail_provisioning: {
        Args: { p_organization_id: string; p_reason: string };
        Returns: undefined;
      };
      claim_provisioning: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      claim_upload_validation: {
        Args: { p_upload_id: string; p_organization_id: string };
        Returns: boolean;
      };
      complete_upload_validation: {
        Args: { p_upload_id: string; p_organization_id: string };
        Returns: undefined;
      };
      fail_upload_validation: {
        Args: { p_upload_id: string; p_organization_id: string; p_reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      organization_role: "owner" | "admin" | "member" | "read-only";
      billing_owner_type: "user" | "organization";
      subscription_status:
        "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
      credit_transaction_type:
        "subscription_grant" | "purchase" | "usage" | "refund" | "admin_adjustment" | "promotion";
      webhook_processing_status: "pending" | "processed" | "failed";
    };
    CompositeTypes: Record<string, never>;
  };
};
