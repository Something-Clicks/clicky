-- Content breadth (spec §8): campaign tasks can now carry an FAQ, a blog post or a content brief, as well as the earlier channels.
-- Additive: only the allowed list of campaign_tasks.channel grows. Existing rows and functions are unchanged.
-- Rollback: supabase/rollback/20261206120000_more_content_channels_down.sql

alter table public.campaign_tasks drop constraint if exists campaign_tasks_channel_check;
alter table public.campaign_tasks add constraint campaign_tasks_channel_check
  check (channel is null or channel in ('landing_page', 'email', 'social', 'gbp', 'sms', 'faq', 'blog_post', 'content_brief'));
