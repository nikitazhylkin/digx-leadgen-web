/**
 * Lead enrichment service — calls Proxycurl, web scraper, Perplexity, TheirStack
 * Runs server-side only (API routes). Keys load from env first, then from the
 * Supabase app_config table (editable via /settings page).
 */

import { getConfig } from "./config";

const COMPANY_SUFFIXES = [
  /\s+Inc\.?$/i, /\s+Incorporated$/i, /\s+LLC$/i, /\s+Ltd\.?$/i,
  /\s+Limited$/i, /\s+GmbH$/i, /\s+AG$/i, /\s+S\.r\.l\.?$/i,
  /\s+S\.A\.?$/i, /\s+B\.V\.?$/i, /\s+PLC$/i, /\s+Corp\.?$/i,
  /\s+Corporation$/i, /\s+Co\.?$/i, /\s+Company$/i, /\s+Pty$/i,
  /\s+UG$/i, /\s+e\.V\.?$/i, /\s+OÜ$/i, /\s+d\.o\.o\.?$/i,
];

export function casualizeCompany(name: string): string {
  let result = name.trim();
  for (const suffix of COMPANY_SUFFIXES) {
    result = result.replace(suffix, "").trim();
  }
  return result;
}

export interface EnrichmentResult {
  // Identity
  first_name?: string;
  last_name?: string;
  full_name?: string;
  headline?: string;
  summary?: string;
  location?: string;
  // Company
  company_name?: string;
  company_name_casual?: string;
  company_url?: string;
  company_linkedin_url?: string;
  company_industry?: string;
  company_headcount?: number;
  company_hq?: string;
  company_description?: string;
  company_specialties?: string;
  // Enrichment
  company_homepage_text?: string;
  company_about_text?: string;
  company_website_text?: string; // combined scrape across homepage + about + product + pricing + team + careers
  person_research?: string;
  company_research?: string;
  tech_stack?: unknown[];
  hiring_signals?: unknown; // { jobs: [...], velocity_30d: N }
  proof_points?: unknown; // [{ name, type, source }]
  experiences?: unknown[];
  // Apify rich profile fields (migration 013)
  email?: string;
  email_verified?: boolean;
  apify_raw?: Record<string, unknown>;
  skills?: string[];
  education?: unknown[];
  certifications?: unknown[];
  recent_posts?: unknown[];
  profile_image_url?: string;
  connections_count?: number;
  languages?: unknown[];
  // Status
  outreach_status: string;
  error?: string;
}

// Proxycurl was the person/company profile provider. The service shut down
// (Nubela deprecated the endpoint — HTTP 410 on every call). Removed 2026-04-23.
// Replaced 2026-04-28 by Apify-managed LinkedIn profile scraping (see
// scrapeProfileViaApify below). Downstream enrichment now relies on:
//   1. Apify (URL → name/title/company/industry) — when no seed_data is provided
//   2. Extension-scraped seed_data (Sales Nav push path) — fast path when present
//   3. Perplexity — person + company research
//   4. TheirStack — tech stack + hiring signals

// ── Apify LinkedIn Profile Scraper ─────────────────────────────────
// Apify hosts third-party "actors" that handle LinkedIn scraping in their
// own infra (residential proxies, account farms, anti-detection). We hit
// their sync REST endpoint with a profile URL, get back JSON, map it to
// our EnrichmentResult shape.
//
// Actor selection: any "LinkedIn Profile Scraper" actor that accepts a URL
// list and returns profile records. Pinned by env var APIFY_LINKEDIN_ACTOR
// (default: dev_fusion/linkedin-profile-scraper) so swapping actors is one
// env edit. The mapper below tolerates field-name variations across actors.

// Default actor: apimaestro/linkedin-profile-detail. Works on free Apify
// plan via API (other rich actors are gated to UI-only). Returns:
// basic_info (name, headline, photo, current_company, top_skills,
// connection_count, location), experience[], education[], certifications,
// languages, projects. Email is null on this actor — that's intentional;
// email outreach is Phase 2 (see CLAUDE.md).
//
// To unlock email-returning actors, upgrade Apify plan and swap to
// 2SyF0bVxmgGr8IVCZ via APIFY_LINKEDIN_ACTOR.
const APIFY_DEFAULT_ACTOR = "apimaestro~linkedin-profile-detail";

// Extract the LinkedIn slug from a profile URL. The apimaestro actor takes
// `{username: "<slug>"}` rather than the full URL. Other actors take URLs;
// we send both shapes so the wrapper works whichever actor is configured.
function linkedinSlug(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

async function scrapeProfileViaApify(url: string): Promise<Partial<EnrichmentResult> | null> {
  const token = await getConfig("apify_token", "APIFY_TOKEN");
  if (!token) return null;
  const actor = (await getConfig("apify_linkedin_actor", "APIFY_LINKEDIN_ACTOR")) || APIFY_DEFAULT_ACTOR;
  const actorPath = encodeURIComponent(actor);
  const slug = linkedinSlug(url);

  // Multi-shape input — apimaestro reads `username`, others read `profileUrls`
  // / `urls` / `linkedinUrls`. Sending all variants lets the same code work
  // across actors without per-actor branching.
  const input: Record<string, unknown> = {
    profileUrls: [url],
    urls: [url],
    linkedinUrls: [url],
  };
  if (slug) input.username = slug;

  // Async run + poll. Sync endpoint is gated on free plan for some actors;
  // the runs endpoint works universally.
  try {
    const startResp = await fetch(`https://api.apify.com/v2/acts/${actorPath}/runs?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20000),
    });
    if (!startResp.ok) {
      const body = await startResp.text().catch(() => "");
      throw new Error(`Apify start ${startResp.status}: ${body.slice(0, 200)}`);
    }
    const startJson = (await startResp.json()) as { data?: { id?: string; defaultDatasetId?: string } };
    const runId = startJson.data?.id;
    if (!runId) throw new Error("Apify did not return a run id");

    // Poll up to ~90s. Most LinkedIn profile scrapes complete in 5-15s.
    let datasetId: string | undefined;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!statusResp.ok) continue;
      const statusJson = (await statusResp.json()) as { data?: { status?: string; defaultDatasetId?: string } };
      const status = statusJson.data?.status;
      if (status === "SUCCEEDED") {
        datasetId = statusJson.data?.defaultDatasetId;
        break;
      }
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new Error(`Apify run ${status}`);
      }
    }
    if (!datasetId) throw new Error("Apify run did not complete in 90s");

    const itemsResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!itemsResp.ok) throw new Error(`Apify dataset ${itemsResp.status}`);
    const items = (await itemsResp.json()) as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) return null;
    const item = items[0];

    // Some actors return an error item (e.g. UI-only restriction on free plan).
    if (item.error && Object.keys(item).length <= 2) {
      throw new Error(`Apify actor error: ${String(item.error).slice(0, 150)}`);
    }

    return mapApifyProfile(item);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// Defensive mapper — different LinkedIn scraper actors use slightly different
// shapes. apimaestro nests identity under `basic_info`; other actors use a
// flat root-level layout. We look up each field across both layouts and
// stash the full raw response in apify_raw for any field we missed.
function mapApifyProfile(raw: Record<string, unknown>): Partial<EnrichmentResult> {
  // Merged lookup: check `basic_info` first (apimaestro), then root-level
  // (other actors). Functions just take field names and try both scopes.
  const basic = (raw.basic_info && typeof raw.basic_info === "object")
    ? raw.basic_info as Record<string, unknown>
    : {};
  const fromBasic = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) {
      const v = basic[k];
      if (v !== undefined && v !== null && v !== "") return v as T;
    }
    return undefined;
  };
  const fromRoot = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && v !== "") return v as T;
    }
    return undefined;
  };
  const pick = <T = unknown>(...keys: string[]): T | undefined =>
    fromBasic<T>(...keys) ?? fromRoot<T>(...keys);
  const str = (...keys: string[]) => {
    const v = pick<unknown>(...keys);
    return typeof v === "string" ? v.trim() : undefined;
  };
  const num = (...keys: string[]) => {
    const v = pick<unknown>(...keys);
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+/.test(v)) return parseInt(v, 10);
    return undefined;
  };
  const bool = (...keys: string[]) => {
    const v = pick<unknown>(...keys);
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true" || v.toLowerCase() === "valid") return true;
      if (v.toLowerCase() === "false" || v.toLowerCase() === "invalid") return false;
    }
    return undefined;
  };
  const arr = (...keys: string[]): unknown[] | undefined => {
    const v = pick<unknown>(...keys);
    return Array.isArray(v) ? v : undefined;
  };
  const stringArr = (...keys: string[]): string[] | undefined => {
    const v = arr(...keys);
    if (!v) return undefined;
    return v
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return (obj.name || obj.title || obj.skill || obj.value) as string | undefined;
        }
        return undefined;
      })
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  };

  // Location may be a nested object (apimaestro: {full, city, country}) or
  // a flat string (other actors).
  const locObj = pick<unknown>("location");
  const locationStr = typeof locObj === "string"
    ? locObj.trim()
    : (locObj && typeof locObj === "object")
      ? ((locObj as Record<string, unknown>).full as string | undefined)
        || ((locObj as Record<string, unknown>).city as string | undefined)
      : undefined;

  // Current company: apimaestro gives string `current_company` + separate `current_company_url`.
  // Other actors might nest under a `currentCompany` object.
  const currentCompanyObj = pick<unknown>("currentCompany", "current_company", "company");
  const companyFromObj = (key: string) =>
    typeof currentCompanyObj === "object" && currentCompanyObj !== null
      ? ((currentCompanyObj as Record<string, unknown>)[key] as string | undefined)
      : undefined;

  const fullName = str("fullname", "fullName", "full_name", "name") ||
    [str("first_name", "firstName"), str("last_name", "lastName")].filter(Boolean).join(" ").trim() || undefined;

  const companyName =
    str("current_company", "currentCompanyName", "company_name", "occupation") ||
    (typeof currentCompanyObj === "string" ? currentCompanyObj : undefined) ||
    companyFromObj("name");

  return {
    // Identity
    full_name: fullName,
    first_name: str("first_name", "firstName"),
    last_name: str("last_name", "lastName"),
    headline: str("headline", "subTitle", "title"),
    summary: str("about", "summary", "description"),
    location: locationStr,
    profile_image_url: str("profile_picture_url", "profilePicture", "profile_image_url", "photoUrl", "imageUrl", "avatar"),
    connections_count: num("connection_count", "connectionsCount", "connections_count", "connections", "numConnections"),
    // Company. The actor sometimes returns a LinkedIn company URL under
    // generic `company_url` keys (apimaestro: `current_company_url`).
    // company_url should be the real company website; if all we got is a
    // LinkedIn URL, route it to company_linkedin_url and let Perplexity's
    // findCompanyWebsite resolve the real domain downstream.
    company_name: companyName,
    company_url: (() => {
      const candidate = str("companyWebsite", "company_url", "currentCompanyWebsite") || companyFromObj("website") || companyFromObj("url");
      if (candidate && !candidate.toLowerCase().includes("linkedin.com")) return candidate;
      // Fall back to current_company_url ONLY if it's not a linkedin URL.
      const fallback = str("current_company_url");
      if (fallback && !fallback.toLowerCase().includes("linkedin.com")) return fallback;
      return undefined;
    })(),
    company_linkedin_url: (() => {
      // Pick anything that looks like a LinkedIn company URL.
      const candidates = [
        str("companyLinkedinUrl", "company_linkedin_url", "currentCompanyLinkedin"),
        str("current_company_url"),
        companyFromObj("linkedin"),
        companyFromObj("linkedinUrl"),
      ];
      return candidates.find((c) => typeof c === "string" && c.toLowerCase().includes("linkedin.com"));
    })(),
    company_industry: str("companyIndustry", "company_industry", "currentCompanyIndustry") || companyFromObj("industry"),
    company_headcount: num("companyEmployeeCount", "companySize", "company_employee_count", "currentCompanyEmployeeCount") || (companyFromObj("employeeCount") ? Number(companyFromObj("employeeCount")) : undefined),
    company_hq: str("companyLocation", "companyHq", "currentCompanyLocation") || companyFromObj("location") || companyFromObj("hq"),
    // Email — apimaestro returns null; premium actors sometimes return it.
    email: str("email", "emailAddress", "personalEmail", "workEmail"),
    email_verified: bool("emailVerified", "email_verified", "emailValid"),
    // Rich nested arrays — kept as raw shape, downstream consumers drill in.
    // apimaestro uses singular `experience` / `education`; other actors plural.
    experiences: arr("experience", "experiences", "positions"),
    education: arr("education", "educations", "schools"),
    certifications: arr("certifications", "licensesAndCertifications", "certs"),
    recent_posts: arr("posts", "recentPosts", "recent_posts", "activity"),
    languages: arr("languages", "languagesSpoken"),
    // apimaestro returns 5 in `top_skills`; other actors return a flat full
    // list under `skills`. Combined gives the best coverage.
    skills: stringArr("top_skills", "skills", "skill", "topSkills"),
    // Stash the full raw response (everything we didn't map is recoverable).
    apify_raw: raw,
  };
}

// ── Website Scrape ─────────────────────────────────────────────────

async function scrapeWebpage(url: string, maxChars = 10000): Promise<string> {
  if (!url) return "";
  // Guard: never scrape LinkedIn URLs (blocked, and almost always indicates
  // the URL was wrongly populated from the person's profile).
  const lower = url.toLowerCase();
  if (lower.includes("linkedin.com") || lower.includes("/sales/")) return "";
  try {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const resp = await fetch(fullUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DigX Lead Research)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    // Strip tags, extract text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&[a-z]+;/gi, " ")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
    return text.substring(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Scrape a deep set of pages in parallel. Returns:
 *  - homepage_text: just the root page (for legacy compat / display)
 *  - about_text: first useful /about-like page
 *  - combined_text: concat of all scraped pages up to 25k chars, labeled by path
 *
 * Wider path set than before: includes product, pricing, customers, case-studies,
 * team, careers — the pages that carry Saraev-grade signals (positioning,
 * proof points, hiring velocity).
 */
async function scrapeCompanyPages(websiteUrl: string) {
  if (!websiteUrl) return { homepage_text: "", about_text: "", combined_text: "" };
  const lower = websiteUrl.toLowerCase();
  if (lower.includes("linkedin.com") || lower.includes("/sales/")) {
    return { homepage_text: "", about_text: "", combined_text: "" };
  }
  const fullUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const base = new URL(fullUrl).origin;

  const ABOUT_PATHS = ["/about", "/about-us", "/company", "/who-we-are"];
  const DEEP_PATHS = ["/products", "/product", "/services", "/solutions", "/pricing", "/customers", "/case-studies", "/team", "/careers"];

  // Homepage first
  const homepage = await scrapeWebpage(fullUrl, 10000);

  // About variants — stop at first useful one
  let aboutText = "";
  let aboutPath = "";
  for (const path of ABOUT_PATHS) {
    const t = await scrapeWebpage(`${base}${path}`, 8000);
    if (t.length > 200) { aboutText = t; aboutPath = path; break; }
  }

  // Deep pages in parallel — tolerate 404s silently
  const deepResults = await Promise.all(
    DEEP_PATHS.map(async (p) => ({ path: p, text: await scrapeWebpage(`${base}${p}`, 5000) }))
  );

  const sections: string[] = [];
  if (homepage) sections.push(`=== HOMEPAGE ===\n${homepage}`);
  if (aboutText) sections.push(`=== ${aboutPath.toUpperCase()} ===\n${aboutText}`);
  for (const d of deepResults) {
    if (d.text && d.text.length > 300) sections.push(`=== ${d.path.toUpperCase()} ===\n${d.text}`);
  }
  const combined = sections.join("\n\n").substring(0, 25000);

  return { homepage_text: homepage, about_text: aboutText, combined_text: combined };
}

// ── Perplexity ─────────────────────────────────────────────────────

// Perplexity prompts rewritten 2026-04-23 after Kira reported all fields
// returning "limited public footprint". Root cause: old prompt was rigid-personal
// (asking for podcasts, posts, speaking gigs) which 90% of mid-market leads
// don't have. New approach: seed with LinkedIn URL + headline, shift focus to
// role-inferred priorities + company-level signals that ARE findable. Model
// upgraded from `sonar` (cheap) to `sonar-pro` (better reasoning + web coverage).

const PERSON_RESEARCH_PROMPT = (name: string, company: string, linkedinUrl: string, headline: string) =>
`You are a B2B sales researcher. Brief me on ${name}, "${headline}", at ${company}.

Their LinkedIn: ${linkedinUrl}

Use web search. Look at: their LinkedIn posts + activity, podcast appearances, conference talks, articles they've written, interviews, press quotes, and — crucially — the company's public-facing content for context on their role.

Write a tight brief (120–200 words) covering in order:

ROLE FOCUS: What they actually own day-to-day. Infer from their title + company size + industry when public signals are thin. 1–2 sentences.

RECENT PUBLIC ACTIVITY (last 6 months): Name 1–2 specific signals — a LinkedIn post title, a named podcast / talk / interview, an article, a launch announcement, or a conference appearance. Include month + source in parens.

STATED PRIORITIES: Any public wording — from LinkedIn posts, company press releases quoting them, or interviews — on what they're focused on now.

CAREER TRAJECTORY: Last 2–3 companies with years (LinkedIn makes this visible). Note any non-obvious pivot (e.g. left Big Tech to join a wholesale brand).

NOTABLE DETAILS: One thing a salesperson could open with that isn't generic — school, hobby mentioned publicly, side project, a prior company now defunct, an unusual accomplishment.

Rules: Be specific. Cite sources inline (domain.com) when web-search-based. Do NOT fabricate quotes or names. If a section is genuinely empty, skip it — don't write "limited public footprint" placeholder text.`;

const COMPANY_RESEARCH_PROMPT = (company: string) =>
`You are a B2B sales researcher. Brief me on ${company} for cold-outreach context.

Use web search — especially their own site, recent press releases, LinkedIn company page, and job postings. Write 150–250 words covering in order:

OFFERING: What they sell, to whom, via which channel (DTC / wholesale / B2B platform / marketplace). 2–3 sentences with specifics — not marketing fluff.

GROWTH SIGNALS (last 6 months): Concrete events — hiring momentum (cite roles + approximate dates), new market launches, funding, product launches, partnerships, press mentions.

NAMED CUSTOMERS OR PARTNERS: Specific brand names, case studies, or partnerships visible on their site or in press.

OPERATIONAL SIGNALS: What their job postings + site imply about scaling pain — fulfilment, inventory, channel complexity, margin pressure, reporting gaps, platform consolidation needs.

TECH HINTS: Public mentions of tools — Shopify, Klaviyo, NetSuite, SAP, HubSpot, Segment, Zendesk, Gorgias, etc. Tag level of confidence (confirmed vs inferred).

Rules: Cite sources (domain.com) inline. If a section is thin, write one line of honest speculation anchored in visible signals — don't pad with fluff and don't write "limited" placeholder text.`;

const PROOF_POINTS_PROMPT = (company: string) => `List specific named entities ${company} publicly associates with: customers they've worked with, brand partnerships, case studies they publish, and press mentions. Return as a JSON array of objects with fields: { "name": string, "type": "customer" | "partner" | "case_study" | "press", "source": string }. Return ONLY the JSON array, no commentary. If nothing concrete is found, return [].`;

const FIND_WEBSITE_PROMPT = (company: string, location: string) => `What is the official website URL of the company "${company}"${location ? ` based in ${location}` : ""}? Return ONLY the root domain URL (e.g. "example.com" or "https://example.com") — no explanation, no markdown, no commentary. If you cannot confidently identify it, return "unknown".`;

/**
 * @deprecated unused — replaced by extension-bridge auto-scrape on /import.
 * Kept as a private helper in case we ever bring back a "URL only" fallback
 * path. Never call from new code.
 */
async function resolveProfileViaPerplexity(name: string, linkedinUrl: string): Promise<{
  company_name?: string;
  company_industry?: string;
  headline?: string;
  location?: string;
} | null> {
  const apiKey = await getConfig("perplexity_api_key", "PERPLEXITY_API_KEY");
  if (!apiKey || !name) return null;
  // Hardened prompt: explicit citation requirement + zero-tolerance for fabrication.
  // Anti-hallucination pattern — Perplexity must cite a verifiable source URL
  // for every field it returns. The first version of this prompt let the model
  // confabulate ("Co-Founder @ Perplexity AI" for someone unrelated). Now we
  // require a `_sources` map keyed by field, and reject the response if any
  // returned field lacks a cited source URL.
  const prompt = `You are a fact-checking research assistant. Look up this person via web search and return ONLY information you can verify from real sources you actually find.

Name: ${name}
LinkedIn URL: ${linkedinUrl}

CRITICAL RULES:
- DO NOT invent, guess, or interpolate. If a field cannot be verified from a real source, OMIT it.
- DO NOT confuse this person with a different person who has a similar name.
- The LinkedIn URL above is the ONLY canonical identity reference. If you can't actually access that LinkedIn page, you must verify the person via OTHER cited sources (their personal site, a company "about" page that names them, news article, conference bio).
- If you find ZERO reliable sources that match this exact LinkedIn URL slug or this exact name in a relevant context, respond with exactly: {"_unknown": true}

Return a single JSON object in this shape — every key you include MUST also have a corresponding entry in _sources with a real URL you actually found:

{
  "company": "current employer name",
  "industry": "company industry, plain English",
  "headline": "current job title or LinkedIn headline (one line)",
  "location": "city, country",
  "_sources": {
    "company": "https://...",
    "industry": "https://...",
    "headline": "https://...",
    "location": "https://..."
  }
}

If you can verify SOME fields but not others, omit the unverifiable ones AND their _sources entries — do not invent the missing ones. If you can verify NOTHING, return {"_unknown": true}.

Respond with the JSON object only — no markdown fences, no commentary.`;
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim();
    // Extract JSON — Perplexity sometimes wraps in markdown despite the instruction
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed._unknown) return null;

    // Citation gate: only accept fields that have a corresponding _sources URL.
    // This is the anti-hallucination check — if Perplexity invented a value, it
    // generally won't fabricate a matching real URL alongside it.
    const sources = (parsed._sources && typeof parsed._sources === "object") ? parsed._sources : {};
    const hasCitation = (field: string): boolean => {
      const src = sources[field];
      return typeof src === "string" && /^https?:\/\//i.test(src);
    };
    const accepted: ReturnType<typeof resolveProfileViaPerplexity> extends Promise<infer R> ? R : never =
      {
        company_name: typeof parsed.company === "string" && hasCitation("company") ? parsed.company : undefined,
        company_industry: typeof parsed.industry === "string" && hasCitation("industry") ? parsed.industry : undefined,
        headline: typeof parsed.headline === "string" && hasCitation("headline") ? parsed.headline : undefined,
        location: typeof parsed.location === "string" && hasCitation("location") ? parsed.location : undefined,
      };

    // If after citation filtering nothing survives, treat as unknown.
    if (!accepted || Object.values(accepted).every((v) => !v)) return null;
    return accepted;
  } catch {
    return null;
  }
}

/** Ask Perplexity to identify a company's website. Cheap single query. */
async function findCompanyWebsite(company: string, location: string): Promise<string | null> {
  const apiKey = await getConfig("perplexity_api_key", "PERPLEXITY_API_KEY");
  if (!apiKey || !company) return null;
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: FIND_WEBSITE_PROMPT(company, location) }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || "").trim();
    if (!raw || raw.toLowerCase() === "unknown") return null;
    // Strip markdown / quotes / trailing punctuation
    let url = raw.replace(/^["'`]+|["'`.,!?)]+$/g, "").trim();
    // Take first line if multi-line
    url = url.split(/\s+/)[0];
    // Reject if it's not a plausible URL
    if (url.length < 4 || url.length > 200) return null;
    const lower = url.toLowerCase();
    if (lower.includes("linkedin.com") || lower.includes(" ")) return null;
    if (!lower.includes(".")) return null;
    return url;
  } catch { return null; }
}

async function researchPerplexity(
  name: string,
  company: string,
  linkedinUrl: string,
  headline: string,
) {
  const apiKey = await getConfig("perplexity_api_key", "PERPLEXITY_API_KEY");
  if (!apiKey) return { person_research: "", company_research: "", proof_points: null as unknown };

  const results: { person_research: string; company_research: string; proof_points: unknown } = {
    person_research: "", company_research: "", proof_points: null,
  };

  // `sonar-pro` gives deeper reasoning + richer web coverage than the cheaper
  // `sonar`. Cost is a few cents per lead, worth it for outreach-grade research.
  const callPerplexity = async (prompt: string): Promise<string> => {
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) return "";
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    } catch { return ""; }
  };

  results.person_research = await callPerplexity(PERSON_RESEARCH_PROMPT(name, company, linkedinUrl, headline));
  await new Promise((r) => setTimeout(r, 800));
  results.company_research = await callPerplexity(COMPANY_RESEARCH_PROMPT(company));
  await new Promise((r) => setTimeout(r, 800));

  // Proof-points: try to parse JSON from the response. Tolerant of markdown fences.
  const raw = await callPerplexity(PROOF_POINTS_PROMPT(company));
  if (raw) {
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        const parsed = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
        if (Array.isArray(parsed)) results.proof_points = parsed;
      } catch { /* parse failed — leave null */ }
    }
  }

  return results;
}

// ── TheirStack ─────────────────────────────────────────────────────

async function enrichTheirStack(domain: string) {
  const apiKey = await getConfig("theirstack_api_key", "THEIRSTACK_API_KEY");
  if (!apiKey || !domain) return { tech_stack: [], hiring_signals: { jobs: [], velocity_30d: 0 } };

  const results: { tech_stack: unknown[]; hiring_signals: { jobs: unknown[]; velocity_30d: number } } = {
    tech_stack: [], hiring_signals: { jobs: [], velocity_30d: 0 },
  };

  // Jobs — correct TheirStack v1 schema (probed 2026-04-23):
  //   `company_domain_or` is an array, not a scalar `company_domain`.
  //   `posted_at_max_age_days` is the relative window (not `posted_at_gte: "30d"` which is rejected).
  //   Response fields: `job_title`, `date_posted`, `long_location`, `seniority_level`, `final_url`.
  try {
    const resp = await fetch("https://api.theirstack.com/v1/jobs/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        company_domain_or: [domain],
        posted_at_max_age_days: 30,
        limit: 20,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const rawJobs = (data.data || []) as Record<string, unknown>[];
      results.hiring_signals.jobs = rawJobs.map((j) => ({
        title: j.job_title ?? j.title,
        location: j.long_location ?? j.location ?? j.short_location,
        posted_at: j.date_posted ?? j.posted_at ?? null,
        seniority: j.seniority_level ?? j.seniority ?? null,
        department: j.department ?? j.function ?? null,
        url: j.final_url ?? j.url ?? null,
      }));
      results.hiring_signals.velocity_30d = rawJobs.length;
    }
  } catch { /* skip */ }

  // Small pacing delay — TheirStack per-minute quota is tight (10/min on this plan),
  // and enrich flow is already hitting Perplexity 3x + website scrape + this.
  await new Promise((r) => setTimeout(r, 1500));

  // Companies — for tech stack. Same corrected `company_domain_or` shape.
  try {
    const resp = await fetch("https://api.theirstack.com/v1/companies/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ company_domain_or: [domain], limit: 1 }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const comp = data.data?.[0] as Record<string, unknown> | undefined;
      if (comp) {
        results.tech_stack = (comp.technology_names as unknown[]) || (comp.technologies as unknown[]) || [];
      }
    }
  } catch { /* skip */ }

  return results;
}

// ── Main Enrichment Function ───────────────────────────────────────

// Wrapper around the raw enrichment data that records per-provider outcomes.
// The /api/enrich route uses this to set `enrichment_completeness` and
// `enrichment_error` honestly, and to decide whether outreach_status should
// advance to 'enriched' or stay at 'scored' (when every provider failed).
export interface EnrichmentExecution {
  data: EnrichmentResult;
  providersTried: string[];
  providersSucceeded: string[];
  errors: Record<string, string>;
}

export async function enrichLead(
  linkedinUrl: string,
  options: { skipResearch?: boolean; skipTechstack?: boolean; seedData?: Partial<EnrichmentResult> } = {}
): Promise<EnrichmentExecution> {
  const data: EnrichmentResult = { outreach_status: "enriched" };
  const tried: string[] = [];
  const succeeded: string[] = [];
  const errors: Record<string, string> = {};

  // ── Seed: extension push wins, else Apify scrapes the URL. ──
  // The Sales Nav extension push populates seedData ahead of time — we use
  // it as-is. /import URL paste comes in with no seedData, in which case we
  // hit Apify (managed LinkedIn scraping) to get name/title/company/industry.
  // Apify isolates Kira's account from any scraping risk.
  if (options.seedData) {
    Object.assign(data, options.seedData);
  }

  if (!data.full_name || !data.company_name) {
    tried.push("apify");
    try {
      const scraped = await scrapeProfileViaApify(linkedinUrl);
      if (scraped && (scraped.full_name || scraped.company_name)) {
        // Merge: existing seed wins where present, Apify fills gaps.
        const dataRec = data as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(scraped)) {
          if (v !== undefined && v !== null && v !== "" && !dataRec[k]) {
            dataRec[k] = v;
          }
        }
        succeeded.push("apify");
      } else {
        errors.apify = scraped === null ? "no token configured or empty result" : "no usable fields";
      }
    } catch (e) {
      errors.apify = e instanceof Error ? e.message : String(e);
    }
  }

  if (!data.full_name || !data.company_name) {
    return {
      data: {
        ...data,
        error: errors.apify
          ? `Profile scrape failed: ${errors.apify}. Check APIFY_TOKEN in /settings, or push the lead via the Chrome extension as a fallback.`
          : "Missing seed profile data — set APIFY_TOKEN to enable URL-paste enrichment, or push leads via the Chrome extension.",
        outreach_status: "new",
      },
      providersTried: tried, providersSucceeded: succeeded, errors,
    };
  }
  data.company_name_casual = casualizeCompany(data.company_name || "");

  // ── Provider 1: Perplexity (find-website + research). One provider, two calls. ──
  tried.push("perplexity");
  let perplexityOk = false;
  const hasValidUrl = data.company_url && !data.company_url.toLowerCase().includes("linkedin.com");
  if (!hasValidUrl && data.company_name) {
    try {
      const discovered = await findCompanyWebsite(data.company_name, data.company_hq || "");
      if (discovered) { data.company_url = discovered; perplexityOk = true; }
    } catch (e) { errors.perplexity_find = e instanceof Error ? e.message : String(e); }
  }
  // Website scrape is free + local — not a provider, just enrichment
  if (data.company_url && !data.company_url.toLowerCase().includes("linkedin.com")) {
    const pages = await scrapeCompanyPages(data.company_url);
    data.company_homepage_text = pages.homepage_text;
    data.company_about_text = pages.about_text;
    data.company_website_text = pages.combined_text;
  }
  if (!options.skipResearch && data.full_name && data.company_name) {
    try {
      const research = await researchPerplexity(
        data.full_name,
        data.company_name,
        linkedinUrl,
        data.headline || "",
      );
      if (research.person_research || research.company_research) {
        data.person_research = research.person_research;
        data.company_research = research.company_research;
        if (research.proof_points) data.proof_points = research.proof_points;
        perplexityOk = true;
      } else {
        errors.perplexity = "empty response";
      }
    } catch (e) {
      errors.perplexity = e instanceof Error ? e.message : String(e);
    }
  }
  if (perplexityOk) succeeded.push("perplexity");
  else if (!errors.perplexity && !errors.perplexity_find) errors.perplexity = "skipped (missing inputs)";

  // ── Provider 2: TheirStack ──
  tried.push("theirstack");
  if (!options.skipTechstack && data.company_url) {
    try {
      const domain = new URL(data.company_url.startsWith("http") ? data.company_url : `https://${data.company_url}`).hostname;
      const tech = await enrichTheirStack(domain);
      const gotData = (Array.isArray(tech.tech_stack) && tech.tech_stack.length > 0)
        || (tech.hiring_signals != null);
      if (gotData) {
        data.tech_stack = tech.tech_stack;
        data.hiring_signals = tech.hiring_signals;
        succeeded.push("theirstack");
      } else {
        errors.theirstack = "empty response";
      }
    } catch (e) { errors.theirstack = e instanceof Error ? e.message : String(e); }
  } else {
    errors.theirstack = "skipped (no company_url)";
  }

  return { data, providersTried: tried, providersSucceeded: succeeded, errors };
}
