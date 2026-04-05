-- Lead Pipeline Schema
-- Run in Supabase SQL Editor to create the leads table

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Identity
  linkedin_url text unique not null,
  first_name text,
  last_name text,
  full_name text,
  headline text,
  summary text,  -- LinkedIn About section
  location text,

  -- Company
  company_name text,
  company_name_casual text,
  company_url text,
  company_linkedin_url text,
  company_industry text,
  company_headcount int,
  company_hq text,
  company_description text,
  company_specialties text,

  -- Enrichment (from web scraping)
  company_homepage_text text,
  company_about_text text,

  -- Deep research (from Perplexity)
  person_research text,
  company_research text,

  -- Tech intelligence (from TheirStack)
  tech_stack jsonb,
  hiring_signals jsonb,

  -- LinkedIn data
  recent_posts jsonb,
  experiences jsonb,

  -- Scoring
  icp_score int,
  icp_tier text check (icp_tier in ('HOT', 'WARM', 'COLD', 'SKIP')),
  scoring_breakdown jsonb,

  -- Outreach
  outreach_status text default 'new'
    check (outreach_status in ('new', 'enriched', 'scored', 'message_ready', 'sent', 'connected', 'replied', 'converted')),
  message_variants jsonb,
  selected_message text,
  sent_at timestamptz,
  replied_at timestamptz,
  connected_at timestamptz,

  -- CRM
  clickup_task_id text,
  source text  -- 'linkedin_engagement' | 'sales_navigator' | 'manual' | 'csv_import' | 'extension'
);

-- Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on public.leads
  for each row
  execute function public.update_updated_at();

-- Indexes for common queries
create index if not exists idx_leads_outreach_status on public.leads (outreach_status);
create index if not exists idx_leads_icp_tier on public.leads (icp_tier);
create index if not exists idx_leads_icp_score on public.leads (icp_score desc);
create index if not exists idx_leads_company_name on public.leads (company_name);
create index if not exists idx_leads_created_at on public.leads (created_at desc);

-- Enable RLS but allow all for now (internal tool)
alter table public.leads enable row level security;
create policy "Allow all for anon" on public.leads
  for all using (true) with check (true);
