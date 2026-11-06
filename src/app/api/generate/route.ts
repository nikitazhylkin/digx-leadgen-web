import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { requireUser } from "@/lib/auth";

const SARAEV_SYSTEM_PROMPT = `You are writing a LinkedIn connection request / DM from the CEO of DigX Agency. DigX helps both SERVICE businesses (agencies, consulting, legal) and PRODUCT businesses (food/beverage distributors, DTC brands, wholesale) automate operations and eliminate profit leaks across their demand-to-cash flow.

HARD RULES:
1. TEXT MESSAGE TEST: Would you send this as a text to a colleague? If formal — rewrite.
2. LENGTH: 50-100 words. Under 150 absolute max.
3. TONE: Lowercase, casual, sentence fragments OK. Imperfection is a feature.
4. COMPANY NAME: Always casualized (no Inc/GmbH/Ltd).
5. CTA: One micro-commitment question. Never "book a call."
6. PERSONALIZATION: Cold reading based on role + industry + enrichment data. Cite ONE specific signal per message.
7. OFFER: Lead with specific ROI. Numbers beat adjectives.
8. SPECIFICITY: If the enrichment shows a named customer / tech tool / hiring posting, REFERENCE IT. Do not write generic copy when specific signals are present.

SCORE AGAINST 7 PRINCIPLES (aim for 4+):
1. Reciprocity — give value first
2. Micro-commitment — small next step
3. Social proof — real results/companies
4. Authority — specificity, not claims
5. Rapport — genuine common ground
6. Scarcity — only if real
7. Shared identity — same tribe/tools

NEVER USE: "I hope this finds you well", "I noticed your profile", "As a leading provider", perfect grammar throughout, selling in opening line, multiple CTAs.

Generate exactly 3 message variants as JSON array:
[
  {"angle": "cold_reading", "message": "...", "principles_score": N, "principles_hit": ["reciprocity", "rapport"], "signal_cited": "what specific enrichment signal you leaned on"},
  {"angle": "observation", "message": "...", "principles_score": N, "principles_hit": [...], "signal_cited": "..."},
  {"angle": "value_first", "message": "...", "principles_score": N, "principles_hit": [...], "signal_cited": "..."}
]

If the enrichment context is thin (generic industry only, no specific signals), set signal_cited to "none — generic cold read". Do NOT invent signals.

Return ONLY the JSON array, no markdown, no explanation.`;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  try {
    const { lead_id } = await req.json();
    const apiKey = await getConfig("anthropic_api_key", "ANTHROPIC_API_KEY");

    if (!lead_id) return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key not set — add it at /settings" }, { status: 500 });

    // Fetch lead with all enrichment data
    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (fetchError || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    // Build context from enrichment data. Prioritize structured signals over raw text.
    const proofPointsStr = Array.isArray(lead.proof_points) && lead.proof_points.length > 0
      ? lead.proof_points.slice(0, 6).map((p: Record<string, string>) => `${p.type}: ${p.name}`).join("; ")
      : "";

    // Hiring signals: support both legacy array + new {jobs, velocity_30d} shape
    let hiringStr = "";
    if (Array.isArray(lead.hiring_signals)) {
      hiringStr = JSON.stringify(lead.hiring_signals).substring(0, 600);
    } else if (lead.hiring_signals && typeof lead.hiring_signals === "object") {
      const hs = lead.hiring_signals as { jobs?: Record<string, unknown>[]; velocity_30d?: number };
      const topJobs = (hs.jobs || []).slice(0, 5);
      hiringStr = `velocity_30d=${hs.velocity_30d ?? topJobs.length}, recent=${JSON.stringify(topJobs).substring(0, 500)}`;
    }

    // Tech stack: flatten to name list
    const techStr = Array.isArray(lead.tech_stack) && lead.tech_stack.length > 0
      ? (lead.tech_stack as Record<string, string>[]).slice(0, 20).map((t) => t.name || String(t)).join(", ")
      : "";

    const leadContext = [
      `Name: ${lead.full_name}`,
      `Title: ${lead.headline}`,
      `Company: ${lead.company_name_casual || lead.company_name}`,
      `Industry: ${lead.company_industry || "Unknown"}`,
      `Headcount: ${lead.company_headcount || "Unknown"}`,
      `Location: ${lead.location}`,
      lead.category ? `ICP category: ${lead.category}` : "",
      lead.icp_tier ? `ICP tier: ${lead.icp_tier} (score ${lead.icp_score}/100)` : "",
      lead.summary ? `LinkedIn About: ${lead.summary.substring(0, 500)}` : "",
      lead.company_description ? `Company Description: ${lead.company_description.substring(0, 500)}` : "",
      lead.person_research ? `Person Research (structured):\n${lead.person_research.substring(0, 1500)}` : "",
      lead.company_research ? `Company Research (structured):\n${lead.company_research.substring(0, 1500)}` : "",
      proofPointsStr ? `Proof Points (specific named customers / partners / case studies): ${proofPointsStr}` : "",
      techStr ? `Tech Stack: ${techStr}` : "",
      hiringStr ? `Hiring Signals: ${hiringStr}` : "",
      lead.company_website_text ? `Website Content (multi-page scrape):\n${lead.company_website_text.substring(0, 3000)}` : (lead.company_homepage_text ? `Homepage:\n${lead.company_homepage_text.substring(0, 1200)}` : ""),
    ].filter(Boolean).join("\n\n");

    // Call Claude
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        temperature: 0.85,
        system: SARAEV_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Generate 3 outreach messages for this lead:\n\n${leadContext}` }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text();
      return NextResponse.json({ error: `Claude API error: ${err.substring(0, 200)}` }, { status: 500 });
    }

    const claudeData = await claudeResp.json();
    const content = claudeData.content?.[0]?.text || "";

    // Parse JSON from response
    let variants;
    try {
      // Extract JSON array from response (handle potential markdown wrapping)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      variants = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "Failed to parse message variants from Claude", raw: content }, { status: 500 });
    }

    // Save to database
    const { data, error } = await supabase
      .from("leads")
      .update({
        message_variants: variants,
        outreach_status: "message_ready",
      })
      .eq("id", lead_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ lead: data, variants });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
