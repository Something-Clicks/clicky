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
          zip_code: string | null;
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
        { created_at: string; created_by: string | null; id: string; name: string; updated_at: string; recurring_analysis: boolean },
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
          free_use: boolean;
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
          verification: string | null;
          verified_at: string | null;
          verification_analysis_id: string | null;
          // ── marketing workflow (20261126120000); stage and completion_basis are generated ──
          origin: string;
          stage: string;
          completion_basis: string | null;
          // ── evidence classes (20261127120000); derived for fixed checks, validated for model findings ──
          evidence_class: string | null;
          evidence_basis: string | null;
        },
        "organization_id" | "analysis_id" | "check_key" | "title"
      >;
      business_facts: Table<
        {
          id: string;
          organization_id: string;
          category: string;
          field: string;
          value: string | null;
          source: string;
          evidence_class: string;
          basis: string | null;
          evidence: Json;
          status: string;
          analysis_id: string | null;
          observed_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "organization_id" | "category" | "field" | "source" | "evidence_class"
      >;
      draft_versions: Table<
        { id: string; organization_id: string; approval_id: string; version: number; fields: Json; source: string; created_by: string | null; created_at: string },
        "organization_id" | "approval_id" | "version" | "fields" | "source"
      >;
      marketing_workflows: Table<
        {
          id: string;
          organization_id: string;
          kind: string;
          status: string;
          request: string | null;
          capabilities: string[];
          analysis_id: string | null;
          steps: Json;
          result: Json | null;
          provider: string | null;
          model: string | null;
          usage: Json | null;
          error: string | null;
          started_by: string | null;
          started_at: string;
          completed_at: string | null;
        },
        "organization_id" | "kind"
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
          free_use: boolean;
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
          approved_version_id: string | null;
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
      notification_preferences: Table<
        { user_id: string; draft_ready: boolean; analysis_complete: boolean; updated_at: string },
        "user_id"
      >;
      notifications: Table<
        { id: string; organization_id: string; user_id: string; kind: string; channel: string; status: string; detail: string | null; created_at: string },
        "organization_id" | "user_id" | "kind" | "status"
      >;
      plan_entitlements: Table<{ plan_id: string; analyses: boolean; weekly: boolean; drafts: string }, "plan_id" | "analyses" | "weekly" | "drafts">;
      subscriptions: Table<
        {
          id: string;
          organization_id: string;
          stripe_subscription_id: string;
          plan_id: string;
          status: string;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          billing_interval: string | null;
          stripe_price_id: string | null;
          updated_at: string;
          created_at: string;
        },
        "organization_id" | "stripe_subscription_id" | "plan_id" | "status"
      >;
      purchases: Table<
        { id: string; organization_id: string; plan_id: string; stripe_checkout_session_id: string; amount_cents: number; paid_at: string },
        "organization_id" | "plan_id" | "stripe_checkout_session_id" | "amount_cents"
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
      worker_due_organizations: {
        Args: { p_limit: number };
        Returns: { organization_id: string; website: string; business_name: string; service_area: string | null; primary_goal: string | null }[];
      };
      notification_recipients: {
        Args: { p_org: string; p_kind: string };
        Returns: { user_id: string; email: string; full_name: string | null }[];
      };
      log_notification: {
        Args: { p_org: string; p_user: string; p_kind: string; p_status: string; p_detail: string | null };
        Returns: undefined;
      };
      current_entitlements: { Args: { p_org: string }; Returns: Json };
      billing_customer_id: { Args: { p_org: string }; Returns: string | null };
      billing_record_event: { Args: { p_key: string; p_event_id: string; p_type: string }; Returns: string };
      billing_finish_event: { Args: { p_key: string; p_event_id: string; p_status: string; p_error: string | null }; Returns: undefined };
      billing_record_purchase: {
        Args: { p_key: string; p_org: string; p_plan: string; p_session: string; p_customer: string | null; p_amount: number };
        Returns: undefined;
      };
      billing_upsert_subscription: {
        Args: {
          p_key: string; p_org: string; p_customer: string | null; p_subscription: string; p_plan: string;
          p_status: string; p_period_end: string | null; p_cancel_at_period_end: boolean;
          /** Launch migration: the 10-argument version also stores interval and price. */
          p_interval?: "month" | "year"; p_price?: string;
        };
        Returns: undefined;
      };
      start_analysis: { Args: { p_org: string }; Returns: string };
      complete_analysis: {
        Args: { p_analysis: string; p_evidence: Json; p_cards: Json; p_coverage: Json; p_summary: string; p_wording: string };
        Returns: undefined;
      };
      fail_analysis: { Args: { p_analysis: string; p_reason: string }; Returns: undefined };
      set_action_card_status: { Args: { p_card: string; p_status: string; p_note: string | null }; Returns: undefined };
      // ── marketing workflow (20261126120000) ──
      start_marketing_workflow: {
        Args: { p_org: string; p_kind: string; p_request: string | null; p_capabilities: string[]; p_analysis: string | null };
        Returns: string;
      };
      finish_marketing_workflow: {
        Args: {
          p_workflow: string; p_status: string; p_steps: Json; p_result: Json | null; p_error: string | null;
          p_provider: string | null; p_model: string | null; p_usage: Json | null;
        };
        Returns: undefined;
      };
      approve_action_card: { Args: { p_card: string; p_note: string | null }; Returns: undefined };
      // ── Business Intelligence (20261127120000) ──
      propose_business_facts: { Args: { p_org: string; p_analysis: string | null; p_facts: Json }; Returns: number };
      review_business_fact: { Args: { p_fact: string; p_decision: string; p_value: string | null }; Returns: string };
      add_business_fact: { Args: { p_org: string; p_category: string; p_field: string; p_value: string }; Returns: string };
      // ── model findings and draft versions (20261128120000) ──
      add_model_findings: { Args: { p_analysis: string; p_evidence: Json; p_cards: Json }; Returns: number };
      edit_draft: { Args: { p_approval: string; p_fields: Json }; Returns: string };
      approve_draft_version: { Args: { p_approval: string; p_version: string }; Returns: undefined };
      // ── launch redesign (20261124120000) ──
      free_uses: { Args: { p_org: string }; Returns: Json };
      claim_preview: { Args: { p_claim: string }; Returns: Json };
      admin_funnel: { Args: { p_days: number }; Returns: Json };
      site_preview_start: {
        Args: { p_key: string; p_website: string; p_domain: string; p_zip: string; p_ip_hash: string; p_view: string };
        Returns: Json;
      };
      site_preview_complete: {
        Args: { p_key: string; p_id: string; p_evidence: Json; p_cards: Json; p_coverage: Json; p_summary: string; p_wording: string };
        Returns: undefined;
      };
      site_preview_fail: { Args: { p_key: string; p_id: string; p_reason: string }; Returns: undefined };
      site_preview_get: { Args: { p_key: string; p_id: string; p_view: string }; Returns: Json };
      site_preview_save: { Args: { p_key: string; p_id: string; p_view: string; p_email: string; p_claim: string }; Returns: undefined };
      site_submit_feedback: {
        Args: {
          p_key: string; p_kind: string; p_rating: string | null; p_reason: string | null; p_preview: string | null;
          p_org: string | null; p_ip_hash: string; p_followup_email: string | null;
        };
        Returns: undefined;
      };
      site_track: { Args: { p_key: string; p_event: string; p_props: Json }; Returns: undefined };

    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
