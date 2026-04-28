-- Migration 012: Settings Expansion (Task 1 — ClickUp integration)
--
-- Seeds app_config keys for the ClickUp integration. Values are null until the
-- user enters them via /settings. The /api/settings route's SUPPORTED_KEYS
-- allowlist is widened in lockstep with this migration.
--
-- Subsequent tasks (ICP editor, Saraev prompt, outreach config, notifications)
-- will append more keys to this file in their own commits.

insert into public.app_config (key, value) values
  ('clickup_api_token', null),  -- Personal API token from ClickUp settings
  ('clickup_team_id', null),    -- Workspace ID — used for permission checks (optional for v1)
  ('clickup_list_id', null),    -- "Pipeline" List ID inside the user-created "DigX Sales" Space
  -- Task 2 — ICP editor. Stored as JSON; null = use built-in defaults from scoring.ts.
  -- Schema: { tiers: {hot,warm,cold}, additionalExcludes: [{keywords[], reason}] }
  ('icp_rules', null)
on conflict (key) do nothing;
