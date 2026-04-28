import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { createTask } from "@/lib/clickup";

// POST /api/clickup/push  { leadId: string }
//
// Reads the lead row + ClickUp config, creates a task in the configured list
// with full lead context (name, company, LinkedIn, ICP, message used), then
// stamps the lead with clickup_task_id and bumps outreach_status='converted'
// (lead has exited the dashboard — managed in ClickUp from here on).
//
// Idempotency: if the lead already has a clickup_task_id we short-circuit and
// return the existing task — clicking the button twice doesn't duplicate.

const LEAD_FIELDS = [
  "id",
  "full_name",
  "company_name",
  "company_name_casual",
  "headline",
  "linkedin_url",
  "icp_score",
  "icp_tier",
  "selected_message",
  "message_variants",
  "replied_at",
  "category",
  "source",
  "clickup_task_id",
  "outreach_status",
].join(", ");

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { leadId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const leadId = body.leadId;
  if (!leadId || typeof leadId !== "string") {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: cfgRows }, { data: lead, error: leadErr }] = await Promise.all([
    admin.from("app_config").select("key, value").in("key", ["clickup_api_token", "clickup_list_id"]),
    admin.from("leads").select(LEAD_FIELDS).eq("id", leadId).single(),
  ]);
  if (leadErr || !lead) {
    return NextResponse.json({ error: leadErr?.message || "Lead not found" }, { status: 404 });
  }
  // Cast: the admin client isn't typed against our schema at this call site.
  const l = lead as unknown as {
    id: string;
    full_name: string;
    company_name: string | null;
    company_name_casual: string | null;
    headline: string | null;
    linkedin_url: string | null;
    icp_score: number | null;
    icp_tier: string | null;
    selected_message: string | null;
    message_variants: Array<{ angle: string; message: string }> | null;
    replied_at: string | null;
    category: string | null;
    source: string | null;
    clickup_task_id: string | null;
  };

  if (l.clickup_task_id) {
    return NextResponse.json({ ok: true, taskId: l.clickup_task_id, alreadyPushed: true });
  }

  const cfg = Object.fromEntries((cfgRows || []).map((r) => [r.key as string, r.value as string | null]));
  const token = cfg.clickup_api_token;
  const listId = cfg.clickup_list_id;
  if (!token || !listId) {
    return NextResponse.json(
      { error: "ClickUp not configured. Open /settings → ClickUp." },
      { status: 400 },
    );
  }

  const company = l.company_name_casual || l.company_name || "—";
  const messageUsed =
    l.selected_message ||
    (Array.isArray(l.message_variants) && l.message_variants.length
      ? l.message_variants[0].message
      : "(no message recorded)");

  const description = [
    `**${l.full_name}** at **${company}**`,
    l.headline ? `_${l.headline}_` : "",
    "",
    l.linkedin_url ? `🔗 [LinkedIn](${l.linkedin_url})` : "",
    `📊 ICP: **${l.icp_tier ?? "—"}** · Score ${l.icp_score ?? "—"}`,
    l.category ? `🏷  ${l.category}` : "",
    l.source ? `📥 Source: ${l.source}` : "",
    "",
    "**Message used:**",
    "",
    messageUsed,
    "",
    `**Replied at:** ${l.replied_at ?? "—"}`,
    "",
    "_Pushed from DigX Leads dashboard._",
  ]
    .filter(Boolean)
    .join("\n");

  const tags = [l.icp_tier?.toLowerCase()].filter(Boolean) as string[];

  let task;
  try {
    task = await createTask(token, listId, {
      name: `${l.full_name} — ${company}`,
      description,
      tags,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const { error: updErr } = await admin
    .from("leads")
    .update({
      clickup_task_id: task.id,
      outreach_status: "converted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (updErr) {
    // Task is already created in ClickUp at this point — surface the DB error
    // but include the task URL so the user can manually reconcile if needed.
    return NextResponse.json(
      {
        ok: false,
        error: `Task created in ClickUp (${task.url}) but lead update failed: ${updErr.message}`,
        taskId: task.id,
        taskUrl: task.url,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, taskId: task.id, taskUrl: task.url });
}
