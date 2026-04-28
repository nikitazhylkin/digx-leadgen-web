-- Phase A2 + B1 + B4: Cleanup + enrichment depth schema changes
-- Run all three blocks in Supabase SQL Editor.

-- ── A2: Null out company_url values that are actually LinkedIn pages ──
-- Caused by extension bug where Voyager returned person's LinkedIn as the
-- first "website". Nulling forces re-enrichment to fetch the real site via
-- Proxycurl (when key is set).
update public.leads
set company_url = null
where company_url ilike '%linkedin.com%';

-- ── B1: Combined website scrape text (homepage + /about + product/pricing) ──
alter table public.leads add column if not exists company_website_text text;

-- ── B4: Proof points (named customers, partnerships, case studies) ──
alter table public.leads add column if not exists proof_points jsonb;
