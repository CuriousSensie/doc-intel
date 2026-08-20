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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      organization_role: "owner" | "admin" | "member";
      billing_owner_type: "user" | "organization";
    };
    CompositeTypes: Record<string, never>;
  };
};
