// One-shot rescore of every lead after the 2026-04-23 scoring change
// (unknown headcount 0→10, alcohol excludes). Run via:
//   npx tsx scripts/rescore-all.ts
import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "../src/lib/scoring";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, headline, company_industry, company_description, company_specialties, company_name, company_headcount, location, category, experiences");
  if (error) throw error;
  if (!leads) throw new Error("no leads");

  console.log(`Rescoring ${leads.length} leads...`);

  const tierCount: Record<string, number> = { HOT: 0, WARM: 0, COLD: 0, SKIP: 0 };
  let done = 0;
  const BATCH = 25;

  for (let i = 0; i < leads.length; i += BATCH) {
    const slice = leads.slice(i, i + BATCH);
    await Promise.all(slice.map(async (l) => {
      const s = scoreLead(l);
      tierCount[s.tier]++;
      const { error } = await supabase
        .from("leads")
        .update({ icp_score: s.total, icp_tier: s.tier, scoring_breakdown: s })
        .eq("id", l.id);
      if (error) console.error(`  ${l.id}: ${error.message}`);
    }));
    done += slice.length;
    process.stdout.write(`\r  ${done}/${leads.length}`);
  }
  console.log();
  console.log("Tier distribution after rescore:", tierCount);
}

main().catch((err) => { console.error(err); process.exit(1); });
