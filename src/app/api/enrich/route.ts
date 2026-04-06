import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enrichLead } from "@/lib/enrichment";
import { scoreLead } from "@/lib/scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { linkedin_url, skip_research, skip_techstack } = body;

    if (!linkedin_url) {
      return NextResponse.json({ error: "linkedin_url is required" }, { status: 400 });
    }

    // Check if lead already exists
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("linkedin_url", linkedin_url)
      .single();

    // Enrich
    const enrichment = await enrichLead(linkedin_url, {
      skipResearch: skip_research,
      skipTechstack: skip_techstack,
    });

    if (enrichment.error) {
      return NextResponse.json({ error: enrichment.error }, { status: 422 });
    }

    // Auto-score
    const scoring = scoreLead(enrichment);

    const leadData = {
      linkedin_url,
      ...enrichment,
      icp_score: scoring.total,
      icp_tier: scoring.tier,
      scoring_breakdown: scoring,
      outreach_status: "scored",
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

    return NextResponse.json({ lead: result, scoring });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
