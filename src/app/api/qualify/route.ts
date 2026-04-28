import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/enrichment";
import { scoreLead } from "@/lib/scoring";
import { getIcpRules } from "@/lib/icp-rules";
import { requireUser } from "@/lib/auth";

// POST /api/qualify
// Body: { lead_id, qualification: 'approved' | 'rejected' | null, rejection_reason? }
//
// On approve: writes qualification + outreach_status='request_sent', then
// fires the full enrichment pipeline (Apify + Perplexity + TheirStack +
// scoring) and stores the result on the same row.
// On reject / unqualify: just writes the qualification fields, no enrichment.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  try {
    const body = await req.json();
    const { lead_id, qualification, rejection_reason } = body as {
      lead_id?: string;
      qualification?: "approved" | "rejected" | null;
      rejection_reason?: string | null;
    };

    if (!lead_id) {
      return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
    }
    if (qualification !== "approved" && qualification !== "rejected" && qualification !== null) {
      return NextResponse.json({ error: "qualification must be approved, rejected, or null" }, { status: 400 });
    }

    // Step 1 — read the existing lead so we can preserve seed identity fields
    // and detect whether enrichment already ran.
    const { data: existing, error: readErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();
    if (readErr || !existing) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }

    // Step 2 — write the qualification patch.
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      qualification,
      qualified_at: qualification ? now : null,
      qualified_by: qualification ? (user.email ?? null) : null,
      rejection_reason: qualification === "rejected" ? (rejection_reason || null) : null,
    };
    if (qualification === "approved") {
      patch.outreach_status = "request_sent";
      // Only stamp request_sent_at the first time it's approved — subsequent
      // re-approves (toggling back from review) keep the original timestamp.
      if (!existing.request_sent_at) patch.request_sent_at = now;
    }

    const { data: qualified, error: writeErr } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead_id)
      .select()
      .single();
    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 500 });
    }

    // Step 3 — if not approved, we're done.
    if (qualification !== "approved") {
      return NextResponse.json({ lead: qualified });
    }

    // Step 4 — if approved AND enrichment hasn't already run, fire the
    // full pipeline. Detect "already enriched" by icp_score being non-null.
    if (existing.icp_score !== null && existing.icp_score !== undefined) {
      return NextResponse.json({ lead: qualified });
    }

    // Build seed data from whatever the row already has (extension push,
    // earlier scrape attempt, etc) so we don't lose any existing fields.
    const seedData = {
      first_name: existing.first_name,
      last_name: existing.last_name,
      full_name: existing.full_name,
      headline: existing.headline,
      summary: existing.summary,
      location: existing.location,
      company_name: existing.company_name,
      company_name_casual: existing.company_name_casual,
      company_url: existing.company_url,
      company_linkedin_url: existing.company_linkedin_url,
      company_industry: existing.company_industry,
      company_headcount: existing.company_headcount,
      experiences: existing.experiences,
    };

    const exec = await enrichLead(existing.linkedin_url, { seedData });
    const enrichment = exec.data;

    // Status: if Apify failed or no providers succeeded for the heavy data,
    // keep request_sent (already approved) but set enrichment_error so the
    // UI can show a Retry button.
    const successCount = exec.providersSucceeded.length;
    const triedCount = exec.providersTried.length;
    const completeness: "full" | "partial" | null =
      successCount === triedCount && successCount > 0 ? "full" :
      successCount > 0 ? "partial" : null;
    const errorSummary = Object.entries(exec.errors).length > 0
      ? Object.entries(exec.errors)
          .map(([p, e]) => `${p}: ${String(e).slice(0, 60)}`)
          .join(" | ")
      : null;

    const rules = await getIcpRules();
    const scoring = scoreLead({ ...enrichment, category: existing.category ?? null }, rules);

    // Don't roll back outreach_status from request_sent on enrichment failure.
    // The user already approved — keep the qualification, just flag the enrichment.
    const enrichPatch: Record<string, unknown> = {
      ...enrichment,
      icp_score: scoring.total,
      icp_tier: scoring.tier,
      scoring_breakdown: scoring,
      enrichment_completeness: completeness,
      enrichment_error: errorSummary,
    };
    // Don't overwrite outreach_status — stay at request_sent.
    delete enrichPatch.outreach_status;
    delete enrichPatch.error;

    const { data: enriched, error: enrichWriteErr } = await supabase
      .from("leads")
      .update(enrichPatch)
      .eq("id", lead_id)
      .select()
      .single();
    if (enrichWriteErr) {
      return NextResponse.json({ error: enrichWriteErr.message }, { status: 500 });
    }

    return NextResponse.json({
      lead: enriched,
      scoring,
      providers: {
        tried: exec.providersTried,
        succeeded: exec.providersSucceeded,
        errors: exec.errors,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
