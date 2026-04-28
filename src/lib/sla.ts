import type { Lead } from "@/types/leads";
import type { SupabaseClient } from "@supabase/supabase-js";

export const STAGE_SLA = {
  reviewMs: 2 * 24 * 3600_000,
  requestSentMs: 14 * 24 * 3600_000,
  enrichedNoMsgMs: 1 * 24 * 3600_000,
  messagedNoReplyMs: 7 * 24 * 3600_000,
  repliedNoCrmMs: 1 * 3600_000,
} as const;

export type AgeLevel = "green" | "amber" | "red";

export interface LeadAge {
  stageLabel: string;
  ms: number;
  slaMs: number | null;
  level: AgeLevel;
  display: string;
}

const DAY_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;
const MIN_MS = 60_000;

function formatDuration(ms: number): string {
  if (ms < MIN_MS) return "just now";
  if (ms < HOUR_MS) return `${Math.floor(ms / MIN_MS)}m`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h`;
  return `${Math.floor(ms / DAY_MS)}d`;
}

function levelFromAge(ms: number, slaMs: number | null): AgeLevel {
  if (slaMs == null) return "green";
  if (ms >= slaMs) return "red";
  if (ms >= slaMs / 2) return "amber";
  return "green";
}

export function getLeadAge(lead: Lead, now: number = Date.now()): LeadAge {
  const status = lead.outreach_status;
  const replied = !!lead.replied_at;
  const sent = !!lead.sent_at;
  const hasMessages = !!(lead.message_variants && lead.message_variants.length);

  if (replied && !lead.clickup_task_id) {
    const ms = now - new Date(lead.replied_at!).getTime();
    return {
      stageLabel: "replied",
      ms,
      slaMs: STAGE_SLA.repliedNoCrmMs,
      level: levelFromAge(ms, STAGE_SLA.repliedNoCrmMs),
      display: `${formatDuration(ms)} since reply`,
    };
  }

  if (sent && !replied) {
    const ms = now - new Date(lead.sent_at!).getTime();
    return {
      stageLabel: "messaged",
      ms,
      slaMs: STAGE_SLA.messagedNoReplyMs,
      level: levelFromAge(ms, STAGE_SLA.messagedNoReplyMs),
      display: `${formatDuration(ms)} in messaged`,
    };
  }

  if (status === "enriched" && !hasMessages && lead.connection_accepted_at) {
    const ms = now - new Date(lead.connection_accepted_at).getTime();
    return {
      stageLabel: "enriched",
      ms,
      slaMs: STAGE_SLA.enrichedNoMsgMs,
      level: levelFromAge(ms, STAGE_SLA.enrichedNoMsgMs),
      display: `${formatDuration(ms)} in enriched`,
    };
  }

  if (status === "request_sent" && lead.request_sent_at) {
    const ms = now - new Date(lead.request_sent_at).getTime();
    return {
      stageLabel: "request_sent",
      ms,
      slaMs: STAGE_SLA.requestSentMs,
      level: levelFromAge(ms, STAGE_SLA.requestSentMs),
      display: `${formatDuration(ms)} in request_sent`,
    };
  }

  // Connected without enrichment outcome — flag if completeness null + error set
  if (status === "connected" && lead.enrichment_completeness == null && lead.enrichment_error) {
    return {
      stageLabel: "connected",
      ms: 0,
      slaMs: 0,
      level: "red",
      display: "enrichment failed",
    };
  }

  // Pre-outreach stages (scored / new / awaiting qualification) intentionally
  // have NO aging — review work is naturally batched and there's no urgency
  // until the user has actually committed to outreach (Approve = request_sent).
  return {
    stageLabel: status,
    ms: 0,
    slaMs: null,
    level: "green",
    display: "—",
  };
}

// ─── Chip presets ──────────────────────────────────────────────────────────────
// Each preset returns a function that mutates a Supabase filter builder with the
// chip's WHERE clause. Counts use the same builder via .select(*, count:exact).

export type ChipId = "today" | "needs_action" | "stuck" | "hot_ready" | "just_connected";

export interface ChipPreset {
  id: ChipId;
  label: string;
  /** Append the chip's WHERE clauses to a pre-built query. Returns the modified builder. */
  // The Supabase query builder has overlapping generic types depending on chained
  // ops. We use `any` here intentionally so callers can pass either a fresh
  // `from(...).select(...)` or a builder partway through filtering.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const CHIP_PRESETS: ChipPreset[] = [
  {
    id: "today",
    label: "Today",
    apply: (q) => q.gte("created_at", startOfTodayIso()),
  },
  {
    id: "needs_action",
    label: "Needs my action",
    apply: (q) =>
      q.or(
        [
          // Awaiting qualification
          "and(qualification.is.null,outreach_status.eq.scored)",
          // Enriched but no message drafted yet
          "and(outreach_status.eq.enriched,message_variants.is.null)",
          // Replied, not yet handed to ClickUp
          "and(replied_at.not.is.null,clickup_task_id.is.null)",
        ].join(","),
      ),
  },
  {
    id: "stuck",
    label: "Stuck",
    apply: (q) =>
      q.or(
        [
          // Request sent > 14d, no acceptance
          `and(outreach_status.eq.request_sent,request_sent_at.lt.${isoDaysAgo(14)})`,
          // Enriched, no message > 1d
          `and(outreach_status.eq.enriched,message_variants.is.null,connection_accepted_at.lt.${isoDaysAgo(1)})`,
          // Messaged, no reply > 7d
          `and(sent_at.not.is.null,replied_at.is.null,sent_at.lt.${isoDaysAgo(7)})`,
          // Replied > 1h, no ClickUp task
          `and(replied_at.not.is.null,clickup_task_id.is.null,replied_at.lt.${isoHoursAgo(1)})`,
          // Connected with enrichment error
          `and(outreach_status.eq.connected,enrichment_completeness.is.null,enrichment_error.not.is.null)`,
        ].join(","),
      ),
  },
  {
    id: "hot_ready",
    label: "HOT ready",
    apply: (q) =>
      q
        .eq("icp_tier", "HOT")
        .in("outreach_status", ["scored", "enriched"])
        .is("replied_at", null)
        // qualification IS NULL OR = 'approved'
        .or("qualification.is.null,qualification.eq.approved"),
  },
  {
    id: "just_connected",
    label: "Just connected",
    apply: (q) =>
      q
        .gte("connection_accepted_at", isoHoursAgo(24))
        .in("outreach_status", ["connected", "enriched"]),
  },
];

export function findChip(id: ChipId | null): ChipPreset | undefined {
  if (!id) return undefined;
  return CHIP_PRESETS.find((c) => c.id === id);
}

/** Build 5 parallel count queries; returns a map keyed by chip id. */
export async function loadChipCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<Record<ChipId, number>> {
  const results = await Promise.all(
    CHIP_PRESETS.map(async (chip) => {
      const base = supabase.from("leads").select("id", { count: "exact", head: true });
      const { count, error } = await chip.apply(base);
      if (error) {
        console.error(`Chip ${chip.id} count failed:`, error);
        return [chip.id, 0] as const;
      }
      return [chip.id, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(results) as Record<ChipId, number>;
}
