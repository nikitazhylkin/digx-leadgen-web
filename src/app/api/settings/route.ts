import { NextRequest, NextResponse } from "next/server";
import { clearConfigCache } from "@/lib/config";
import { clearIcpCache } from "@/lib/icp-rules";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase-admin";

// app_config stores live API keys (Anthropic, Perplexity, etc). After migration
// 007 this table is locked to service-role only — the authenticated user
// client cannot read or write it, so we use the admin client below. The user
// still has to be authenticated to reach this route.
const SUPPORTED_KEYS = new Set([
  "perplexity_api_key",
  "theirstack_api_key",
  "anthropic_api_key",
  // ClickUp integration (migration 012)
  "clickup_api_token",
  "clickup_team_id",
  "clickup_list_id",
  // ICP editor (migration 012) — JSON blob
  "icp_rules",
]);

/**
 * GET — returns a redacted view of configured keys.
 * Returns "set / not set" + last-4 characters only. Raw keys never leave the server.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data, error } = await admin.from("app_config").select("key, value, updated_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result: Record<string, { set: boolean; last4: string | null; updated_at: string | null }> = {};
  for (const row of data || []) {
    const v = row.value as string | null;
    result[row.key as string] = {
      set: Boolean(v && v.length > 0),
      last4: v && v.length >= 4 ? v.slice(-4) : null,
      updated_at: row.updated_at as string | null,
    };
  }
  const envPresent = {
    perplexity_api_key: Boolean(process.env.PERPLEXITY_API_KEY),
    theirstack_api_key: Boolean(process.env.THEIRSTACK_API_KEY),
    anthropic_api_key: Boolean(process.env.ANTHROPIC_API_KEY),
  };
  return NextResponse.json({ config: result, envPresent });
}

/**
 * POST — upserts a key. Body: { key: string, value: string | null }
 * Pass null to clear.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { key, value } = await req.json();
  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  if (!SUPPORTED_KEYS.has(key)) {
    return NextResponse.json({ error: `Unsupported key '${key}'` }, { status: 400 });
  }
  const cleaned = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_config")
    .upsert({ key, value: cleaned, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearConfigCache();
  if (key === "icp_rules") clearIcpCache();
  return NextResponse.json({ ok: true, key, set: Boolean(cleaned) });
}
