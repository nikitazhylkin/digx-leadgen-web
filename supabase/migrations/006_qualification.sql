-- Phase 1 of the pipeline: manual qualification BEFORE enrichment.
-- a teammate (or anyone) reviews a lead and marks it approved or rejected.
-- Only approved leads should be enriched — saves API budget.
-- Rejection reasons accumulate as training data for future auto-qualification.

alter table public.leads add column if not exists qualification text
  check (qualification is null or qualification in ('approved', 'rejected'));

alter table public.leads add column if not exists rejection_reason text;

-- Timestamps for audit + learning
alter table public.leads add column if not exists qualified_at timestamptz;
alter table public.leads add column if not exists qualified_by text;

create index if not exists idx_leads_qualification on public.leads (qualification);
