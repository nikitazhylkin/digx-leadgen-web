import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/enrichment";
import { scoreLead } from "@/lib/scoring";
import { getIcpRules } from "@/lib/icp-rules";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  try {
    const body = await req.json();
    const { linkedin_url, skip_research, skip_techstack, seed_data } = body;

    if (!linkedin_url) {
      return NextResponse.json({ error: "linkedin_url is required" }, { status: 400 });
    }

    // Look up existing lead — extension push may have already populated this row.
    const { data: existing } = await supabase
      .from("leads")
      .select("*")
      .eq("linkedin_url", linkedin_url)
      .single();

    // Build seed data, in priority order:
    //   1. seed_data from request body — fresh extension-bridge scrape from /import
    //   2. Existing row — prior extension push
    let seedData: Record<string, unknown> | undefined =
      seed_data && typeof seed_data === "object"
        ? { ...(seed_data as Record<string, unknown>) }
        : existing
          ? {
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
            }
          : undefined;

    // If both sources exist, merge: fresh seed wins on each field that's truthy,
    // existing fills any gaps the fresh scrape missed (rare).
    if (seed_data && existing) {
      const merged = { ...seedData };
      const existingFields: Record<string, unknown> = {
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
      for (const [k, v] of Object.entries(existingFields)) {
        if (!merged[k] && v) merged[k] = v;
      }
      seedData = merged;
    }

    // Enrich (falls back to seedData if Proxycurl key missing).
    // New return shape: { data, providersTried, providersSucceeded, errors }
    const exec = await enrichLead(linkedin_url, {
      skipResearch: skip_research,
      skipTechstack: skip_techstack,
      seedData,
    });
    const enrichment = exec.data;

    if (enrichment.error && exec.providersSucceeded.length === 0 && !existing) {
      // Nothing to work with AND no existing lead to update — bail out.
      return NextResponse.json({ error: enrichment.error }, { status: 422 });
    }

    // Translate per-provider outcomes into the two new honest columns.
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
    // If every provider failed, stay at 'scored' — don't falsely mark as enriched.
    const nextStatus = successCount > 0 ? "enriched" : "scored";

    // Auto-score — pass category from existing lead so category-alignment works,
    // and honour live ICP rules from /settings.
    const rules = await getIcpRules();
    const scoring = scoreLead({ ...enrichment, category: existing?.category ?? null }, rules);

    const leadData = {
      linkedin_url,
      ...enrichment,
      icp_score: scoring.total,
      icp_tier: scoring.tier,
      scoring_breakdown: scoring,
      outreach_status: nextStatus,
      enrichment_completeness: completeness,
      enrichment_error: errorSummary,
      source: "manual",
    };

    let result;
    if (existing?.id) {
      // Update existing lead
      const { data, error } = await supabase
        .from("leads")
        .update(leadData)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      result = data;
    } else {
      // Insert new lead
      const { data, error } = await supabase
        .from("leads")
        .insert(leadData)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      result = data;
    }

    return NextResponse.json({
      lead: result,
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
