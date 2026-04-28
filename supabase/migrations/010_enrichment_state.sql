-- 010: Honest enrichment state
--
-- Context: previously /api/enrich always wrote outreach_status='scored' at the end,
-- even if all three external providers (Proxycurl, Perplexity, TheirStack) failed.
-- The pipeline widget then falsely showed "Enriched" as complete. Also, the old
-- 'new' stage was noise — every ingested lead gets auto-scored server-side now,
-- so nothing should linger in 'new'.

-- Track enrichment outcome separately from outreach_status so the UI can show
-- "partial" or "failed" honestly.
alter table public.leads
  add column if not exists enrichment_error text,
  add column if not exists enrichment_completeness text
    check (enrichment_completeness is null
           or enrichment_completeness in ('partial', 'full'));

-- Backfill: every existing lead was pushed via the extension, which goes through
-- /api/ingest-leads. After this release, ingest auto-scores before returning,
-- so no row ever stays at 'new' again. Promote any straggler now.
update public.leads set outreach_status = 'scored' where outreach_status = 'new';
