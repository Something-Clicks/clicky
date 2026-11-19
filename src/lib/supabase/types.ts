/**
 * Generated from the Supabase project schema (Phase 1 migrations).
 * Regenerate after every migration (Supabase CLI: `supabase gen types typescript`).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: {
    foreignKeyName: string;
    columns: string[];
    isOneToOne: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }[];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      activity_log: Table<
        {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          organization_id: string | null;
          target_id: string | null;
          target_type: string | null;
        },
        "action"
      >;
      business_profiles: Table<
        {
          business_name: string;
          created_at: string;
          organization_id: string;
          primary_goal: string | null;
          service_area: string | null;
          updated_at: string;
          website: string | null;
        },
        "business_name" | "organization_id"
      >;
      organization_members: Table<
        { created_at: string; organization_id: string; role: string; user_id: string },
        "organization_id" | "role" | "user_id"
      > & {
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: Table<
        { created_at: string; created_by: string | null; id: string; name: string; updated_at: string },
        "name"
      >;
      platform_admins: Table<{ granted_at: string; note: string | null; user_id: string }, "user_id">;
      profiles: Table<{ created_at: string; full_name: string | null; id: string; updated_at: string }, "id">;
    };
    Views: { [_ in never]: never };
    Functions: {
      admin_overview: { Args: never; Returns: Json };
      create_organization: {
        Args: { p_business_name: string; p_primary_goal: string; p_service_area: string; p_website: string };
        Returns: string;
      };
      current_user_is_platform_admin: { Args: never; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
