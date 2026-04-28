export type OutreachStatus =
  | "new"           // legacy — no new rows use this (every ingest auto-scores)
  | "scored"
  | "request_sent"  // connection request sent — Approve button writes this
  | "connected"     // target accepted the request
  | "enriched"      // Proxycurl/Perplexity/TheirStack done — only after connected
  | "message_ready" // legacy — retained for back-compat
  | "messaged"      // personal DM sent (same position as legacy 'sent')
  | "sent"          // legacy alias of messaged
  | "replied"
  | "converted";

export type IcpTier = "HOT" | "WARM" | "COLD" | "SKIP";

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;

  // Identity
  linkedin_url: string;
  first_name: string;
  last_name: string;
  full_name: string;
  headline: string;
  summary: string; // LinkedIn About section
  location: string;

  // Company
  company_name: string;
  company_name_casual: string;
  company_url: string | null;
  company_linkedin_url: string | null;
  company_industry: string | null;
  company_headcount: number | null;
  company_hq: string | null;
  company_description: string | null;
  company_specialties: string | null;

  // Enrichment
  company_homepage_text: string | null;
  company_about_text: string | null;
  company_website_text: string | null; // combined deep-scrape (homepage + about + product + pricing + team + careers)
  person_research: string | null;
  company_research: string | null;
  tech_stack: Record<string, unknown>[] | null; // JSON from TheirStack
  hiring_signals: { jobs?: Record<string, unknown>[]; velocity_30d?: number } | Record<string, unknown>[] | null;
  proof_points: Array<{ name: string; type: string; source?: string }> | null;
  recent_posts: Record<string, unknown>[] | null;

  // Apify rich profile fields (migration 013). The chosen actor returns
  // email + skills + education + posts + photo + connections in one call;
  // we map curated columns + keep the full response in apify_raw for
  // future-proofing.
  email: string | null;
  email_verified: boolean | null;
  apify_raw: Record<string, unknown> | null;
  skills: string[] | null;
  education: Record<string, unknown>[] | null;
  certifications: Record<string, unknown>[] | null;
  profile_image_url: string | null;
  connections_count: number | null;
  languages: Record<string, unknown>[] | null;

  // Scoring
  icp_score: number | null;
  icp_tier: IcpTier | null;
  scoring_breakdown: Record<string, unknown> | null;

  // Outreach
  outreach_status: OutreachStatus;
  message_variants: MessageVariant[] | null;
  selected_message: string | null;
  sent_at: string | null;
  replied_at: string | null;
  connected_at: string | null;

  // CRM
  clickup_task_id: string | null;
  source: string | null; // 'linkedin_engagement' | 'sales_navigator' | 'manual' | 'csv_import'

  // Grouping
  category: string | null; // e.g., "DigX Wholesale", "DigX E-commerce" — for ICP-batch filtering

  // Free-form notes (editable in drawer)
  notes: string | null;

  // Manual qualification (Phase 1 of pipeline — human review before enrichment)
  qualification: "approved" | "rejected" | null;
  rejection_reason: string | null;
  qualified_at: string | null;
  qualified_by: string | null;

  // Enrichment outcome (migration 010). Used by StatusTimeline to render partial/failed
  // enrichment honestly — a lead with all 3 providers failing stays at outreach_status='scored'
  // but gets enrichment_error set, so the UI can show a red badge on the Enriched bar.
  enrichment_error: string | null;
  enrichment_completeness: "partial" | "full" | null;

  // Pipeline timestamps (migration 011). Power the connection-first flow +
  // analytics (acceptance rate, time-to-accept).
  request_sent_at: string | null;
  connection_accepted_at: string | null;
}

export interface MessageVariant {
  angle: "cold_reading" | "observation" | "value_first";
  message: string;
  principles_score: number;
  principles_hit: string[];
}
