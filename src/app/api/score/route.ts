import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json();

    if (!lead_id) {
      return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
    }

    // Fetch lead
    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (fetchError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Score
    const scoring = scoreLead(lead);

    // Update
    const { data, error } = await supabase
      .from("leads")
      .update({
        icp_score: scoring.total,
        icp_tier: scoring.tier,
        scoring_breakdown: scoring,
        outreach_status: lead.outreach_status === "new" || lead.outreach_status === "enriched"
          ? "scored"
          : lead.outreach_status,
      })
      .eq("id", lead_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ lead: data, scoring });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
