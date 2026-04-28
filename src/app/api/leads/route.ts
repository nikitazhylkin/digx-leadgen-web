import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// POST /api/leads
// URL-only lead creation for the /import paste flow. Inserts a row with
// just the linkedin_url (and optionally a category for ICP grouping).
// No scoring, no enrichment — those run later when the human approves the
// lead via /api/qualify.
//
// Idempotent: if a row with the same linkedin_url already exists, returns
// it unchanged rather than creating a duplicate.
//
// Body: { linkedin_url: string, category?: string } | { linkedin_urls: string[], category?: string }
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  try {
    const body = await req.json();
    const single = typeof body.linkedin_url === "string" ? body.linkedin_url.trim() : null;
    const bulk = Array.isArray(body.linkedin_urls)
      ? (body.linkedin_urls as unknown[]).map((u) => String(u).trim()).filter(Boolean)
      : null;
    const category = typeof body.category === "string" ? body.category : null;

    const urls = single ? [single] : bulk;
    if (!urls || urls.length === 0) {
      return NextResponse.json({ error: "linkedin_url or linkedin_urls is required" }, { status: 400 });
    }

    const valid = urls.filter((u) => /linkedin\.com\/(in|sales)\//i.test(u));
    if (valid.length === 0) {
      return NextResponse.json({ error: "no valid LinkedIn URLs in input" }, { status: 400 });
    }

    // Check which URLs already exist — keep them as-is, only insert new ones.
    const { data: existing } = await supabase
      .from("leads")
      .select("id, linkedin_url, qualification, outreach_status")
      .in("linkedin_url", valid);
    const existingUrls = new Set((existing || []).map((r) => r.linkedin_url));
    const newUrls = valid.filter((u) => !existingUrls.has(u));

    let inserted: Record<string, unknown>[] = [];
    if (newUrls.length > 0) {
      const rows = newUrls.map((url) => ({
        linkedin_url: url,
        outreach_status: "new",
        qualification: null,
        category,
        source: "manual",
      }));
      const { data, error } = await supabase
        .from("leads")
        .insert(rows)
        .select();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted = data || [];
    }

    return NextResponse.json({
      created: inserted.length,
      skipped: valid.length - newUrls.length,
      total: valid.length,
      leads: [...(existing || []), ...inserted],
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
