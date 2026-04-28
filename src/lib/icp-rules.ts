// ICP Rules — runtime-configurable bits of the scoring engine.
//
// Strategy: the *built-in* hard-exclude list, role keywords, and segment
// profiles in scoring.ts are months of Kira's calibration. Replacing them
// wholesale via the UI would be too easy to break, so this v1 editor exposes
// only the safe-to-tune bits:
//
//   1. Tier thresholds (HOT / WARM / COLD minimum scores)
//   2. ADDITIONAL hard-exclude keyword groups (with a reason label)
//
// Future expansion (deferred):
//   - Role keyword overrides (full editor)
//   - Segment profile editor
//   - Per-tier weight rebalancing
//
// Storage: app_config.icp_rules holds a JSON blob. NULL value means
// "use defaults" — we don't pre-fill the row with the defaults, so the
// scoring lib's hardcoded fallbacks remain the source of truth until the
// user actively overrides via the UI.

import { createAdminClient } from "@/lib/supabase-admin";

export interface AdditionalExclude {
  keywords: string[];
  reason: string;
}

export interface IcpRules {
  tiers: {
    hot: number;
    warm: number;
    cold: number;
  };
  additionalExcludes: AdditionalExclude[];
}

// Defaults mirror the hardcoded thresholds in scoring.ts (getTier).
// Keep these in sync whenever scoring.ts's tier cutoffs change.
export const DEFAULT_ICP_RULES: IcpRules = {
  tiers: { hot: 70, warm: 50, cold: 30 },
  additionalExcludes: [],
};

// One-minute in-process cache. The admin client cost is small but every
// scoreLead() call would otherwise hit Supabase — wasteful when ingesting
// 200+ leads from the extension in a burst.
let _cache: { rules: IcpRules; expiresAt: number } | null = null;
const CACHE_MS = 60_000;

export async function getIcpRules(): Promise<IcpRules> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.rules;
  let rules: IcpRules = DEFAULT_ICP_RULES;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "icp_rules")
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value as string);
      // Shallow merge — partial overrides allowed
      rules = {
        tiers: { ...DEFAULT_ICP_RULES.tiers, ...(parsed.tiers ?? {}) },
        additionalExcludes: Array.isArray(parsed.additionalExcludes)
          ? parsed.additionalExcludes.filter(
              (e: unknown): e is AdditionalExclude =>
                typeof e === "object" && e !== null &&
                Array.isArray((e as AdditionalExclude).keywords) &&
                typeof (e as AdditionalExclude).reason === "string",
            )
          : [],
      };
    }
  } catch {
    // Fall through to defaults — never block scoring on a config read.
  }
  _cache = { rules, expiresAt: Date.now() + CACHE_MS };
  return rules;
}

/** Wipe the in-process cache. Call after a /settings POST that wrote icp_rules. */
export function clearIcpCache() {
  _cache = null;
}
