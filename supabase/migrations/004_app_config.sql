-- Runtime-editable app configuration.
-- Stores API keys that can be rotated from the UI without redeploying.
-- Server-side routes read process.env first, then fall back to this table.

create table if not exists public.app_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.app_config enable row level security;

-- Allow reads/writes from anon key — internal tool only, behind Supabase access
create policy "Allow all for anon on app_config"
  on public.app_config for all using (true) with check (true);

-- Seed the keys we know about so the UI has something to render
insert into public.app_config (key, value) values
  ('proxycurl_api_key', null),
  ('theirstack_api_key', null)
on conflict (key) do nothing;
