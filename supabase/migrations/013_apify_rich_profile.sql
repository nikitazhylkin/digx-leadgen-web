-- Migration 013: Apify rich profile fields
-- Context: Switching from Proxycurl/extension scraping to Apify managed
-- LinkedIn scraping. The chosen actor (2SyF0bVxmgGr8IVCZ) returns email +
-- skills + education + recent posts + photo + connections count. Save the
-- full raw response in `apify_raw` for future-proofing, plus map curated
-- fields to typed columns for queries and Saraev message inputs.
--
-- Additive only. No drops, no constraint changes.

alter table public.leads
  add column if not exists email text,
  add column if not exists email_verified boolean,
  add column if not exists apify_raw jsonb,
  add column if not exists skills text[],
  add column if not exists education jsonb,
  add column if not exists certifications jsonb,
  add column if not exists recent_posts jsonb,
  add column if not exists profile_image_url text,
  add column if not exists connections_count integer,
  add column if not exists languages jsonb;

create index if not exists idx_leads_email on public.leads (email) where email is not null;
