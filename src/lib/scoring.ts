/**
 * ICP Scoring — deterministic, handles BOTH Service and Product ICPs.
 *
 * DigX has two ICP tracks:
 *  - Service: Consulting, Agency, Legal/Fiduciary (original ICP)
 *  - Product: Wholesale, Food & Beverage, DTC/E-commerce, Consumer Goods (FIZI-style)
 *
 * The scorer tries every segment profile and takes the MAX — so a food distributor
 * and a consultant can both score 25 on segment. A category-alignment bonus rewards
 * leads that were tagged (e.g. "DigX Wholesale") and match their tag's segment family.
 *
 * Works on extension-scraped data alone (headline, company_industry, company_size,
 * location) — doesn't punish leads that haven't been fully enriched yet.
 */

export interface ScoringBreakdown {
  role: number;
  segment: number;
  segment_family: string | null;
  segment_bonus: number;
  company_size: number;
  location: number;
  category_alignment: number;
  total: number;
  tier: "HOT" | "WARM" | "COLD" | "SKIP";
  excluded_reason?: string;
}

// ── Role (0-25) ─────────────────────────────────────────────────────
const ROLE_SCORES: [string[], number][] = [
  [["founder", "co-founder", "cofounder", "owner", "co-owner", "ceo", "chief executive", "managing partner"], 25],
  [["coo", "chief operating", "head of operations", "vp operations", "commercial director", "chief commercial"], 20],
  [["managing director", "director of operations", "operations director", "director of ecommerce", "head of ecommerce", "head of e-commerce", "e-commerce director", "digital director", "cmo", "chief marketing", "head of sales", "sales director", "vp sales"], 15],
  [["director", "head of", "partner"], 10],
  [["manager", "consultant", "lead"], 5],
];

function scoreRole(headline: string, experiences?: unknown): number {
  // Many founders put a company tagline in their LinkedIn headline instead of
  // their actual title ("KenTech Energy develops..."). The role signal still
  // exists in their experiences array — check the first 2 entries (current +
  // most recent previous) so we don't miss obvious Founders/CEOs.
  const parts = [headline || ""];
  if (Array.isArray(experiences)) {
    for (const e of experiences.slice(0, 2)) {
      const exp = e as { title?: string; position?: string; role?: string };
      if (exp?.title) parts.push(exp.title);
      if (exp?.position) parts.push(exp.position);
      if (exp?.role) parts.push(exp.role);
    }
  }
  const lower = parts.join(" ").toLowerCase();
  for (const [keywords, score] of ROLE_SCORES) {
    if (keywords.some((kw) => lower.includes(kw))) return score;
  }
  return 0;
}

// ── Segment (0-25, max of all profiles) ─────────────────────────────
type SegmentFamily = "service-consulting" | "service-agency" | "service-legal" | "product-wholesale" | "product-foodbev" | "product-dtc" | "product-consumer";

interface SegmentProfile {
  family: SegmentFamily;
  keywords: string[];
  score: number;
}

const SEGMENT_PROFILES: SegmentProfile[] = [
  { family: "service-consulting", keywords: ["consulting", "advisory", "strategy consult", "management consulting", "transformation consult", "boutique consulting", "coaching", "training"], score: 25 },
  { family: "service-agency", keywords: ["marketing agency", "digital agency", "content agency", "creative agency", "advertising agency", "public relations", "branding agency", "recruitment agency", "performance marketing agency"], score: 25 },
  { family: "service-legal", keywords: ["law firm", "legal services", "fiduciary", "corporate services", "compliance services", "notary", "accounting", "audit firm"], score: 20 },

  { family: "product-wholesale", keywords: ["wholesale", "distributor", "distribution", "importer", "horeca", "supplier", "supply chain", "b2b distribution", "trade"], score: 25 },
  { family: "product-foodbev", keywords: ["food", "beverage", "brewery", "winery", "distillery", "f&b", "food & beverage", "food production", "beverage manufacturing", "dairy", "confectionery", "bakery", "snack", "coffee", "tea", "juice", "kombucha", "functional drink"], score: 25 },
  { family: "product-dtc", keywords: ["direct-to-consumer", "direct to consumer", "dtc", "d2c", "shopify", "ecommerce", "e-commerce", "online store", "online shop", "webshop", "subscription box"], score: 23 },
  { family: "product-consumer", keywords: ["apparel", "fashion", "cosmetics", "beauty", "skincare", "personal care", "consumer goods", "retail brand", "sporting goods", "home goods", "homeware", "luxury goods", "furniture"], score: 22 },
];

// Signal words that bump segment score (capped +5)
const SEGMENT_BONUS_SIGNALS = ["horeca", "specialty", "craft", "artisan", "premium", "organic", "export", "international", "family-owned", "family owned", "heritage"];

interface SegmentResult { score: number; family: SegmentFamily | null; bonus: number }

function scoreSegment(industry: string, description: string, specialties: string, headline: string): SegmentResult {
  const text = `${industry} ${description} ${specialties} ${headline}`.toLowerCase();

  let best: SegmentResult = { score: 0, family: null, bonus: 0 };
  for (const prof of SEGMENT_PROFILES) {
    if (prof.keywords.some((kw) => text.includes(kw))) {
      if (prof.score > best.score) {
        best = { score: prof.score, family: prof.family, bonus: 0 };
      }
    }
  }

  // Signal bonus (only counts if we matched something)
  if (best.family) {
    let hits = 0;
    for (const signal of SEGMENT_BONUS_SIGNALS) {
      if (text.includes(signal)) hits++;
    }
    best.bonus = Math.min(5, hits * 2);
  }

  return best;
}

// ── Hard excludes (force SKIP) ──────────────────────────────────────
// Categories where DigX simply can't help or competes directly.
interface HardExclude { keywords: string[]; reason: string }
const HARD_EXCLUDES: HardExclude[] = [
  { keywords: ["ai agency", "automation consulting", "rpa ", "rpa,", "digital transformation consulting", "ai automation", "machine learning agency", "data science consultancy", "ai solutions provider", "chatbot agency", "artificial intelligence agency"], reason: "Competing service provider" },
  { keywords: ["restaurant owner", "chef", "restaurant manager", "cafe owner", "bar manager", "hotel general manager", "hospitality manager"], reason: "Buyer of DigX-ICP products, not DigX client" },
  { keywords: ["supermarket", "grocery store", "retail chain buyer"], reason: "Retail buyer, not product company" },
  // Kira opted out of alcohol brands (2026-04-23). Beverage Manufacturing was the #1
  // segment clogging her queue with 80+ leads she didn't want. Revisit if we pick up
  // an alcohol-adjacent case study.
  { keywords: ["alcohol", "brewery", "winery", "distillery", "spirits distribut", "wine distribut", "beer distribut", "liquor", "craft beer", "craft spirits", "beverage manufacturing", "wine merchant", "wine importer"], reason: "Alcohol brand — Kira opted out" },

  // Kira's 2026-04-23 feedback: the DigX calculator is built for SERVICE businesses
  // (agencies, consulting, legal) and FMCG/consumer product businesses (food, fashion,
  // cosmetics, DTC). Heavy industry and B2B industrial have "lots of processes" — sounds
  // like a fit — but the calculator's levers (revenue, order value, customer count) don't
  // map to their pipelines. She wouldn't cold-pitch them. So we force SKIP.
  { keywords: [
    // Building materials & construction supply — 123+ leads were landing in WARM
    "building material", "construction material", "cement", "ready-mix", "aggregate supplier",
    "lumber", "timber wholesal", "steel distribut", "steel wholesal", "rebar", "roofing supply",
    "plumbing supply", "electrical supply", "hvac supply", "hardware wholesal",
    "construction supply", "builders merchant",
    // Construction & engineering services
    "construction company", "general contractor", "civil engineering", "engineering services",
    "architectural services", "infrastructure construction",
  ], reason: "Construction / building materials — outside DigX calculator fit" },

  { keywords: [
    // Heavy / industrial manufacturing. Kira specifically called out tires, wood,
    // chemicals, chair manufacturers, and fertilizer producers on 2026-04-23.
    "industrial machinery", "heavy machinery", "machinery manufacturing", "industrial equipment",
    "motor vehicle manufactur", "automotive manufactur", "tire manufactur", "tyre manufactur",
    "automotive parts", "auto parts", "industrial automation",
    "chemical manufactur", "industrial chemical", "petrochemical",
    "glass, ceramics and concrete", "glass manufactur", "ceramics manufactur", "concrete manufactur",
    "textile manufactur", "packaging and containers", "packaging manufactur",
    "paper and forest", "pulp and paper", "wood product", "sawmill",
    "metals manufactur", "steel manufactur", "aluminum manufactur", "fabricated metal",
    "defense and aerospace", "aerospace manufactur",
    "semiconductor manufactur", "electrical manufactur", "appliance manufactur",
    "mining", "oil and gas", "oil & gas", "petroleum", "utilities",
    "fertilizer", "agrochemical",
    "furniture and home furnishings manufactur", "furniture manufactur",
    // HVAC / MEP — 2026-04-23 Kira rejected a HOT 75 "Wholesale" lead
    // (Jackson Systems: HVAC controls manufacturer + distributor) as Wrong industry.
    "hvac", "heating, ventilation", "refrigeration manufactur", "refrigeration distribut",
    "plumbing wholesal", "plumbing manufactur", "plumbing distribut",
    "electrical distribut", "electrical wholesal",
  ], reason: "Heavy / B2B industrial — calculator isn't geared for their operations" },

  { keywords: [
    // Tech / software — they build, not sell FMCG
    "software development", "it services and it consulting", "computer software",
    "saas platform", "developer tools", "devops",
  ], reason: "Software / tech vendor — not DigX ICP" },

  { keywords: [
    // Transportation & logistics infrastructure
    "truck transportation", "freight", "maritime shipping", "rail transportation",
    "airlines and aviation", "logistics provider", "third-party logistics", "3pl",
  ], reason: "Transportation/logistics infrastructure — not DigX ICP" },
];

function checkHardExclude(
  text: string,
  headcount: number | null,
  additional: { keywords: string[]; reason: string }[] = [],
): string | null {
  const lower = text.toLowerCase();
  for (const ex of HARD_EXCLUDES) {
    if (ex.keywords.some((kw) => lower.includes(kw))) return ex.reason;
  }
  // User-defined additions from /settings → ICP editor — checked AFTER built-ins
  // so the calibrated list wins on ambiguous matches.
  for (const ex of additional) {
    if (Array.isArray(ex.keywords) && ex.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return ex.reason || "Custom exclude";
    }
  }
  if (headcount !== null && headcount > 5000) return "Enterprise (>5000 employees) — outside DigX sweet spot";
  return null;
}

// ── Company size (0-20) — bumped vs old scoring ─────────────────────
// Most extension-scraped leads arrive without an integer headcount (LinkedIn
// shows ranges like "11-50"). Returning 0 for those unfairly capped scoring at
// 69 max across 857 leads — nobody could hit HOT. Now unknown = 10 (half credit,
// benefit of the doubt), so a strong role+segment+geo match can still reach HOT.
function scoreCompanySize(headcount: number | null): number {
  if (headcount === null || headcount === undefined) return 10; // unknown — neutral
  if (headcount >= 11 && headcount <= 50) return 20;  // sweet spot
  if (headcount >= 51 && headcount <= 200) return 17;
  if (headcount >= 2 && headcount <= 10) return 12;
  if (headcount >= 201 && headcount <= 500) return 8;
  if (headcount >= 501 && headcount <= 2000) return 3;
  return 0;
}

// ── Location (0-15) — geography matters, bumped vs old ──────────────
function scoreLocation(location: string): number {
  const lower = location.toLowerCase();
  const primary = ["ukraine", "germany", "netherlands", "united kingdom", "england", "scotland", "wales", "uk,", "spain", "portugal", "austria", "switzerland", "ireland", "united states", "usa", "u.s.", "uae", "united arab emirates", "dubai"];
  const secondary = ["france", "belgium", "italy", "sweden", "norway", "denmark", "finland", "poland", "czech", "canada", "australia"];
  if (primary.some((loc) => lower.includes(loc))) return 15;
  if (secondary.some((loc) => lower.includes(loc))) return 10;
  if (lower.trim().length > 0) return 5; // somewhere, just not priority
  return 2; // unknown
}

// ── Category alignment (0-10) ───────────────────────────────────────
// A food-distributor tagged "DigX Wholesale" has family=product-foodbev, but
// wholesale-distribution and food/beverage are the SAME ICP track for DigX —
// the boundary only matters for outreach angle, not for qualification. So the
// alignment check accepts any product-* family for any product-* category
// (wholesale OR food OR dtc OR consumer), and any service-* family for any
// service-* category. Only cross-track mismatches (service category + product
// family, or vice versa) get the penalty.
function categoryAlignment(category: string | null | undefined, family: SegmentFamily | null): number {
  if (!category || !family) return 0;
  const cat = category.toLowerCase();
  const isServiceCat = /service|consulting|agency|legal|fiduciary|advisory/.test(cat);
  const isProductCat = /wholesale|distributor|distribution|horeca|importer|food|beverage|f&b|foodbev|e.?commerce|ecomm|dtc|d2c|direct.to.consumer|shopify|fashion|apparel|beauty|cosmetics|consumer|retail/.test(cat);

  const isServiceFamily = family.startsWith("service-");
  const isProductFamily = family.startsWith("product-");

  if (isServiceCat && isServiceFamily) return 10;
  if (isProductCat && isProductFamily) return 10;
  // Cross-track mismatch (user tagged wholesale but detected segment is legal) → small penalty
  if ((isServiceCat || isProductCat) && family) return -5;
  return 0;
}

// ── Tier thresholds ─────────────────────────────────────────────────
import type { IcpRules } from "@/lib/icp-rules";
import { DEFAULT_ICP_RULES } from "@/lib/icp-rules";

function getTier(
  total: number,
  thresholds: IcpRules["tiers"] = DEFAULT_ICP_RULES.tiers,
): "HOT" | "WARM" | "COLD" | "SKIP" {
  if (total >= thresholds.hot) return "HOT";
  if (total >= thresholds.warm) return "WARM";
  if (total >= thresholds.cold) return "COLD";
  return "SKIP";
}

// ── Main entry ──────────────────────────────────────────────────────
// `rules` is optional — when omitted, scoring uses the hardcoded defaults
// (tier thresholds 70/50/30, no additional excludes). Pass live rules from
// getIcpRules() at API-route entry to honour user overrides.
export function scoreLead(
  lead: {
    headline?: string;
    company_industry?: string;
    company_description?: string;
    company_specialties?: string;
    company_name?: string | null;
    company_headcount?: number | null;
    location?: string;
    category?: string | null;
    experiences?: unknown;
  },
  rules: IcpRules = DEFAULT_ICP_RULES,
): ScoringBreakdown {
  const headline = lead.headline || "";
  const industry = lead.company_industry || "";
  const description = lead.company_description || "";
  const specialties = lead.company_specialties || "";
  const companyName = lead.company_name || "";
  const headcount = lead.company_headcount ?? null;

  // Hard exclude check (runs on all text + user-defined additions)
  const combined = `${industry} ${description} ${specialties} ${headline}`;
  const excludedReason = checkHardExclude(combined, headcount, rules.additionalExcludes);
  if (excludedReason) {
    return {
      role: 0, segment: 0, segment_family: null, segment_bonus: 0,
      company_size: 0, location: 0, category_alignment: 0,
      total: 0, tier: "SKIP", excluded_reason: excludedReason,
    };
  }

  const roleScore = scoreRole(headline, lead.experiences);
  // Also feed company_name into segment matching — a company called "Calvi Organic
  // Foods" should match product-foodbev even if company_industry is empty.
  const seg = scoreSegment(industry, description, `${specialties} ${companyName}`, headline);
  const sizeScore = scoreCompanySize(headcount);
  const locationScore = scoreLocation(lead.location || "");
  const alignment = categoryAlignment(lead.category, seg.family);

  const total = Math.max(
    0,
    Math.min(100, roleScore + seg.score + seg.bonus + sizeScore + locationScore + alignment)
  );
  const tier = getTier(total, rules.tiers);

  return {
    role: roleScore,
    segment: seg.score,
    segment_family: seg.family,
    segment_bonus: seg.bonus,
    company_size: sizeScore,
    location: locationScore,
    category_alignment: alignment,
    total,
    tier,
  };
}
