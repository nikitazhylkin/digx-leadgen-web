import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const SARAEV_SYSTEM_PROMPT = `You are writing a LinkedIn connection request / DM from Kira Gusak, CEO of DigX Agency. DigX helps service businesses automate operations with AI — workflows, agents, and tools.

HARD RULES:
1. TEXT MESSAGE TEST: Would you send this as a text to a colleague? If formal — rewrite.
2. LENGTH: 50-100 words. Under 150 absolute max.
3. TONE: Lowercase, casual, sentence fragments OK. Imperfection is a feature.
4. COMPANY NAME: Always casualized (no Inc/GmbH/Ltd).
5. CTA: One micro-commitment question. Never "book a call."
6. PERSONALIZATION: Cold reading based on role + industry + enrichment data.
7. OFFER: Lead with specific ROI. Numbers beat adjectives.

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
  {"angle": "cold_reading", "message": "...", "principles_score": N, "principles_hit": ["reciprocity", "rapport", ...]},
  {"angle": "observation", "message": "...", "principles_score": N, "principles_hit": [...]},
  {"angle": "value_first", "message": "...", "principles_score": N, "principles_hit": [...]}
]

Return ONLY the JSON array, no markdown, no explanation.`;

export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!lead_id) return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    // Fetch lead with all enrichment data
    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (fetchError || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    // Build context from enrichment data
    const leadContext = [
      `Name: ${lead.full_name}`,
      `Title: ${lead.headline}`,
      `Company: ${lead.company_name_casual || lead.company_name}`,
      `Industry: ${lead.company_industry || "Unknown"}`,
      `Headcount: ${lead.company_headcount || "Unknown"}`,
      `Location: ${lead.location}`,
      lead.summary ? `LinkedIn About: ${lead.summary.substring(0, 500)}` : "",
      lead.company_description ? `Company Description: ${lead.company_description.substring(0, 500)}` : "",
      lead.person_research ? `Person Research: ${lead.person_research.substring(0, 800)}` : "",
      lead.company_research ? `Company Research: ${lead.company_research.substring(0, 800)}` : "",
      lead.tech_stack ? `Tech Stack: ${JSON.stringify(lead.tech_stack).substring(0, 300)}` : "",
      lead.hiring_signals ? `Hiring: ${JSON.stringify(lead.hiring_signals).substring(0, 300)}` : "",
      lead.company_homepage_text ? `Homepage: ${lead.company_homepage_text.substring(0, 500)}` : "",
    ].filter(Boolean).join("\n");

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
