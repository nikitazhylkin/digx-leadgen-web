/**
 * ICP Scoring — deterministic, no AI involved.
 * Port of pipeline/score_lead.py logic for server-side use.
 */

interface ScoringBreakdown {
  role: number;
  segment: number;
  company_size: number;
  location: number;
  total: number;
  tier: string;
}

const ROLE_SCORES: [string[], number][] = [
  [["founder", "co-founder", "owner", "ceo", "chief executive", "managing partner"], 25],
  [["coo", "chief operating", "head of operations"], 20],
  [["managing director", "director of operations", "vp operations", "operations director", "director"], 15],
  [["manager", "head of", "partner", "consultant"], 5],
];

const SEGMENT_KEYWORDS: { keywords: string[]; score: number }[] = [
  { keywords: ["consulting", "advisory", "strategy", "transformation", "management consulting", "coaching", "training", "boutique consulting"], score: 25 },
  { keywords: ["agency", "marketing", "digital agency", "content agency", "creative agency", "advertising", "public relations", "communications", "branding", "recruitment", "performance marketing"], score: 25 },
  { keywords: ["law firm", "legal", "fiduciary", "corporate services", "compliance", "notary", "human resources", "accounting", "audit"], score: 20 },
];

const HARD_EXCLUDES = [
  "ai agency", "automation consulting", "rpa", "digital transformation consulting",
  "ai automation", "machine learning", "data science", "ai solutions",
  "chatbot", "ai-powered", "artificial intelligence agency",
];

function scoreRole(headline: string): number {
  const lower = headline.toLowerCase();
  for (const [keywords, score] of ROLE_SCORES) {
    if (keywords.some((kw) => lower.includes(kw))) return score;
  }
  return 0;
}

function scoreSegment(industry: string, description: string, specialties: string): number {
  const text = `${industry} ${description} ${specialties}`.toLowerCase();

  // Hard exclude check
  if (HARD_EXCLUDES.some((ex) => text.includes(ex))) return -100;

  for (const seg of SEGMENT_KEYWORDS) {
    if (seg.keywords.some((kw) => text.includes(kw))) return seg.score;
  }
  return 0;
}

function scoreCompanySize(headcount: number | null): number {
  if (!headcount) return 0;
  if (headcount >= 11 && headcount <= 50) return 15;
  if (headcount >= 51 && headcount <= 200) return 12;
  if (headcount >= 2 && headcount <= 10) return 8;
  if (headcount >= 201 && headcount <= 500) return 5;
  return 0;
}

function scoreLocation(location: string): number {
  const lower = location.toLowerCase();
  const primary = ["ukraine", "germany", "netherlands", "united kingdom", "uk", "spain", "portugal", "austria", "switzerland", "ireland", "united states", "usa", "uae", "dubai"];
  const secondary = ["france", "belgium", "italy", "sweden", "norway", "denmark", "finland", "poland", "czech", "canada", "australia"];

  if (primary.some((loc) => lower.includes(loc))) return 10;
  if (secondary.some((loc) => lower.includes(loc))) return 5;
  return 2; // worldwide scope — still some points
}

function getTier(score: number): string {
  if (score >= 70) return "HOT";
  if (score >= 50) return "WARM";
  if (score >= 30) return "COLD";
  return "SKIP";
}

export function scoreLead(lead: { headline?: string; company_industry?: string; company_description?: string; company_specialties?: string; company_headcount?: number | null; location?: string }): ScoringBreakdown {
  const roleScore = scoreRole(lead.headline || "");
  const segmentScore = scoreSegment(
    lead.company_industry || "",
    lead.company_description || "",
    lead.company_specialties || ""
  );
  const sizeScore = scoreCompanySize(lead.company_headcount || null);
  const locationScore = scoreLocation(lead.location || "");

  // If hard excluded, total is 0
  const total = segmentScore < 0 ? 0 : Math.min(100, roleScore + segmentScore + sizeScore + locationScore);
  const tier = getTier(total);

  return {
    role: roleScore,
    segment: Math.max(0, segmentScore),
    company_size: sizeScore,
    location: locationScore,
    total,
    tier,
  };
}
