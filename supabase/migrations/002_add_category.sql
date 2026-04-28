-- Add category column for tagging leads at import/push time.
-- Used to group leads by ICP batch (e.g., "DigX Wholesale", "DigX E-commerce",
-- "Food & Beverage Apr 22"), then filter by that grouping in the dashboard.

alter table public.leads add column if not exists category text;

create index if not exists idx_leads_category on public.leads (category);
