"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Lead, MessageVariant } from "@/types/leads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Building2, ExternalLink, Globe, MapPin, Sparkles, User,
  Briefcase, Cpu, TrendingUp, MessageSquare, CheckCircle, Loader2, Copy, Search,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-secondary text-secondary-foreground" },
  enriched: { label: "Enriched", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  scored: { label: "Scored", className: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  message_ready: { label: "Message Ready", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  sent: { label: "Sent", className: "bg-[#00C4C8]/10 text-[#00C4C8]" },
  connected: { label: "Connected", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  replied: { label: "Replied", className: "bg-[#E560DF]/10 text-[#E560DF]" },
  converted: { label: "Converted", className: "bg-[#E560DF]/20 text-[#E560DF]" },
};

const TIER_CONFIG: Record<string, { className: string; bg: string }> = {
  HOT: { className: "text-red-600 dark:text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  WARM: { className: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  COLD: { className: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/10 border-sky-500/20" },
  SKIP: { className: "text-muted-foreground", bg: "bg-secondary border-border" },
};

function EnrichmentPanel({ title, icon: Icon, content, empty, accentBorder }: {
  title: string; icon: React.ElementType; content: string | null | undefined; empty?: string; accentBorder?: boolean;
}) {
  return (
    <Card className={`${accentBorder ? "border-l-[3px] border-l-[#00F0F4]" : ""} ${!content ? "border-dashed opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#00C4C8] dark:text-[#00F0F4]" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {content ? (
          <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{content}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">{empty || "Not enriched yet"}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MessageVariantCard({ variant, index, selected, onSelect }: {
  variant: MessageVariant; index: number; selected: boolean; onSelect: () => void;
}) {
  const angles = { cold_reading: "Cold Reading", observation: "Observation", value_first: "Value First" };

  return (
    <Card className={`transition-all duration-200 ${selected ? "ring-2 ring-[#00F0F4] border-[#00F0F4] shadow-md shadow-[#00F0F4]/10" : "hover:border-[#00C4C8]/40"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            {angles[variant.angle] || variant.angle}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono border-[#00C4C8]/30 text-[#00C4C8]">
              {variant.principles_score}/7
            </Badge>
            {selected && (
              <Badge className="bg-[#00F0F4] text-[#0A1628] text-[10px] font-semibold">Selected</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground/80 whitespace-pre-wrap mb-3 leading-relaxed">{variant.message}</p>
        {variant.principles_hit?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {variant.principles_hit.map((p) => (
              <Badge key={p} variant="outline" className="text-[10px] text-muted-foreground">
                {p}
              </Badge>
            ))}
          </div>
        )}
        {!selected && (
          <Button size="sm" variant="outline" onClick={onSelect} className="hover:border-[#00C4C8] hover:text-[#00C4C8]">
            Select this variant
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [findingLinkedin, setFindingLinkedin] = useState(false);

  useEffect(() => {
    const fetchLead = async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", params.id).single();
      if (error) console.error("Failed to fetch lead:", error);
      else setLead(data as Lead);
      setLoading(false);
    };
    fetchLead();
  }, [params.id]);

  const selectVariant = async (message: string) => {
    if (!lead) return;
    const { error } = await supabase
      .from("leads")
      .update({ selected_message: message, outreach_status: "message_ready" })
      .eq("id", lead.id);
    if (!error) setLead({ ...lead, selected_message: message, outreach_status: "message_ready" });
  };

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading lead...</div>;
  if (!lead) return <div className="py-20 text-center text-muted-foreground">Lead not found</div>;

  const techStack = lead.tech_stack ? (typeof lead.tech_stack === "string" ? JSON.parse(lead.tech_stack) : lead.tech_stack) : null;
  const hiringSignals = lead.hiring_signals ? (typeof lead.hiring_signals === "string" ? JSON.parse(lead.hiring_signals) : lead.hiring_signals) : null;
  const messageVariants: MessageVariant[] = lead.message_variants ? (typeof lead.message_variants === "string" ? JSON.parse(lead.message_variants) : lead.message_variants) : [];
  const statusCfg = STATUS_CONFIG[lead.outreach_status] || STATUS_CONFIG.new;
  const tierCfg = lead.icp_tier ? TIER_CONFIG[lead.icp_tier] : null;

  return (
    <div>
      {/* Back */}
      <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to pipeline
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {lead.full_name || `${lead.first_name} ${lead.last_name}`}
            </h1>
            {tierCfg && (
              <Badge variant="outline" className={`text-sm font-mono font-bold ${tierCfg.bg} ${tierCfg.className}`}>
                {lead.icp_tier} {lead.icp_score !== null && `(${lead.icp_score})`}
              </Badge>
            )}
            <Badge variant="secondary" className={statusCfg.className}>
              {statusCfg.label}
            </Badge>
          </div>
          <p className="text-muted-foreground">{lead.headline}</p>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {lead.company_name_casual && (
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> {lead.company_name_casual}
                {lead.company_headcount && ` · ${lead.company_headcount} employees`}
              </span>
            )}
            {lead.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> {lead.location}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {lead.linkedin_url && (
            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-1.5" /> LinkedIn
              </Button>
            </a>
          )}
          {lead.company_url && (
            <a href={lead.company_url.startsWith("http") ? lead.company_url : `https://${lead.company_url}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <Globe className="w-4 h-4 mr-1.5" /> Website
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Two-column enrichment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          {lead.summary && <EnrichmentPanel title="LinkedIn About" icon={User} content={lead.summary} accentBorder />}
          <EnrichmentPanel title="Person Research" icon={Sparkles} content={lead.person_research} empty="Run enrichment to research this person" accentBorder />
          <EnrichmentPanel title="Company Research" icon={TrendingUp} content={lead.company_research} empty="Run enrichment to research the company" />
        </div>

        <div className="space-y-4">
          <EnrichmentPanel title="Homepage Content" icon={Globe} content={lead.company_homepage_text} empty="Run enrichment to scrape website" />
          <EnrichmentPanel title="About Page" icon={Building2} content={lead.company_about_text} empty="No about page found" />

          {/* Tech Stack */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#00C4C8] dark:text-[#00F0F4]" /> Tech Stack
              </CardTitle>
            </CardHeader>
            <CardContent>
              {techStack && Array.isArray(techStack) && techStack.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {techStack.map((tech: string | Record<string, unknown>, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-[#00C4C8]/20 text-foreground/70">
                      {typeof tech === "string" ? tech : (tech as Record<string, string>).name || JSON.stringify(tech)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not enriched yet</p>
              )}
            </CardContent>
          </Card>

          {/* Hiring */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-[#00C4C8] dark:text-[#00F0F4]" /> Hiring Signals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hiringSignals && Array.isArray(hiringSignals) && hiringSignals.length > 0 ? (
                <ul className="space-y-1.5">
                  {hiringSignals.map((job: Record<string, string>, i: number) => (
                    <li key={i} className="text-sm text-foreground/80">
                      {job.title} {job.location && <span className="text-muted-foreground">— {job.location}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground italic">No recent hiring activity</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Messages */}
      {messageVariants.length > 0 && (
        <>
          <Separator className="my-8" />
          <div>
            <h2 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[#E560DF]" /> Outreach Messages
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Pick the variant that passes the Text Message Test
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {messageVariants.map((v, i) => (
                <MessageVariantCard
                  key={i} variant={v} index={i}
                  selected={lead.selected_message === v.message}
                  onSelect={() => selectVariant(v.message)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <Separator className="my-8" />
      <div className="flex gap-3 flex-wrap">
        {/* Find LinkedIn — show when lead has company but no person */}
        {(!lead.full_name || lead.linkedin_url?.startsWith("company:")) && lead.company_name && (
          <Button
            variant="outline"
            disabled={findingLinkedin}
            className="hover:border-[#E560DF] hover:text-[#E560DF] border-[#E560DF]/30"
            onClick={async () => {
              setFindingLinkedin(true);
              try {
                const resp = await fetch("/api/find-linkedin", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    lead_id: lead.id,
                    company_name: lead.company_name,
                    company_description: lead.company_description,
                  }),
                });
                const data = await resp.json();
                if (resp.ok && data.found) {
                  // Refresh lead data
                  const { data: refreshed } = await supabase
                    .from("leads").select("*").eq("id", lead.id).single();
                  if (refreshed) setLead(refreshed as Lead);
                  toast.success(`Found ${data.person_name || "contact"} — ${data.person_title || ""}`, { duration: 5000 });
                } else if (resp.ok && !data.found) {
                  toast.error("No LinkedIn profile found. Try Sales Navigator manually.");
                } else {
                  toast.error(data.error || "Search failed");
                }
              } catch { toast.error("Network error"); }
              setFindingLinkedin(false);
            }}
          >
            {findingLinkedin ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
            {findingLinkedin ? "Searching..." : "Find LinkedIn Profile"}
          </Button>
        )}

        <Button
          variant="outline"
          disabled={enriching}
          className="hover:border-[#00C4C8] hover:text-[#00C4C8]"
          onClick={async () => {
            setEnriching(true);
            try {
              const resp = await fetch("/api/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkedin_url: lead.linkedin_url }),
              });
              const data = await resp.json();
              if (resp.ok) {
                setLead(data.lead);
                toast.success(`Enriched — ICP: ${data.scoring.tier} (${data.scoring.total})`);
              } else {
                toast.error(data.error || "Enrichment failed");
              }
            } catch { toast.error("Network error"); }
            setEnriching(false);
          }}
        >
          {enriching ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
          {enriching ? "Enriching..." : "Re-enrich"}
        </Button>

        <Button
          variant="outline"
          disabled={generating || !lead.icp_score}
          className="hover:border-[#E560DF] hover:text-[#E560DF]"
          onClick={async () => {
            setGenerating(true);
            try {
              const resp = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lead_id: lead.id }),
              });
              const data = await resp.json();
              if (resp.ok) {
                setLead(data.lead);
                toast.success("3 message variants generated");
              } else {
                toast.error(data.error || "Generation failed");
              }
            } catch { toast.error("Network error"); }
            setGenerating(false);
          }}
        >
          {generating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-1.5" />}
          {generating ? "Generating..." : "Generate Messages"}
        </Button>

        {lead.selected_message && (
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(lead.selected_message || "");
              toast.success("Message copied to clipboard");
            }}
          >
            <Copy className="w-4 h-4 mr-1.5" /> Copy Message
          </Button>
        )}

        <Button
          disabled={!lead.selected_message}
          className="bg-[#0A1628] dark:bg-[#00F0F4] text-white dark:text-[#0A1628] hover:bg-[#142238] dark:hover:bg-[#00C4C8]"
        >
          <CheckCircle className="w-4 h-4 mr-1.5" /> Move to ClickUp
        </Button>
      </div>
    </div>
  );
}
