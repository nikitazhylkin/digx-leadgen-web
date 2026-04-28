import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getIcpRules, DEFAULT_ICP_RULES } from "@/lib/icp-rules";

// GET /api/icp-rules
//
// Returns the live ICP rules as JSON for the editor UI. Uses getIcpRules()
// internally so it sees the same merged-with-defaults shape that the scoring
// engine sees. Read-only — saves go through /api/settings POST { key:'icp_rules', value }.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    const rules = await getIcpRules();
    return NextResponse.json({ rules, defaults: DEFAULT_ICP_RULES });
  } catch (e) {
    return NextResponse.json(
      { rules: DEFAULT_ICP_RULES, defaults: DEFAULT_ICP_RULES, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
