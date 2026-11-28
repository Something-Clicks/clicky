-- Rolls back 20261206120000_more_content_channels. Tasks that already use a new channel are cleared to "no channel" first
-- (their template text stays), so the older constraint can be restored.
update public.campaign_tasks set channel = null where channel in ('faq', 'blog_post', 'content_brief');
alter table public.campaign_tasks drop constraint if exists campaign_tasks_channel_check;
alter table public.campaign_tasks add constraint campaign_tasks_channel_check
  check (channel is null or channel in ('landing_page', 'email', 'social', 'gbp', 'sms'));
