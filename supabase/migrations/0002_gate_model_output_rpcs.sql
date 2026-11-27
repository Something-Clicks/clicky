-- DEVELOPMENT (clicky-dev) ONLY. Applied via MCP as "gate_model_output_rpcs_behind_server_key". Not applied to production.
-- complete_analysis and finish_marketing_workflow were callable by any org member, so a customer could write fabricated
-- evidence/cards/workflow results by calling the API directly. The implementations move to app_private (no client grants)
-- and public wrappers require the server key (app_private.agent_key_ok(): x-agent-key header matching the hashed secret).
alter function public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text) set schema app_private;
alter function public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb) set schema app_private;
revoke all on function app_private.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function app_private.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.complete_analysis(p_analysis uuid, p_evidence jsonb, p_cards jsonb, p_coverage jsonb, p_summary text, p_wording text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  perform app_private.complete_analysis(p_analysis, p_evidence, p_cards, p_coverage, p_summary, p_wording);
end $$;

create or replace function public.finish_marketing_workflow(p_workflow uuid, p_status text, p_steps jsonb, p_result jsonb, p_error text, p_provider text, p_model text, p_usage jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  perform app_private.finish_marketing_workflow(p_workflow, p_status, p_steps, p_result, p_error, p_provider, p_model, p_usage);
end $$;

revoke all on function public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb) from public, anon;
grant execute on function public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb) to authenticated;
