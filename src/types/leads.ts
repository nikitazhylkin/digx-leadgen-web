export type OutreachStatus =
  | "new"
  | "enriched"
  | "scored"
  | "message_ready"
  | "sent"
  | "connected"
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
  person_research: string | null;
  company_research: string | null;
  tech_stack: Record<string, unknown>[] | null; // JSON from TheirStack
  hiring_signals: Record<string, unknown>[] | null;
  recent_posts: Record<string, unknown>[] | null;

  // Scoring
  icp_score: number | null;
  icp_tier: IcpTier | null;
  scoring_breakdown: Record<string, number> | null;

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
}

export interface MessageVariant {
  angle: "cold_reading" | "observation" | "value_first";
  message: string;
  principles_score: number;
  principles_hit: string[];
}
