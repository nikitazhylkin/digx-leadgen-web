import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

/**
 * Find LinkedIn profile for a company lead using Perplexity.
 * Searches for CEO/Founder/Owner at the company and returns
 * their LinkedIn URL + name + title with a confidence score.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  try {
    const { lead_id, company_name, company_description } = await req.json();
    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (!company_name) return NextResponse.json({ error: "company_name required" }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: "PERPLEXITY_API_KEY not set" }, { status: 500 });

    // Search Perplexity for the company's leadership on LinkedIn
    const query = `Find the LinkedIn profile URL of the CEO, founder, or owner of "${company_name}". ${
      company_description ? `Company description: ${company_description.substring(0, 300)}` : ""
    } Return ONLY: 1) their full name, 2) their exact title, 3) their LinkedIn profile URL (linkedin.com/in/...). If you can't find an exact match, say "NOT FOUND".`;

    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `Perplexity error ${resp.status}` }, { status: 500 });
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || "";

    // Parse LinkedIn URL from response
    const linkedinMatch = answer.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
    const linkedinUrl = linkedinMatch ? `https://www.linkedin.com/in/${linkedinMatch[1]}` : null;

    // Parse name — look for patterns like "Name: John Doe" or "**John Doe**"
    let personName = null;
    const namePatterns = [
      /(?:name|full name)[:\s]*([A-Z][a-zA-Zàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ\s-]+?)(?:\n|,|\.|$)/i,
      /\*\*([A-Z][a-zA-Zàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ\s-]+?)\*\*/,
      /(?:^|\n)\d?\.\s*([A-Z][a-zA-Zàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ\s-]+?)(?:\n|,|\s*[-–—]\s)/m,
    ];
    for (const pattern of namePatterns) {
      const match = answer.match(pattern);
      if (match && match[1].trim().split(/\s+/).length <= 4) {
        personName = match[1].trim();
        break;
      }
    }

    // Parse title
    let personTitle = null;
    const titlePatterns = [
      /(?:title|role|position)[:\s]*([^\n,]+)/i,
      /(?:CEO|Founder|Co-founder|Owner|Managing Director|Director|COO)[^\n]*/i,
    ];
    for (const pattern of titlePatterns) {
      const match = answer.match(pattern);
      if (match) {
        personTitle = match[0].replace(/^(?:title|role|position)[:\s]*/i, "").trim();
        break;
      }
    }

    const found = !!linkedinUrl;
    const confidence = found && personName ? "high" : found ? "medium" : "none";

    const result = {
      found,
      confidence,
      linkedin_url: linkedinUrl,
      person_name: personName,
      person_title: personTitle,
      raw_response: answer.substring(0, 500),
    };

    // If found and lead_id provided, update the lead
    if (found && lead_id) {
      const nameParts = personName?.split(/\s+/) || [];
      const updateData: Record<string, unknown> = {
        linkedin_url: linkedinUrl,
        full_name: personName,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(" ") || null,
        headline: personTitle,
        outreach_status: "enriched",
      };

      await supabase
        .from("leads")
        .update(updateData)
        .eq("id", lead_id);
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
