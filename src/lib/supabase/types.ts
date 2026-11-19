/**
 * Generated from the Supabase project schema (Phase 1 migrations).
 * Regenerate after every migration (Supabase CLI: `supabase gen types typescript`).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Required extends keyof Row, Rels extends Rel[] = []> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: Rels;
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
        "organization_id" | "role" | "user_id",
        [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ]
      >;
      organizations: Table<
        { created_at: string; created_by: string | null; id: string; name: string; updated_at: string },
        "name"
      >;
      data_connections: Table<
        {
          id: string;
          organization_id: string;
          provider: string;
          status: string;
          scopes: string[];
          account_identity: string | null;
          token_ref: string | null;
          last_synced_at: string | null;
          sync_status: string | null;
          last_error: string | null;
          disconnected_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "organization_id" | "provider"
      >;
      analyses: Table<
        {
          id: string;
          organization_id: string;
          status: string;
          website: string | null;
          source_coverage: Json;
          summary: string | null;
          wording: string | null;
          failure_reason: string | null;
          triggered_by: string | null;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        },
        "organization_id"
      >;
      analysis_evidence: Table<
        {
          id: string;
          analysis_id: string;
          organization_id: string;
          source: string;
          kind: string;
          check_key: string;
          url: string | null;
          observation: string;
          excerpt: string | null;
          measurement: Json | null;
          observed_at: string;
        },
        "analysis_id" | "organization_id" | "source" | "kind" | "check_key" | "observation"
      >;
      action_cards: Table<
        {
          id: string;
          organization_id: string;
          analysis_id: string;
          check_key: string;
          title: string;
          explanation: string;
          why_it_matters: string;
          recommended_action: string;
          expected_benefit: string;
          impact_priority: string;
          confidence: string;
          ai_capable: boolean;
          execution_type: string;
          approval_required: boolean;
          status: string;
          wording: string;
          result_summary: string | null;
          failure_reason: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        },
        "organization_id" | "analysis_id" | "check_key" | "title"
      >;
      action_card_evidence: Table<
        { action_card_id: string; evidence_id: string; organization_id: string },
        "action_card_id" | "evidence_id" | "organization_id",
        [
          {
            foreignKeyName: "action_card_evidence_evidence_id_fkey";
            columns: ["evidence_id"];
            isOneToOne: false;
            referencedRelation: "analysis_evidence";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_card_evidence_action_card_id_fkey";
            columns: ["action_card_id"];
            isOneToOne: false;
            referencedRelation: "action_cards";
            referencedColumns: ["id"];
          },
        ]
      >;
      agent_runs: Table<
        {
          id: string;
          organization_id: string;
          action_card_id: string;
          draft_type: string;
          status: string;
          permission: string;
          instructions: string | null;
          model: string | null;
          output: Json | null;
          usage: Json | null;
          error: string | null;
          started_by: string | null;
          started_at: string;
          completed_at: string | null;
        },
        "organization_id" | "action_card_id" | "draft_type",
        [
          {
            foreignKeyName: "agent_runs_action_card_id_fkey";
            columns: ["action_card_id"];
            isOneToOne: false;
            referencedRelation: "action_cards";
            referencedColumns: ["id"];
          },
        ]
      >;
      approvals: Table<
        {
          id: string;
          organization_id: string;
          agent_run_id: string;
          action_card_id: string;
          decision: string;
          note: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        },
        "organization_id" | "agent_run_id" | "action_card_id",
        [
          {
            foreignKeyName: "approvals_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: true;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_action_card_id_fkey";
            columns: ["action_card_id"];
            isOneToOne: false;
            referencedRelation: "action_cards";
            referencedColumns: ["id"];
          },
        ]
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
      start_agent_run: { Args: { p_card: string; p_instructions: string }; Returns: string };
      complete_agent_run: { Args: { p_run: string; p_output: Json; p_model: string; p_usage: Json }; Returns: string };
      fail_agent_run: { Args: { p_run: string; p_reason: string }; Returns: undefined };
      decide_approval: { Args: { p_approval: string; p_decision: string; p_note: string | null }; Returns: undefined };
      admin_agent_runs: { Args: never; Returns: Json };
      start_analysis: { Args: { p_org: string }; Returns: string };
      complete_analysis: {
        Args: { p_analysis: string; p_evidence: Json; p_cards: Json; p_coverage: Json; p_summary: string; p_wording: string };
        Returns: undefined;
      };
      fail_analysis: { Args: { p_analysis: string; p_reason: string }; Returns: undefined };
      set_action_card_status: { Args: { p_card: string; p_status: string; p_note: string | null }; Returns: undefined };

    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
