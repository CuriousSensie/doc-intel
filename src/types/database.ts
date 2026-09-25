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
          blocked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member" | "read-only";
          blocked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member" | "read-only";
          blocked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          invitee_name: string | null;
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
          invitee_name?: string | null;
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
          page_count: number | null;
          byte_size: number | null;
          mime_type: string | null;
          checksum: string | null;
          status: "pending" | "processing" | "ready" | "failed" | "orphaned";
          source: "upload" | "email" | "template";
          synced_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          // ADR-0019 — nullable, null ("unfiled") is a permanent supported state.
          folder_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          paperless_document_id: number;
          title: string;
          document_type_key?: string | null;
          document_date?: string | null;
          page_count?: number | null;
          byte_size?: number | null;
          mime_type?: string | null;
          checksum?: string | null;
          status?: "pending" | "processing" | "ready" | "failed" | "orphaned";
          source?: "upload" | "email" | "template";
          synced_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          folder_id?: string | null;
        };
        Update: {
          title?: string;
          document_type_key?: string | null;
          document_date?: string | null;
          page_count?: number | null;
          byte_size?: number | null;
          mime_type?: string | null;
          checksum?: string | null;
          status?: "pending" | "processing" | "ready" | "failed" | "orphaned";
          synced_at?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
          folder_id?: string | null;
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
          // ADR-0019 Phase D — resolved before the upload intent is created, read by
          // sync-paperless-document.ts.
          folder_id: string | null;
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
          folder_id?: string | null;
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
          folder_id?: string | null;
        };
        Relationships: [];
      };
      // ADR-0019 — written only via create_folder/rename_folder/move_folder/delete_folder.
      folders: {
        Row: {
          id: string;
          organization_id: string;
          parent_folder_id: string | null;
          name: string;
          path: string;
          path_ids: string[];
          depth: number;
          match_conditions: Json | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          parent_folder_id?: string | null;
          name: string;
          path: string;
          path_ids?: string[];
          depth?: number;
          match_conditions?: Json | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          path?: string;
          path_ids?: string[];
          depth?: number;
          match_conditions?: Json | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      // ADR-0019 — written only via grant_folder_access/revoke_folder_access (no insert/update/
      // delete RLS policies), mirroring document_shares.
      folder_access: {
        Row: {
          id: string;
          organization_id: string;
          folder_id: string;
          granted_to: string;
          permission: "view" | "edit";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          folder_id: string;
          granted_to: string;
          permission: "view" | "edit";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          permission?: "view" | "edit";
          updated_at?: string;
        };
        Relationships: [];
      };
      // Written only via share_document/unshare_document (no insert/update/delete RLS policies).
      document_shares: {
        Row: {
          id: string;
          organization_id: string;
          document_id: string;
          // null = everyone in the organization
          shared_with: string | null;
          permission: "view" | "edit";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          document_id: string;
          shared_with?: string | null;
          permission: "view" | "edit";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          permission?: "view" | "edit";
          updated_at?: string;
        };
        Relationships: [];
      };
      // Mirror of Paperless custom field *definitions* only — never read from Paperless's
      // /api/custom_fields/ directly (cross-tenant leak, docs/spike-findings.md §1 #6).
      custom_field_defs: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          label: string;
          data_type:
            | "string"
            | "integer"
            | "float"
            | "monetary"
            | "date"
            | "boolean"
            | "select"
            | "url";
          options: Json | null;
          applies_to: string[];
          paperless_custom_field_id: number | null;
          is_required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          key: string;
          label: string;
          data_type:
            | "string"
            | "integer"
            | "float"
            | "monetary"
            | "date"
            | "boolean"
            | "select"
            | "url";
          options?: Json | null;
          applies_to?: string[];
          paperless_custom_field_id?: number | null;
          is_required?: boolean;
          created_at?: string;
        };
        Update: {
          label?: string;
          options?: Json | null;
          applies_to?: string[];
          is_required?: boolean;
        };
        Relationships: [];
      };
      saved_views: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          scope: "documents";
          view_kind: "dynamic" | "static";
          filters: Json;
          columns: Json;
          sort: Json | null;
          document_ids: Json;
          is_shared: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          scope: "documents";
          view_kind?: "dynamic" | "static";
          filters?: Json;
          columns?: Json;
          sort?: Json | null;
          document_ids?: Json;
          is_shared?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          view_kind?: "dynamic" | "static";
          filters?: Json;
          columns?: Json;
          sort?: Json | null;
          document_ids?: Json;
          is_shared?: boolean;
        };
        Relationships: [];
      };
      // Dokumenti Level 1 Milestone 7 (specs/05-level-1-structure.md §Bulk business actions/§Export).
      background_operations: {
        Row: {
          id: string;
          organization_id: string;
          kind: "bulk_connect" | "bulk_paperless_edit" | "export";
          status: "pending" | "processing" | "completed" | "failed";
          params: Json;
          total_count: number | null;
          processed_count: number;
          success_count: number;
          failure_count: number;
          failures: Json;
          result: Json | null;
          error_message: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          kind: "bulk_connect" | "bulk_paperless_edit" | "export";
          status?: "pending" | "processing" | "completed" | "failed";
          params?: Json;
          total_count?: number | null;
          processed_count?: number;
          success_count?: number;
          failure_count?: number;
          failures?: Json;
          result?: Json | null;
          error_message?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: "pending" | "processing" | "completed" | "failed";
          total_count?: number | null;
          processed_count?: number;
          success_count?: number;
          failure_count?: number;
          failures?: Json;
          result?: Json | null;
          error_message?: string | null;
          updated_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      rules: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          enabled: boolean;
          trigger:
            | "document.ingested"
            | "document.updated"
            | "manual";
          priority: number;
          conditions: Json;
          actions: Json;
          delegate_to_paperless: boolean;
          paperless_workflow_id: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          enabled?: boolean;
          trigger:
            | "document.ingested"
            | "document.updated"
            | "manual";
          priority?: number;
          conditions: Json;
          actions: Json;
          delegate_to_paperless?: boolean;
          paperless_workflow_id?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          enabled?: boolean;
          trigger?:
            | "document.ingested"
            | "document.updated"
            | "manual";
          priority?: number;
          conditions?: Json;
          actions?: Json;
          delegate_to_paperless?: boolean;
          paperless_workflow_id?: number | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      rule_runs: {
        Row: {
          id: string;
          organization_id: string;
          rule_id: string;
          document_id: string | null;
          trigger: string;
          matched: boolean;
          conditions_trace: Json;
          actions_applied: Json;
          status: "ok" | "skipped_conflict" | "failed" | "timeout";
          error_message: string | null;
          cascade_depth: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          rule_id: string;
          document_id?: string | null;
          trigger: string;
          matched: boolean;
          conditions_trace?: Json;
          actions_applied?: Json;
          status?: "ok" | "skipped_conflict" | "failed" | "timeout";
          error_message?: string | null;
          cascade_depth?: number;
          created_at?: string;
        };
        Update: {
          conditions_trace?: Json;
          actions_applied?: Json;
          status?: "ok" | "skipped_conflict" | "failed" | "timeout";
          error_message?: string | null;
        };
        Relationships: [];
      };
      rule_backfills: {
        Row: {
          id: string;
          organization_id: string;
          rule_id: string;
          status: "pending" | "running" | "paused" | "cancelled" | "completed" | "failed";
          filter: Json;
          matched_count: number;
          applied_count: number;
          cursor_document_id: string | null;
          created_by: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          rule_id: string;
          status?: "pending" | "running" | "paused" | "cancelled" | "completed" | "failed";
          filter?: Json;
          matched_count?: number;
          applied_count?: number;
          cursor_document_id?: string | null;
          created_by?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: "pending" | "running" | "paused" | "cancelled" | "completed" | "failed";
          matched_count?: number;
          applied_count?: number;
          cursor_document_id?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      // rls-coverage: admin-only (no write policy) — written only via apply_rule_action().
      field_provenance: {
        Row: {
          organization_id: string;
          document_id: string;
          field_key: string;
          updated_by: "user" | "rule" | "import" | "ai" | "system";
          source_id: string | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          document_id: string;
          field_key: string;
          updated_by: "user" | "rule" | "import" | "ai" | "system";
          source_id?: string | null;
          updated_at?: string;
        };
        Update: {
          updated_by?: "user" | "rule" | "import" | "ai" | "system";
          source_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      // rls-coverage: admin-only (no write policy) — written only by rule actions / worker sweep.
      reminders: {
        Row: {
          id: string;
          organization_id: string;
          document_id: string | null;
          due_date: string;
          assignee_role: "owner" | "admin" | "member";
          message: string;
          rule_id: string | null;
          fired_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          document_id?: string | null;
          due_date: string;
          assignee_role: "owner" | "admin" | "member";
          message: string;
          rule_id?: string | null;
          fired_at?: string | null;
          created_at?: string;
        };
        Update: {
          fired_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      apply_rule_action: {
        Args: {
          p_organization_id: string;
          p_rule_id: string;
          p_rule_run_id: string | null;
          p_action_type: string;
          p_action: Json;
          p_document_id?: string | null;
          p_field_key?: string | null;
        };
        Returns: string;
      };
      claim_rule_backfill_documents: {
        Args: {
          p_rule_backfill_id: string;
          p_organization_id: string;
          p_limit?: number;
          p_document_type_key?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
        };
        Returns: Database["public"]["Tables"]["documents"]["Row"][];
      };
      advance_rule_backfill_cursor: {
        Args: {
          p_rule_backfill_id: string;
          p_organization_id: string;
          p_cursor_document_id: string;
        };
        Returns: void;
      };
      increment_rule_backfill_progress: {
        Args: {
          p_rule_backfill_id: string;
          p_organization_id: string;
          p_matched_delta: number;
          p_applied_delta: number;
        };
        Returns: void;
      };
      complete_rule_backfill: {
        Args: { p_rule_backfill_id: string; p_organization_id: string };
        Returns: boolean;
      };
      fail_rule_backfill: {
        Args: { p_rule_backfill_id: string; p_organization_id: string; p_reason: string };
        Returns: boolean;
      };
      undo_rule_backfill: {
        Args: { p_rule_backfill_id: string; p_organization_id: string };
        Returns: number;
      };
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
          invitee_name: string | null;
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
      update_member_role: {
        Args: { p_member_id: string; p_role: "owner" | "admin" | "member" | "read-only" };
        Returns: undefined;
      };
      remove_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      leave_organization: {
        Args: { p_organization_id: string };
        Returns: undefined;
      };
      block_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      unblock_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      count_documents_by_creator: {
        Args: { p_organization_id: string };
        Returns: { created_by: string; document_count: number }[];
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
      can_manage_document: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
      can_edit_document: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
      is_document_shared_with_me: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
      filter_document_ids: {
        Args: { p_organization_id: string; p_ids: string[]; p_required: "edit" | "manage" };
        Returns: string[];
      };
      get_document_permissions: {
        Args: { p_document_id: string };
        Returns: Json;
      };
      share_document: {
        Args: { p_document_id: string; p_user_id: string | null; p_permission: "view" | "edit" };
        Returns: undefined;
      };
      unshare_document: {
        Args: { p_document_id: string; p_user_id: string | null };
        Returns: undefined;
      };
      can_manage_folder: {
        Args: { p_folder_id: string };
        Returns: boolean;
      };
      can_access_folder: {
        Args: { p_folder_id: string; p_require?: "view" | "edit" };
        Returns: boolean;
      };
      can_access_document_via_folder: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
      can_view_folder_as_ancestor: {
        Args: { p_folder_id: string };
        Returns: boolean;
      };
      get_folder_document_counts: {
        Args: { p_organization_id: string };
        Returns: { folder_id: string; document_count: number }[];
      };
      filter_folder_ids: {
        Args: { p_organization_id: string; p_ids: string[]; p_required: "view" | "edit" | "manage" };
        Returns: string[];
      };
      create_folder: {
        Args: {
          p_organization_id: string;
          p_parent_folder_id: string | null;
          p_name: string;
          p_match_conditions?: Json | null;
        };
        Returns: string;
      };
      rename_folder: {
        Args: { p_folder_id: string; p_new_name: string };
        Returns: undefined;
      };
      move_folder: {
        Args: { p_folder_id: string; p_new_parent_folder_id: string | null };
        Returns: undefined;
      };
      update_folder_match_conditions: {
        Args: { p_folder_id: string; p_match_conditions: Json | null };
        Returns: undefined;
      };
      delete_folder: {
        Args: {
          p_folder_id: string;
          p_mode?:
            | "require_empty"
            | "reassign_documents_to_null"
            | "reassign_documents_to"
            | "cascade_delete_subfolders";
          p_reassign_to_folder_id?: string | null;
        };
        Returns: undefined;
      };
      grant_folder_access: {
        Args: { p_folder_id: string; p_user_id: string; p_permission: "view" | "edit" };
        Returns: undefined;
      };
      revoke_folder_access: {
        Args: { p_folder_id: string; p_user_id: string };
        Returns: undefined;
      };
      get_org_dashboard_counts: {
        Args: { p_organization_id: string };
        Returns: { documents: number }[];
      };
      get_member_dashboard_counts: {
        Args: { p_organization_id: string; p_user_id: string };
        Returns: { documents: number }[];
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
