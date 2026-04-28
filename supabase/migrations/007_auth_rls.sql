-- 007: Lock down RLS before Kira access.
--
-- Previously leads + app_config were readable/writable by the anon key, meaning
-- anyone who pulled NEXT_PUBLIC_SUPABASE_ANON_KEY out of the bundle could
-- dump the entire leads table OR read live API keys from app_config.
--
-- After this migration:
--   - leads: authenticated users (logged in via Supabase Auth) get full CRUD.
--     Anon sessions get nothing. Middleware in the Next.js app keeps the UI
--     behind /login, so in practice only Nikita + Kira (plus any future
--     provisioned accounts) can read or write leads.
--   - app_config: service role only. Even the authenticated web session
--     cannot read API keys — the /api/settings + /lib/config server code
--     uses the service-role client to touch this table. Keys never leave
--     the server.

-- ---- leads ----
alter table public.leads enable row level security;
drop policy if exists "Allow all for anon" on public.leads;
drop policy if exists "authenticated_read"   on public.leads;
drop policy if exists "authenticated_insert" on public.leads;
drop policy if exists "authenticated_update" on public.leads;
drop policy if exists "authenticated_delete" on public.leads;

create policy "authenticated_read"
  on public.leads for select
  to authenticated
  using (true);

create policy "authenticated_insert"
  on public.leads for insert
  to authenticated
  with check (true);

create policy "authenticated_update"
  on public.leads for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_delete"
  on public.leads for delete
  to authenticated
  using (true);

-- ---- app_config ----
alter table public.app_config enable row level security;
drop policy if exists "Allow all for anon on app_config" on public.app_config;
drop policy if exists "service_only" on public.app_config;

-- No policies = no access from anon or authenticated clients.
-- Service role bypasses RLS, so server-side admin client still works.
-- We leave the table without any policy so everyone except service_role
-- is blocked by default.
