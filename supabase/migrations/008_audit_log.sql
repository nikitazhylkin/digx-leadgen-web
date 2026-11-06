-- 008: Audit log — tracks who did what. Important now that a teammate is joining,
-- so any accidental mass-delete or bulk-reject has a paper trail.
--
-- Writes are expected from server-side mutation handlers (approve, reject,
-- delete, bulk actions) using the authenticated Supabase client.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor text,                                     -- email or 'system'
  action text not null,                           -- 'approve' | 'reject' | 'delete' | 'bulk_qualify' | ...
  lead_id uuid,                                   -- plain UUID, NOT an FK — an AFTER DELETE trigger
                                                  -- inserts here referencing the just-deleted lead,
                                                  -- which violates any FK. We keep the UUID as a
                                                  -- historical pointer without referential enforcement.
  metadata jsonb                                  -- rejection_reason, bulk count, prev state, etc.
);

create index if not exists audit_log_occurred_at_desc on public.audit_log (occurred_at desc);
create index if not exists audit_log_actor            on public.audit_log (actor, occurred_at desc);
create index if not exists audit_log_lead_id          on public.audit_log (lead_id);

alter table public.audit_log enable row level security;

-- Authenticated users can read the full log (transparency between Nikita + a teammate)
-- but cannot write directly — the trigger below writes as the DB role, which
-- bypasses the write policies.
drop policy if exists "authenticated_read_audit" on public.audit_log;
create policy "authenticated_read_audit"
  on public.audit_log for select
  to authenticated
  using (true);

-- ---- Trigger: auto-log qualification + deletion events on leads ----
-- Captures the authenticated user's email from auth.jwt(). When a change
-- happens through the service-role client (server-side), actor is 'system'.
create or replace function public.log_lead_change()
returns trigger language plpgsql security definer as $$
declare
  actor_email text;
begin
  actor_email := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'email',
    'system'
  );

  if tg_op = 'DELETE' then
    insert into public.audit_log (actor, action, lead_id, metadata)
    values (actor_email, 'delete', old.id,
            jsonb_build_object('full_name', old.full_name, 'company_name', old.company_name));
    return old;
  end if;

  if tg_op = 'UPDATE' then
    -- Only log qualification changes. Every row-level approve/reject produces a line.
    if coalesce(new.qualification,'') is distinct from coalesce(old.qualification,'') then
      insert into public.audit_log (actor, action, lead_id, metadata)
      values (actor_email,
              case when new.qualification = 'approved' then 'approve'
                   when new.qualification = 'rejected' then 'reject'
                   else 'unqualify' end,
              new.id,
              jsonb_build_object(
                'from', old.qualification,
                'to', new.qualification,
                'rejection_reason', new.rejection_reason
              ));
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists audit_lead_changes on public.leads;
create trigger audit_lead_changes
  after update or delete on public.leads
  for each row execute function public.log_lead_change();
