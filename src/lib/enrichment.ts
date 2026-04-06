/**
 * Lead enrichment service — calls Proxycurl, web scraper, Perplexity, TheirStack
 * Runs server-side only (API routes). Uses env vars for API keys.
 */

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
  person_research?: string;
  company_research?: string;
  tech_stack?: unknown[];
  hiring_signals?: unknown[];
  experiences?: unknown[];
  // Status
  outreach_status: string;
  error?: string;
}

// ── Proxycurl ──────────────────────────────────────────────────────

async function enrichProxycurl(linkedinUrl: string): Promise<Partial<EnrichmentResult>> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return { error: "PROXYCURL_API_KEY not set" };

  const params = new URLSearchParams({
    url: linkedinUrl,
    use_cache: "if-present",
    skills: "exclude",
    inferred_salary: "exclude",
    personal_email: "exclude",
    personal_contact_number: "exclude",
  });

  const resp = await fetch(`https://nubela.co/proxycurl/api/v2/linkedin?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    if (resp.status === 404) return { error: "LinkedIn profile not found" };
    return { error: `Proxycurl error ${resp.status}` };
  }

  const data = await resp.json();
  const companyLinkedin = data.experiences?.[0]?.company_linkedin_profile_url || null;

  return {
    first_name: data.first_name || "",
    last_name: data.last_name || "",
    full_name: data.full_name || "",
    headline: data.headline || "",
    summary: data.summary || "",
    location: [data.city, data.country_full_name].filter(Boolean).join(", "),
    company_name: data.experiences?.[0]?.company || "",
    company_linkedin_url: companyLinkedin,
    experiences: (data.experiences || []).slice(0, 5),
  };
}

async function enrichProxycurlCompany(companyLinkedinUrl: string): Promise<Partial<EnrichmentResult>> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey || !companyLinkedinUrl) return {};

  const params = new URLSearchParams({ url: companyLinkedinUrl, use_cache: "if-present" });
  const resp = await fetch(`https://nubela.co/proxycurl/api/v2/linkedin/company?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) return {};
  const data = await resp.json();

  return {
    company_industry: data.industry || "",
    company_headcount: data.company_size_on_linkedin || null,
    company_description: data.description || "",
    company_url: data.website || "",
    company_hq: data.hq?.city || "",
    company_specialties: (data.specialities || []).join(", "),
  };
}

// ── Website Scrape ─────────────────────────────────────────────────

async function scrapeWebpage(url: string, maxChars = 3000): Promise<string> {
  if (!url) return "";
  try {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const resp = await fetch(fullUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DigX Lead Research)" },
      signal: AbortSignal.timeout(10000),
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

async function scrapeCompanyPages(websiteUrl: string) {
  if (!websiteUrl) return { homepage_text: "", about_text: "" };
  const fullUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const homepage = await scrapeWebpage(fullUrl);

  let aboutText = "";
  const base = new URL(fullUrl).origin;
  for (const path of ["/about", "/about-us", "/team", "/company", "/who-we-are"]) {
    aboutText = await scrapeWebpage(`${base}${path}`);
    if (aboutText.length > 100) break;
  }

  return { homepage_text: homepage, about_text: aboutText };
}

// ── Perplexity ─────────────────────────────────────────────────────

async function researchPerplexity(name: string, company: string) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { person_research: "", company_research: "" };

  const results = { person_research: "", company_research: "" };

  try {
    const personResp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: `${name} ${company} — recent news, achievements, public talks, articles. What are they known for? Be concise, facts only.` }],
      }),
    });
    if (personResp.ok) {
      const data = await personResp.json();
      results.person_research = data.choices?.[0]?.message?.content || "";
    }
  } catch { /* skip */ }

  await new Promise((r) => setTimeout(r, 1000)); // rate limit

  try {
    const companyResp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: `What does ${company} do? Notable projects, clients, awards, recent news. Be concise, facts only.` }],
      }),
    });
    if (companyResp.ok) {
      const data = await companyResp.json();
      results.company_research = data.choices?.[0]?.message?.content || "";
    }
  } catch { /* skip */ }

  return results;
}

// ── TheirStack ─────────────────────────────────────────────────────

async function enrichTheirStack(domain: string) {
  const apiKey = process.env.THEIRSTACK_API_KEY;
  if (!apiKey || !domain) return { tech_stack: [], hiring_signals: [] };

  const results: { tech_stack: unknown[]; hiring_signals: unknown[] } = { tech_stack: [], hiring_signals: [] };

  try {
    const resp = await fetch("https://api.theirstack.com/v1/companies/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domain, limit: 1 }),
    });
    if (resp.ok) {
      const data = await resp.json();
      results.tech_stack = data.data?.[0]?.technologies || [];
    }
  } catch { /* skip */ }

  try {
    const resp = await fetch("https://api.theirstack.com/v1/jobs/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ company_domain: domain, limit: 10, posted_at_gte: "30d" }),
    });
    if (resp.ok) {
      const data = await resp.json();
      results.hiring_signals = (data.data || []).map((j: Record<string, string>) => ({
        title: j.title, location: j.location,
      }));
    }
  } catch { /* skip */ }

  return results;
}

// ── Main Enrichment Function ───────────────────────────────────────

export async function enrichLead(
  linkedinUrl: string,
  options: { skipResearch?: boolean; skipTechstack?: boolean } = {}
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { outreach_status: "enriched" };

  // Step 1: Proxycurl profile
  const profile = await enrichProxycurl(linkedinUrl);
  if (profile.error) return { ...result, error: profile.error, outreach_status: "new" };
  Object.assign(result, profile);
  result.company_name_casual = casualizeCompany(result.company_name || "");

  // Step 1b: Company data
  if (profile.company_linkedin_url) {
    const company = await enrichProxycurlCompany(profile.company_linkedin_url);
    Object.assign(result, company);
  }

  // Step 2: Website scrape
  if (result.company_url) {
    const pages = await scrapeCompanyPages(result.company_url);
    result.company_homepage_text = pages.homepage_text;
    result.company_about_text = pages.about_text;
  }

  // Step 3: Perplexity research
  if (!options.skipResearch && result.full_name && result.company_name) {
    const research = await researchPerplexity(result.full_name, result.company_name);
    result.person_research = research.person_research;
    result.company_research = research.company_research;
  }

  // Step 4: TheirStack
  if (!options.skipTechstack && result.company_url) {
    try {
      const domain = new URL(result.company_url.startsWith("http") ? result.company_url : `https://${result.company_url}`).hostname;
      const tech = await enrichTheirStack(domain);
      result.tech_stack = tech.tech_stack;
      result.hiring_signals = tech.hiring_signals;
    } catch { /* skip */ }
  }

  return result;
}
