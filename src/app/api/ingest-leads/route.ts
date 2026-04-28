import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { scoreLead } from "@/lib/scoring";
import { getIcpRules } from "@/lib/icp-rules";

// Extension push endpoint. The extension authenticates by presenting the Supabase
// anon key (which it already stores). This endpoint validates the key then upserts
// via the service-role admin client — bypassing the RLS that (correctly) blocks
// anon from writing to leads.
//
// Why not RLS policy: we tried `CREATE POLICY ... FOR INSERT TO anon` and Supabase's
// PostgREST still rejected it with "new row violates row-level security policy"
// even though the policy was correctly registered. Rather than chase that bug, we
// proxy the write server-side where we have full control.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Auth: extension presents the anon key. We only accept it if it matches the one
  // in our env — so random callers who somehow learn the endpoint URL can't post.
  // .trim() defends against stray \n in env values and accidental whitespace in headers
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const header = (req.headers.get("apikey") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!anonKey || header !== anonKey) {
    return NextResponse.json({ error: "Invalid apikey" }, { status: 401, headers: CORS_HEADERS });
  }

  let body: { row?: Record<string, unknown>; rows?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  // Accept either { row: {...} } (extension's per-lead push) or { rows: [...] } (batch).
  const rows = body.rows ?? (body.row ? [body.row] : null);
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Body must have `row` or non-empty `rows`" }, { status: 400, headers: CORS_HEADERS });
  }

  const admin = createAdminClient();
  // Upsert and return the fields scoreLead needs, so we can score without a second fetch
  const { data: upserted, error } = await admin
    .from("leads")
    .upsert(rows, { onConflict: "linkedin_url" })
    .select(
      "id, headline, company_industry, company_description, company_specialties, " +
      "company_name, company_headcount, location, category, experiences"
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }

  // Auto-score on ingest. scoreLead is pure deterministic JS (no external APIs,
  // no token cost), so running it for every upserted lead is cheap.
  // Status bumps to 'scored' so the pipeline widget shows 1/6 (not lingering at 'new').
  // The admin client isn't typed with our schema, so cast the returned rows.
  type Upserted = {
    id: string;
    headline?: string;
    company_industry?: string;
    company_description?: string;
    company_specialties?: string;
    company_name?: string | null;
    company_headcount?: number | null;
    location?: string;
    category?: string | null;
    experiences?: unknown;
  };
  const rowsToScore = (upserted ?? []) as unknown as Upserted[];
  // Load ICP rules ONCE outside the loop — getIcpRules has its own 60s cache,
  // but skipping repeated calls keeps the bulk-ingest path tight.
  const rules = await getIcpRules();
  let scored = 0;
  for (const row of rowsToScore) {
    try {
      const s = scoreLead(row, rules);
      const { error: updErr } = await admin.from("leads").update({
        icp_score: s.total,
        icp_tier: s.tier,
        scoring_breakdown: s,
        outreach_status: "scored",
      }).eq("id", row.id);
      if (!updErr) scored++;
    } catch (e) {
      // Scoring is deterministic — a throw here means a code bug, not a runtime failure.
      // Leave the lead in whatever state the upsert put it and keep going.
      console.error("auto-score failed for", row.id, e);
    }
  }

  return NextResponse.json(
    { ok: true, inserted: upserted?.length ?? 0, scored },
    { status: 200, headers: CORS_HEADERS },
  );
}
