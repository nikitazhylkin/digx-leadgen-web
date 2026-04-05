"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Lead, OutreachStatus } from "@/types/leads";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpDown, ExternalLink, RefreshCw, Search, Users, Zap, Flame, MessageSquare,
} from "lucide-react";

const STATUS_CONFIG: Record<OutreachStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-secondary text-secondary-foreground" },
  enriched: { label: "Enriched", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  scored: { label: "Scored", className: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  message_ready: { label: "Message Ready", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  sent: { label: "Sent", className: "bg-[#00C4C8]/10 text-[#00C4C8]" },
  connected: { label: "Connected", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  replied: { label: "Replied", className: "bg-[#E560DF]/10 text-[#E560DF]" },
  converted: { label: "Converted", className: "bg-[#E560DF]/20 text-[#E560DF] font-semibold" },
};

const TIER_CONFIG: Record<string, { className: string }> = {
  HOT: { className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  WARM: { className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  COLD: { className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
  SKIP: { className: "bg-secondary text-muted-foreground border-border" },
};

function StatCard({ label, value, icon: Icon, accent }: {
  label: string; value: number; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? "bg-[#00F0F4]/10 dark:bg-[#00F0F4]/20" : "bg-secondary"}`}>
        <Icon className={`w-4 h-4 ${accent ? "text-[#00C4C8] dark:text-[#00F0F4]" : "text-muted-foreground"}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from("leads")
      .select("*")
      .order(sortField, { ascending: sortAsc })
      .limit(200);

    if (statusFilter !== "all") query = query.eq("outreach_status", statusFilter);
    if (tierFilter !== "all") query = query.eq("icp_tier", tierFilter);
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,company_name.ilike.%${search}%,company_name_casual.ilike.%${search}%,headline.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) console.error("Failed to fetch leads:", error);
    else setLeads((data as Lead[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchLeads(); }, [statusFilter, tierFilter, sortField, sortAsc]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchLeads(); };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const stats = {
    total: leads.length,
    enriched: leads.filter((l) => l.outreach_status !== "new").length,
    hot: leads.filter((l) => l.icp_tier === "HOT").length,
    messageReady: leads.filter((l) => l.outreach_status === "message_ready").length,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Lead Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enrich, score, and craft personalized outreach
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLeads} className="border-border">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <Button size="sm" className="bg-[#0A1628] dark:bg-[#00F0F4] text-white dark:text-[#0A1628] hover:bg-[#142238] dark:hover:bg-[#00C4C8]" onClick={() => router.push("/import")}>
            Import leads
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total leads" value={stats.total} icon={Users} />
        <StatCard label="Enriched" value={stats.enriched} icon={Zap} accent />
        <StatCard label="Hot leads" value={stats.hot} icon={Flame} />
        <StatCard label="Message ready" value={stats.messageReady} icon={MessageSquare} />
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 items-center">
        <form onSubmit={handleSearch} className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, company, title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
        </form>

        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-44 bg-card">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="scored">Scored</SelectItem>
            <SelectItem value="message_ready">Message ready</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="connected">Connected</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
          </SelectContent>
        </Select>

        <Select value={tierFilter} onValueChange={(v) => v && setTierFilter(v)}>
          <SelectTrigger className="w-36 bg-card">
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="HOT">HOT</SelectItem>
            <SelectItem value="WARM">WARM</SelectItem>
            <SelectItem value="COLD">COLD</SelectItem>
            <SelectItem value="SKIP">SKIP</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/50">
              <TableHead className="w-52">
                <button onClick={() => toggleSort("full_name")} className="flex items-center gap-1 font-semibold text-foreground">
                  Name <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </TableHead>
              <TableHead className="w-44">
                <button onClick={() => toggleSort("company_name_casual")} className="flex items-center gap-1 font-semibold text-foreground">
                  Company <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </TableHead>
              <TableHead className="w-44 font-semibold text-foreground">Title</TableHead>
              <TableHead className="w-24">
                <button onClick={() => toggleSort("icp_score")} className="flex items-center gap-1 font-semibold text-foreground">
                  ICP <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </TableHead>
              <TableHead className="w-32 font-semibold text-foreground">Status</TableHead>
              <TableHead className="w-28 font-semibold text-foreground">Location</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-[#00C4C8]" />
                    <span>Loading leads...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="w-8 h-8 text-muted-foreground/40" />
                    <span className="text-base">No leads yet</span>
                    <span className="text-sm">Import leads to get started</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => {
                const statusCfg = STATUS_CONFIG[lead.outreach_status] || STATUS_CONFIG.new;
                return (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => router.push(`/lead/${lead.id}`)}
                  >
                    <TableCell>
                      <span className="font-medium text-foreground">
                        {lead.full_name || `${lead.first_name} ${lead.last_name}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-foreground">{lead.company_name_casual || lead.company_name}</div>
                      {lead.company_headcount && (
                        <div className="text-xs text-muted-foreground">{lead.company_headcount} employees</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground truncate block max-w-[170px]">{lead.headline}</span>
                    </TableCell>
                    <TableCell>
                      {lead.icp_score !== null ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-mono font-bold text-foreground">{lead.icp_score}</span>
                          {lead.icp_tier && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${TIER_CONFIG[lead.icp_tier]?.className || ""}`}>
                              {lead.icp_tier}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[11px] ${statusCfg.className}`}>
                        {statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground truncate block max-w-[110px]">{lead.location}</span>
                    </TableCell>
                    <TableCell>
                      {lead.linkedin_url && (
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground hover:text-[#00C4C8] transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
