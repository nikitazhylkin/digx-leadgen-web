# digx-leadgen-web

A lead pipeline web app. It takes LinkedIn lead data, scores each lead against editable ICP rules, enriches the ones you approve, drafts outreach messages with Claude, and pushes qualified leads to ClickUp as tasks.

This repo ships with fictional demo data only. Every person and company in `supabase/seed.sql` is made up.

## What it does

- **Pipeline table** (`/`): filter, sort and bulk-edit leads. Approve or reject each lead with a reason. Set a category per lead.
- **Lead drawer**: full profile, enrichment, score breakdown, message variants, notes.
- **Import** (`/import`): bring leads in from a LinkedIn profile URL list (through a Chrome extension bridge) or from a Google Sheet.
- **Scoring** (`src/lib/scoring.ts`): deterministic ICP score from role, segment, company size, location and category. Tiers: HOT, WARM, COLD, SKIP. Rules are editable on the Settings page.
- **Enrichment** (`src/lib/enrichment.ts`): optional company and person research through Perplexity, Apify and TheirStack.
- **Messages** (`/api/generate`): three outreach variants per lead from the Claude API.
- **ClickUp push** (`/api/clickup/push`): create a task for a qualified lead.
- **Analytics** (`/analytics`) and an audit log of who did what.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui with base-ui, Recharts, Supabase (Postgres, Auth, row-level security).

## Run it locally with the demo data

You need Node.js 20 or newer and a free Supabase project.

1. Install: `npm install`
2. In Supabase, run the files in `supabase/migrations/` in order (the SQL editor works).
3. Run `supabase/seed.sql` the same way. It adds 15 fictional leads.
4. Copy `env.example` to `.env.local` and fill in the three Supabase values. The other keys are optional.
5. In Supabase Auth, create a user with an email and password. There is no sign-up page, accounts are created by hand.
6. Score the demo leads: `npm install --no-save dotenv tsx` then `npx tsx scripts/rescore-all.ts`
7. Start: `npm run dev` and open http://localhost:3000. Sign in with the user from step 5.

Enrichment, message generation and ClickUp need their own API keys (Settings page or `.env.local`). The pipeline, scoring and review screens work without them.

## Notes

- `scripts/test-reject.mjs` is a small browser test of the reject flow. It uses placeholder credentials (`demo@example.com`); edit them to match your local user.
- The Chrome extension that feeds `/api/ingest-leads` lives in a separate project and is not needed for the demo.
