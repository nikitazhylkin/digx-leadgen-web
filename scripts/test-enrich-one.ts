// Direct invocation of enrichLead (bypasses auth cookies) — for local testing
// the new Perplexity prompts + TheirStack schema on one lead.
//   npx tsx scripts/test-enrich-one.ts "https://www.linkedin.com/in/example-demo-01"
import { enrichLead } from "../src/lib/enrichment";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.argv[2];
if (!url) { console.error("usage: test-enrich-one.ts <linkedin_url>"); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Pull existing seed data so we don't have to re-scrape
  const { data: existing } = await supabase.from("leads").select("*").eq("linkedin_url", url).single();
  if (!existing) { console.error("lead not in DB"); process.exit(1); }

  const seedData = {
    first_name: existing.first_name, last_name: existing.last_name,
    full_name: existing.full_name, headline: existing.headline,
    summary: existing.summary, location: existing.location,
    company_name: existing.company_name, company_name_casual: existing.company_name_casual,
    company_url: existing.company_url, company_linkedin_url: existing.company_linkedin_url,
    company_industry: existing.company_industry, company_headcount: existing.company_headcount,
    experiences: existing.experiences,
  };

  console.log(`\n=== Enriching ${existing.full_name} (${existing.company_name}) ===`);
  console.log(`Company URL: ${existing.company_url}`);
  console.log(`Headline: ${existing.headline}\n`);

  const t0 = Date.now();
  const exec = await enrichLead(url, { seedData });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`--- providers (${elapsed}s elapsed) ---`);
  console.log(`  tried:     ${exec.providersTried.join(", ")}`);
  console.log(`  succeeded: ${exec.providersSucceeded.join(", ")}`);
  console.log(`  errors:    ${JSON.stringify(exec.errors)}\n`);

  console.log("--- person_research ---");
  console.log(exec.data.person_research || "(empty)");
  console.log("\n--- company_research ---");
  console.log(exec.data.company_research || "(empty)");
  console.log("\n--- proof_points ---");
  console.log(JSON.stringify(exec.data.proof_points, null, 2));
  console.log("\n--- tech_stack ---");
  console.log(JSON.stringify(exec.data.tech_stack?.slice(0, 20), null, 2));
  console.log("\n--- hiring_signals ---");
  console.log(JSON.stringify(exec.data.hiring_signals, null, 2));

  // Persist to DB — matches /api/enrich logic so the UI reflects what we just tested
  const successCount = exec.providersSucceeded.length;
  const triedCount = exec.providersTried.length;
  const completeness = successCount === triedCount && successCount > 0 ? "full"
    : successCount > 0 ? "partial" : null;
  const errorSummary = Object.entries(exec.errors).length > 0
    ? Object.entries(exec.errors).map(([p, e]) => `${p}: ${String(e).slice(0, 60)}`).join(" | ")
    : null;
  const nextStatus = successCount > 0 ? "enriched" : "scored";

  // Strip outreach_status from data since we override it
  const { outreach_status: _, error: __, ...dataWithoutStatus } = exec.data;
  void _; void __;
  const { error: updErr } = await supabase.from("leads").update({
    ...dataWithoutStatus,
    outreach_status: nextStatus,
    enrichment_completeness: completeness,
    enrichment_error: errorSummary,
  }).eq("id", existing.id);
  if (updErr) console.error("DB update failed:", updErr.message);
  else console.log(`\n✓ Persisted to DB (status=${nextStatus}, completeness=${completeness})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
