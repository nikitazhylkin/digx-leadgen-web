# Architecture

## Overview

One Next.js 16 app (App Router). Pages are client components that read and write Supabase directly through the signed-in user's session, protected by row level security. Server route handlers under `src/app/api/` do the work that needs secrets or third-party APIs. Everything is stored in three Supabase tables.

```
Browser (pages, Supabase session)
   |-- direct reads/writes on leads (RLS: authenticated users only)
   |-- fetch /api/*  -->  route handlers
                            |-- requireUser() guard (session cookie)
                            |-- admin client (service role) for app_config, ingest, health, ClickUp
                            |-- Apify, Perplexity, TheirStack, Anthropic, ClickUp
Chrome extension (not in this repo) --> /api/ingest-leads, /api/health  (anon key as shared secret)
```

## Data model

Defined in `supabase/migrations/001` to `013`. Three tables.

### `leads`

One row per person or company. `linkedin_url` is unique and required (the Google Sheet import writes a placeholder value for company-only rows).

| Group | Columns |
|---|---|
| Identity | `id`, `created_at`, `updated_at`, `linkedin_url`, `first_name`, `last_name`, `full_name`, `headline`, `summary`, `location`, `email`, `email_verified`, `profile_image_url`, `connections_count`, `languages`, `skills`, `education`, `certifications` |
| Company | `company_name`, `company_name_casual`, `company_url`, `company_linkedin_url`, `company_industry`, `company_headcount`, `company_hq`, `company_description`, `company_specialties`, `company_homepage_text`, `company_about_text`, `company_website_text` |
| Enrichment | `person_research`, `company_research`, `tech_stack`, `hiring_signals`, `recent_posts`, `experiences`, `proof_points`, `apify_raw`, `enrichment_completeness` (`partial` or `full`), `enrichment_error` |
| Scoring | `icp_score`, `icp_tier` (`HOT`, `WARM`, `COLD`, `SKIP`), `scoring_breakdown` (JSON), `category` |
| Qualification | `qualification` (`approved` or `rejected`), `rejection_reason`, `qualified_at`, `qualified_by` |
| Outreach | `outreach_status`, `request_sent_at`, `connection_accepted_at`, `message_variants` (JSON), `selected_message`, `sent_at`, `replied_at`, `connected_at`, `notes` |
| Hand-off | `clickup_task_id`, `source` |

`outreach_status` is checked against: `new`, `scored`, `request_sent`, `connected`, `enriched`, `message_ready`, `messaged`, `sent`, `replied`, `converted`. The working order is `scored`, `request_sent`, `connected`, `enriched`, `messaged`, `replied`, `converted`. `new`, `message_ready` and `sent` are kept for older rows.

A trigger (`updated_at`) keeps `updated_at` current.

### `app_config`

Key and value text pairs with `updated_at`. After migration 007 the table has row level security on and no policies, so only the service role can read or write it. Keys in use: `perplexity_api_key`, `theirstack_api_key`, `anthropic_api_key`, `clickup_api_token`, `clickup_team_id`, `clickup_list_id`, `icp_rules` (JSON with tier thresholds and extra exclusions). The code can also read `apify_token` and `apify_linkedin_actor` from here, but the Settings API does not write them.

### `audit_log`

`id`, `occurred_at`, `actor`, `action`, `lead_id` (not a foreign key, so entries survive a delete), `metadata` (JSON). A trigger on `leads` writes a row when `qualification` changes (`approve`, `reject`, `unqualify`) and when a lead is deleted (`delete`). Signed-in users can read it. The analytics page uses it for per-user approvals and rejection reasons.

### Row level security

After migration 007, `leads` allows select, insert, update and delete only to authenticated users. The anon key alone cannot read or write leads, which is why extension traffic goes through a server route that uses the service role.

## API routes

Routes marked "session" require a signed-in user (`requireUser()` in `src/lib/auth.ts`) and return 401 JSON otherwise. Routes marked "anon key" require the Supabase anon key in an `apikey` or `Authorization: Bearer` header.

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/leads` | POST | session | Create URL-only leads from one `linkedin_url` or a `linkedin_urls` list, optional `category`. Only `linkedin.com/in/` and `linkedin.com/sales/` URLs are accepted. URLs already in the table are skipped. |
| `/api/leads/[id]` | DELETE | session | Delete one lead. |
| `/api/leads/bulk-delete` | POST | session | Delete leads by `ids`, in chunks of 200. |
| `/api/import-sheet` | POST | session | Create company-only leads from Google Sheet rows. |
| `/api/ingest-leads` | POST, OPTIONS | anon key | Upsert leads pushed by the extension (`row` or `rows`) and score them on arrival. |
| `/api/health` | GET, OPTIONS | anon key | Recommended daily scrape cap for the extension: 100 by default, 30 on weekends (UTC), 50 when the 14-day acceptance rate is under 15% with at least 10 requests sent. |
| `/api/score` | POST | session | Re-score one lead by `lead_id` with the live ICP rules. |
| `/api/qualify` | POST | session | Approve, reject or clear a lead. Approve sets `request_sent`. If the lead has no score yet, it also runs enrichment and scoring. |
| `/api/enrich` | POST | session | Run enrichment for a `linkedin_url`, score the result, and save it. Status becomes `enriched` if at least one provider succeeded. |
| `/api/generate` | POST | session | Ask Claude for three message variants for a `lead_id`, save them, set `message_ready`. |
| `/api/clickup/push` | POST | session | Create a ClickUp task for a `leadId`, store `clickup_task_id`, set `converted`. Repeat calls return the existing task. |
| `/api/clickup/test` | POST | session | Check the saved ClickUp token and list id. |
| `/api/settings` | GET, POST | session | GET shows which keys are set (last four characters only). POST saves or clears one supported key. Uses the service role. |
| `/api/icp-rules` | GET | session | Return the live ICP rules for the editor. |
| `/api/find-linkedin` | POST | session | Ask Perplexity for the LinkedIn profile of a company's founder or owner. No page calls it yet. |
| `/api/auth/signout` | POST | session | Sign out. |

## External services

| Service | Used for | Where | Key |
|---|---|---|---|
| Supabase | Postgres, Auth, row level security | everywhere | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Apify | Scrape a LinkedIn profile when the lead has no profile data. Default actor `apimaestro~linkedin-profile-detail`. | `src/lib/enrichment.ts` | `APIFY_TOKEN`, `APIFY_LINKEDIN_ACTOR` |
| Perplexity | Find a company website, research the person and the company, resolve a profile. Models `sonar` and `sonar-pro`. | `src/lib/enrichment.ts`, `/api/find-linkedin` | `PERPLEXITY_API_KEY` |
| TheirStack | Tech stack and hiring signals for the company domain | `src/lib/enrichment.ts` | `THEIRSTACK_API_KEY` |
| Company website | Fetched directly and reduced to text for research and prompts. No key. | `src/lib/enrichment.ts` | none |
| Anthropic (Claude) | Draft three outreach messages | `/api/generate` | `ANTHROPIC_API_KEY` |
| ClickUp | One task per converted lead | `src/lib/clickup.ts` | saved on Settings |

## Enrichment order

`enrichLead()` in `src/lib/enrichment.ts` runs these steps and records which providers it tried and which worked:

1. Seed data. Fields pushed by the extension or already on the row come first. If there is none, Apify scrapes the URL.
2. Company website scrape, then Perplexity research (it also finds the website if the company has none).
3. TheirStack lookup for the company domain.

The route then scores the result and stores it with `enrichment_completeness` set to `full` (every provider worked), `partial` (some did) or empty (none did).

## Caching

- `src/lib/config.ts` caches `app_config` reads for 30 seconds in memory.
- `src/lib/icp-rules.ts` caches the ICP rules for 60 seconds. Saving rules on Settings clears the cache.
