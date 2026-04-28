import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { testConnection } from "@/lib/clickup";

// POST /api/clickup/test
//
// Reads the saved clickup_api_token + clickup_list_id from app_config and
// hits the ClickUp API to confirm the credentials work + the list is real.
// Used by the "Test connection" button in /settings.
//
// Returns either:
//   { ok: true, list: { id, name, space?: { id, name }, folder? } }
//   { ok: false, error: "<human-readable>" }
export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", ["clickup_api_token", "clickup_list_id"]);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const cfg = Object.fromEntries((data || []).map((r) => [r.key as string, r.value as string | null]));
  const token = cfg.clickup_api_token;
  const listId = cfg.clickup_list_id;
  if (!token || !listId) {
    return NextResponse.json(
      { ok: false, error: "Save the ClickUp token + list ID before testing." },
      { status: 400 },
    );
  }
  const result = await testConnection(token, listId);
  return NextResponse.json(result);
}
