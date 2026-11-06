-- 011: Pipeline reorder to connection-first outreach.
--
-- Context: a teammate + Nikita decided the platform should only enrich leads who
-- actually accepted the LinkedIn connection request. Today's flow enriches
-- everything post-approval, wasting tokens on people who never respond.
-- New order: scored → request_sent → connected → enriched → messaged → replied.
--
-- Approve button now means "I sent a connection request" (one click, two effects:
-- qualification='approved' AND outreach_status='request_sent'). Enrichment and
-- message generation fire automatically when status transitions to 'connected'.

alter table public.leads
  add column if not exists request_sent_at timestamptz,
  add column if not exists connection_accepted_at timestamptz;

-- Expand the outreach_status CHECK to allow the new pipeline values
-- ('request_sent', 'messaged'). Legacy values kept for back-compat.
alter table public.leads drop constraint if exists leads_outreach_status_check;
alter table public.leads add constraint leads_outreach_status_check
  check (outreach_status in (
    'new', 'scored', 'request_sent', 'connected',
    'enriched', 'message_ready', 'messaged', 'sent',
    'replied', 'converted'
  ));

-- Backfill: any lead already marked approved has, by a teammate's definition, had a
-- request sent at that moment. Copy qualified_at → request_sent_at so the new
-- analytics + the pipeline widget show correct history for existing rows, and
-- promote their outreach_status so the "Mark as connected" button appears.
update public.leads
set request_sent_at = qualified_at
where qualification = 'approved' and request_sent_at is null;

update public.leads
set outreach_status = 'request_sent'
where qualification = 'approved'
  and outreach_status = 'scored'
  and request_sent_at is not null;

create index if not exists idx_leads_request_sent_at on public.leads (request_sent_at desc);
create index if not exists idx_leads_connection_accepted_at on public.leads (connection_accepted_at desc);
