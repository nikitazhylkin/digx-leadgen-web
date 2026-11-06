"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn, leadDisplayName } from "@/lib/utils";
import type { Lead } from "@/types/leads";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LeadDrawer } from "@/components/lead-drawer";
import { StatusTimelineMini, InlineNotesCell, TooltipPrimitive } from "@/components/inline-cells";
import { CategoryPicker } from "@/components/category-picker";
import { getLeadAge } from "@/lib/sla";
import {
  ArrowUpDown, ExternalLink, RefreshCw, Search, Users, MessageSquare,
  Loader2, MoreHorizontal, Trash2, Eye, Sparkles, X, Columns3, Target,
  CheckCircle2, XCircle, RotateCcw, Check,
} from "lucide-react";

// Which columns are shown. Persisted in localStorage.
const ALL_COLUMNS = ["company", "category", "source", "title", "icp", "status", "aging", "location", "notes"] as const;
type ColumnKey = typeof ALL_COLUMNS[number];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  company: "Company", category: "Category", source: "Source", title: "Title",
  icp: "ICP Score", status: "Pipeline", aging: "Aging", location: "Location", notes: "Notes",
};
const DEFAULT_VISIBLE: Set<ColumnKey> = new Set(ALL_COLUMNS);

// All resizable column keys (includes name/actions which are always visible)
const RESIZABLE_KEYS = ["name", "company", "category", "source", "title", "icp", "status", "aging", "location", "notes", "actions"] as const;
type ResizableKey = typeof RESIZABLE_KEYS[number];
const DEFAULT_WIDTHS: Record<ResizableKey, number> = {
  name: 208, company: 176, category: 144, source: 116, title: 176, icp: 104,
  status: 160, aging: 128, location: 128, notes: 144, actions: 248,
};

// Source label + chip color mapping. Values come from the API routes:
// - "extension"          → extension/background.js (Sales Navigator scrape)
// - "manual"             → /api/enrich (single LinkedIn URL via /import page)
// - "csv_import"         → /api/import-sheet (general bulk sheet)
// - "alimentaria_sheet"  → /api/import-sheet (legacy specific sheet)
// Unknowns fall back to a muted badge with the raw value capitalised.
const SOURCE_LABELS: Record<string, string> = {
  extension: "Extension",
  manual: "Manual URL",
  csv_import: "CSV",
  alimentaria_sheet: "Alimentaria",
  linkedin_engagement: "Engagement",
  sales_navigator: "Sales Nav",
};
const SOURCE_COLORS: Record<string, string> = {
  extension: "bg-[#00C4C8]/15 text-[#00C4C8] border-[#00C4C8]/30",
  manual: "bg-secondary/60 text-foreground border-border",
  csv_import: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  alimentaria_sheet: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  linkedin_engagement: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  sales_navigator: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};
function sourceLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return SOURCE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}
function sourceColor(s: string | null | undefined): string {
  if (!s) return "bg-secondary/40 text-muted-foreground border-border";
  return SOURCE_COLORS[s] ?? "bg-secondary/60 text-foreground border-border";
}
const MIN_COL_WIDTH = 64;
const MAX_COL_WIDTH = 600;

// Quick-reject reasons — shown inline in the row-level Reject dropdown for
// fast 2-click rejection with learning signal captured. "Other…" opens the
// full dialog for custom free-text context.
const QUICK_REJECT_REASONS = [
  "Wrong industry",
  "Wrong role / title",
  "Wrong company size",
  "Wrong geography",
  "Wrong stage (too early)", // a teammate 2026-04-23: company not ready to buy yet
  "Not an ICP match",
  "Competitor",
  "Already a customer",
  "Bad data quality",
];

// STATUS_CONFIG was removed — pipeline stage is now rendered by <StatusTimelineMini />.
// Only the tier badge config remains here (used in the ICP column).
const TIER_CONFIG: Record<string, { className: string }> = {
  HOT: { className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  WARM: { className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  COLD: { className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
  SKIP: { className: "bg-secondary text-muted-foreground border-border" },
};

// Header cell with a right-edge resize handle. Width is passed via inline style
// (not Tailwind class) so it can update dynamically during drag.
function ResizableHead({ widthPx, onResize, children }: {
  widthPx: number;
  onResize: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      className="relative group/resize"
      style={{ width: widthPx, minWidth: 64 }}
    >
      {children}
      <span
        onMouseDown={onResize}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[#00C4C8]/60 group-hover/resize:bg-[#00C4C8]/30 transition-colors"
        role="separator"
        aria-label="Resize column"
      />
    </TableHead>
  );
}

// Concurrency-limited async map so we don't hammer the APIs
async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = e as R; }
    }
  });
  await Promise.all(workers);
  return results;
}

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [industriesLoaded, setIndustriesLoaded] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [sortField, setSortField] = useState<string>("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  // Pipeline tab — which qualification state we're looking at
  type PipelineTab = "review" | "approved" | "rejected" | "active" | "all";
  const [tab, setTab] = useState<PipelineTab>("review");
  const [tabCounts, setTabCounts] = useState<Record<PipelineTab, number>>({ review: 0, approved: 0, rejected: 0, active: 0, all: 0 });

  // Pagination
  type PageSize = 25 | 50 | 100 | 250 | "all";
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [page, setPage] = useState(1);

  // Selection + row-level action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Map<string, "enriching" | "generating" | "deleting">>(new Map());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number; failed: number } | null>(null);

  // Drawer
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  // Reject dialog — captures reason for learning. Applies to single lead or bulk.
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; kind: "single" | "bulk"; leadId?: string }>({ open: false, kind: "bulk" });
  const [rejectReason, setRejectReason] = useState<string>("");
  const [rejectNotes, setRejectNotes] = useState<string>("");
  const REJECT_REASONS = [
    "Wrong industry",
    "Wrong role / title",
    "Wrong company size",
    "Wrong geography",
    "Too junior / too senior",
    "Not an ICP match",
    "Competitor",
    "Already a customer",
    "Bad data quality",
    "Other",
  ];

  // Column visibility (persisted)
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(DEFAULT_VISIBLE);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("digx.visibleColumns");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setVisibleColumns(new Set(arr.filter((k): k is ColumnKey => ALL_COLUMNS.includes(k as ColumnKey))));
      }
    } catch { /* ignore */ }
  }, []);
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("digx.visibleColumns", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  };
  const colVisible = (key: ColumnKey) => visibleColumns.has(key);

  // Column widths (resizable, persisted)
  const [columnWidths, setColumnWidths] = useState<Record<ResizableKey, number>>(DEFAULT_WIDTHS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("digx.columnWidths");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        setColumnWidths((prev) => ({ ...prev, ...parsed }));
      }
    } catch { /* ignore */ }
  }, []);
  const widthOf = (key: ResizableKey) => columnWidths[key] ?? DEFAULT_WIDTHS[key];
  const startResize = (e: React.MouseEvent, key: ResizableKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(key);
    const move = (ev: MouseEvent) => {
      const next = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX)));
      setColumnWidths((prev) => ({ ...prev, [key]: next }));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      setColumnWidths((prev) => {
        try { localStorage.setItem("digx.columnWidths", JSON.stringify(prev)); } catch { /* ignore */ }
        return prev;
      });
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    // Narrow column list — the table view doesn't need the multi-KB enrichment
    // text fields (company_website_text, person_research, company_research,
    // tech_stack, hiring_signals, proof_points, message_variants, summary, etc).
    // Drawer fetches the full row separately when opened. Cuts payload ~10-50x.
    const TABLE_COLUMNS = [
      "id", "created_at", "updated_at", "linkedin_url",
      "first_name", "last_name", "full_name", "headline", "location",
      "company_name", "company_name_casual", "company_url", "company_linkedin_url",
      "company_industry",
      "icp_score", "icp_tier",
      "outreach_status", "qualification", "rejection_reason",
      "qualified_at", "qualified_by",
      "request_sent_at", "connection_accepted_at",
      // sent_at / replied_at / clickup_task_id power the Aging column SLAs.
      // message_variants is needed to detect "enriched but no message yet" rows.
      "sent_at", "replied_at", "clickup_task_id", "message_variants",
      "enrichment_completeness", "enrichment_error",
      "category", "notes",
      "source",
    ].join(", ");
    let query = supabase
      .from("leads")
      .select(TABLE_COLUMNS, { count: "exact" })
      .order(sortField, { ascending: sortAsc });

    // Tab (qualification gate) — exclusive view per pipeline stage
    // 2026-04-23 reorder: approve now also flips outreach_status to 'request_sent'.
    // The Approved tab shows leads awaiting acceptance (request_sent), and the
    // Active tab covers everything post-acceptance (connected → replied).
    if (tab === "review") query = query.is("qualification", null).in("outreach_status", ["new", "enriched", "scored"]);
    else if (tab === "approved") query = query.eq("qualification", "approved").in("outreach_status", ["new", "scored", "request_sent"]);
    else if (tab === "rejected") query = query.eq("qualification", "rejected");
    else if (tab === "active") query = query.in("outreach_status", ["connected", "enriched", "message_ready", "messaged", "sent", "replied", "converted"]);
    // "all" — no tab filter

    if (statusFilter !== "all") query = query.eq("outreach_status", statusFilter);
    if (tierFilter !== "all") query = query.eq("icp_tier", tierFilter);
    if (categoryFilter !== "all") {
      if (categoryFilter === "__uncategorized__") query = query.is("category", null);
      else query = query.eq("category", categoryFilter);
    }
    if (industryFilter !== "all") {
      if (industryFilter === "__unknown__") query = query.is("company_industry", null);
      else query = query.eq("company_industry", industryFilter);
    }
    if (sourceFilter !== "all") {
      if (sourceFilter === "__unknown__") query = query.is("source", null);
      else query = query.eq("source", sourceFilter);
    }
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,company_name.ilike.%${search}%,company_name_casual.ilike.%${search}%,headline.ilike.%${search}%`
      );
    }

    // Pagination via Supabase .range(from, to) — inclusive. "all" = cap at 10k.
    const effectivePageSize = pageSize === "all" ? 10000 : pageSize;
    const from = (page - 1) * effectivePageSize;
    const to = from + effectivePageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) {
      console.error("Failed to fetch leads:", error);
      toast.error("Failed to load leads");
    } else {
      setLeads((data as unknown as Lead[]) || []);
      setTotalCount(count ?? (data?.length ?? 0));
    }
    setLoading(false);
  }, [sortField, sortAsc, statusFilter, tierFilter, categoryFilter, industryFilter, sourceFilter, search, tab, pageSize, page]);

  // Apply an optimistic delta to tabCounts for a qualification transition.
  // Source/target are the qualification values (null|'approved'|'rejected').
  // Reconciliation happens automatically when loadTabCounts() resolves.
  const applyQualificationDelta = useCallback(
    (oldQ: "approved" | "rejected" | null, newQ: "approved" | "rejected" | null, count = 1) => {
      if (oldQ === newQ) return;
      setTabCounts((tc) => {
        const next = { ...tc };
        const dec = (k: PipelineTab) => { next[k] = Math.max(0, next[k] - count); };
        const inc = (k: PipelineTab) => { next[k] = next[k] + count; };
        if (oldQ === null) dec("review");
        else if (oldQ === "approved") dec("approved");
        else if (oldQ === "rejected") dec("rejected");
        if (newQ === null) inc("review");
        else if (newQ === "approved") inc("approved");
        else if (newQ === "rejected") inc("rejected");
        return next;
      });
    },
    [],
  );

  // Load per-tab counts. One head-only query per tab in parallel.
  const loadTabCounts = useCallback(async () => {
    // "qualifiedOutreach" = leads either awaiting review OR approved but not yet accepted.
    // Includes 'request_sent' so the Approved tab count reflects leads waiting on acceptance.
    const qualifiedOutreach = ["new", "scored", "request_sent"];
    // "activeOutreach" = post-acceptance leads (connected onward). Enrichment now lives
    // here, after the target actually connects — matches a teammate's flow.
    const activeOutreach = ["connected", "enriched", "message_ready", "messaged", "sent", "replied", "converted"];
    const [review, approved, rejected, active, all] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).is("qualification", null).in("outreach_status", qualifiedOutreach),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("qualification", "approved").in("outreach_status", qualifiedOutreach),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("qualification", "rejected"),
      supabase.from("leads").select("id", { count: "exact", head: true }).in("outreach_status", activeOutreach),
      supabase.from("leads").select("id", { count: "exact", head: true }),
    ]);
    setTabCounts({
      review: review.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      active: active.count ?? 0,
      all: all.count ?? 0,
    });
  }, []);

  // Load distinct categories for the filter dropdown
  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("category")
      .not("category", "is", null);
    if (error) return;
    const unique = Array.from(new Set((data || []).map((r) => r.category as string).filter(Boolean))).sort();
    setCategories(unique);
    setCategoriesLoaded(true);
  }, []);

  const ensureCategories = useCallback(() => {
    if (categoriesLoaded) return;
    loadCategories();
  }, [categoriesLoaded, loadCategories]);

  // Load distinct industries (LinkedIn's company_industry taxonomy — a teammate uses this to
  // skip verticals she doesn't want to work with, e.g. Beverage Manufacturing).
  const loadIndustries = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("company_industry")
      .not("company_industry", "is", null);
    if (error) return;
    const unique = Array.from(new Set((data || []).map((r) => r.company_industry as string).filter(Boolean))).sort();
    setIndustries(unique);
    setIndustriesLoaded(true);
  }, []);

  const ensureIndustries = useCallback(() => {
    if (industriesLoaded) return;
    loadIndustries();
  }, [industriesLoaded, loadIndustries]);

  // Load distinct source values for the filter dropdown. Lazy-loaded on first
  // dropdown open (same pattern as categories + industries) — most users
  // never open this filter.
  const loadSources = useCallback(async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("source")
      .not("source", "is", null);
    if (error) return;
    const unique = Array.from(new Set((data || []).map((r) => r.source as string).filter(Boolean))).sort();
    setSources(unique);
    setSourcesLoaded(true);
  }, []);

  const ensureSources = useCallback(() => {
    if (sourcesLoaded) return;
    loadSources();
  }, [sourcesLoaded, loadSources]);

  useEffect(() => { fetchLeads(); }, [statusFilter, tierFilter, categoryFilter, sortField, sortAsc, tab, pageSize, page, fetchLeads]);
  // categories + industries are lazy-loaded — they each do a full-table scan,
  // and most users never open those filters. Triggered by the dropdown's onOpenChange.
  useEffect(() => { loadTabCounts(); }, [loadTabCounts]);

  // Reset to page 1 whenever tab or filters change.
  useEffect(() => { setPage(1); }, [tab, statusFilter, tierFilter, categoryFilter, industryFilter, sourceFilter, pageSize, search]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchLeads(); };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  // — Selection helpers —
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length;
  const headerChecked: boolean | "indeterminate" = allSelected ? true : (someSelected ? "indeterminate" : false);

  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(leads.map((l) => l.id)));
    else setSelectedIds(new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // — Row-level busy helpers —
  const markBusy = (id: string, state: "enriching" | "generating" | "deleting") => {
    setBusyIds((prev) => { const next = new Map(prev); next.set(id, state); return next; });
  };
  const clearBusy = (id: string) => {
    setBusyIds((prev) => { const next = new Map(prev); next.delete(id); return next; });
  };

  // — Actions —
  const enrichOne = async (lead: Lead): Promise<boolean> => {
    if (!lead.linkedin_url) {
      toast.error(`${lead.full_name}: no LinkedIn URL`);
      return false;
    }
    markBusy(lead.id, "enriching");
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: lead.linkedin_url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Enrich failed: ${data.error ?? res.status}`);
        return false;
      }
      // Merge the updated lead into state
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? (data.lead as Lead) : l)));
      return true;
    } catch (err) {
      toast.error(`Enrich failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      clearBusy(lead.id);
    }
  };

  const generateOne = async (lead: Lead): Promise<boolean> => {
    markBusy(lead.id, "generating");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Generate failed: ${data.error ?? res.status}`);
        return false;
      }
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? (data.lead as Lead) : l)));
      return true;
    } catch (err) {
      toast.error(`Generate failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      clearBusy(lead.id);
    }
  };

  // Row-level "Mark as connected" — fires when we see the target accept on LinkedIn.
  // Flips outreach_status to 'connected' + auto-triggers /api/enrich (fire-and-forget).
  // Message auto-generation fires after enrichment completes. Drawer has richer version;
  // this row-level one keeps UI feedback minimal.
  const markConnected = async (lead: Lead) => {
    markBusy(lead.id, "enriching");
    try {
      const now = new Date().toISOString();
      const { data: upd, error } = await supabase.from("leads").update({
        outreach_status: "connected",
        connection_accepted_at: now,
      }).eq("id", lead.id).select().single();
      if (error) { toast.error(`Failed: ${error.message}`); return; }
      setLeads((prev) => prev.map((l) => l.id === lead.id ? (upd as Lead) : l));
      toast.success(`${lead.full_name || "Lead"} — auto-enriching…`);

      // Fire-and-forget enrich + generate cascade. Don't block the UI.
      fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: lead.linkedin_url }),
      }).then(async (r) => {
        const d = await r.json();
        if (r.ok && d.lead) {
          setLeads((prev) => prev.map((l) => l.id === lead.id ? (d.lead as Lead) : l));
          // Chain auto-generate
          fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_id: lead.id }),
          }).then(async (r2) => {
            const d2 = await r2.json();
            if (r2.ok && d2.lead) {
              setLeads((prev) => prev.map((l) => l.id === lead.id ? (d2.lead as Lead) : l));
              toast.success(`${lead.full_name} — message draft ready`);
            }
          });
        } else {
          toast.error(`Enrich failed for ${lead.full_name}: ${d.error ?? r.status}`);
        }
      });
    } finally {
      clearBusy(lead.id);
    }
  };

  // Manual qualification — POSTs to /api/qualify which writes the qualification
  // fields AND, on Approve, fires the full enrichment pipeline (Apify + Perplexity
  // + TheirStack + scoring) server-side. We optimistically flip the row + tab
  // counts immediately, then merge the enriched response when it lands.
  const qualify = async (lead: Lead, qualification: "approved" | "rejected" | null, reason?: string): Promise<boolean> => {
    // Optimistic tabCounts delta — flips badges instantly. Reconciled by
    // loadTabCounts() at the end of this function (~200-500ms later).
    const oldQ = lead.qualification;
    applyQualificationDelta(oldQ, qualification);

    if (qualification === "approved") markBusy(lead.id, "enriching");

    const res = await fetch("/api/qualify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, qualification, rejection_reason: reason ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (qualification === "approved") clearBusy(lead.id);

    if (!res.ok) {
      applyQualificationDelta(qualification, oldQ);
      toast.error(`Qualification failed: ${data.error ?? res.status}`);
      return false;
    }

    const updated = data.lead as Lead;
    const stillMatches = (
      (tab === "review" && qualification === null) ||
      (tab === "approved" && qualification === "approved") ||
      (tab === "rejected" && qualification === "rejected") ||
      (tab === "active" || tab === "all")
    );

    if (stillMatches) {
      setLeads((prev) => prev.map((l) => l.id === lead.id ? updated : l));
    } else {
      // Update row in place first so the dropdown menu has a stable anchor while closing,
      // then remove the row on the next tick. This dodges a base-ui focus-return crash
      // where the Popover tries to return focus to a trigger inside a just-unmounted row.
      setLeads((prev) => prev.map((l) => l.id === lead.id ? updated : l));
      setTimeout(() => {
        setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      }, 180);
    }
    loadTabCounts();
    return true;
  };

  const deleteOne = async (lead: Lead): Promise<boolean> => {
    markBusy(lead.id, "deleting");
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`Delete failed: ${data.error ?? res.status}`);
        return false;
      }
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(lead.id); return next; });
      return true;
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      clearBusy(lead.id);
    }
  };

  // — Bulk actions —
  const bulkEnrich = async () => {
    const targets = leads.filter((l) => selectedIds.has(l.id));
    if (targets.length === 0) return;
    // Cost estimate based on Proxycurl ($0.02) + Perplexity (~$0.015 for 2 queries) + TheirStack (~$0.017) ≈ $0.06/lead
    const estCost = (targets.length * 0.06).toFixed(2);
    const hotWarmCount = targets.filter((l) => l.icp_tier === "HOT" || l.icp_tier === "WARM").length;
    const skipColdCount = targets.length - hotWarmCount;
    const warning = skipColdCount > 0
      ? `\n\n⚠️ ${skipColdCount} of ${targets.length} are COLD/SKIP or unscored. Consider: "Score" first (free) → filter HOT/WARM → enrich winners only.`
      : "";
    if (!confirm(`Enrich ${targets.length} leads?\n\nEst. cost: ~$${estCost} (Proxycurl + Perplexity + TheirStack)${warning}`)) return;

    setBulkBusy(true);
    setBulkProgress({ done: 0, total: targets.length, ok: 0, failed: 0 });
    const toastId = toast.loading(`Enriching 0/${targets.length} leads...`);

    // Live progress: each completion updates the toast
    let done = 0, ok = 0, failed = 0;
    const results = await pMap(targets, 3, async (lead) => {
      const success = await enrichOne(lead);
      done++;
      if (success) ok++; else failed++;
      setBulkProgress({ done, total: targets.length, ok, failed });
      toast.loading(`Enriching ${done}/${targets.length}... (${ok} done, ${failed} failed)`, { id: toastId });
      return success;
    });

    setBulkBusy(false);
    setBulkProgress(null);
    const okCount = results.filter(Boolean).length;
    const failedCount = results.length - okCount;
    toast.dismiss(toastId);
    if (failedCount === 0) toast.success(`Enriched ${okCount}/${targets.length} leads`);
    else toast.error(`Done: ${okCount} enriched, ${failedCount} failed`);
  };

  const bulkAssignCategory = async (category: string | null) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    // PostgREST's `.in("id", [...])` builds the filter into the query string and
    // rejects URLs over ~8KB. 857 UUIDs already blow past that. Chunk the update.
    const CHUNK = 200;
    setBulkProgress({ done: 0, total: ids.length, ok: 0, failed: 0 });
    const toastId = toast.loading(`Tagging 0/${ids.length} leads...`);
    let ok = 0, failed = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase.from("leads").update({ category }).in("id", slice);
        if (error) { failed += slice.length; } else { ok += slice.length; }
        setBulkProgress({ done: i + slice.length, total: ids.length, ok, failed });
        toast.loading(`Tagging ${i + slice.length}/${ids.length}... (${ok} done, ${failed} failed)`, { id: toastId });
      }
      if (failed === 0) {
        setLeads((prev) => prev.map((l) => selectedIds.has(l.id) ? { ...l, category } : l));
        toast.success(category ? `Tagged ${ok} leads as "${category}"` : `Cleared category on ${ok} leads`, { id: toastId });
        loadCategories();
      } else if (ok > 0) {
        toast.error(`Partial: ${ok} tagged, ${failed} failed`, { id: toastId });
        loadCategories();
      } else {
        toast.error(`Category update failed on all ${failed} leads`, { id: toastId });
      }
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  };

  const scoreOne = async (lead: Lead): Promise<boolean> => {
    markBusy(lead.id, "enriching"); // reuse the spinner state label
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Score failed: ${data.error ?? res.status}`);
        return false;
      }
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? (data.lead as Lead) : l)));
      return true;
    } catch (err) {
      toast.error(`Score failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      clearBusy(lead.id);
    }
  };

  const bulkScore = async () => {
    const targets = leads.filter((l) => selectedIds.has(l.id));
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: targets.length, ok: 0, failed: 0 });
    const toastId = toast.loading(`Scoring 0/${targets.length} leads...`);
    let done = 0, ok = 0, failed = 0;
    const results = await pMap(targets, 5, async (lead) => {
      const success = await scoreOne(lead);
      done++;
      if (success) ok++; else failed++;
      setBulkProgress({ done, total: targets.length, ok, failed });
      toast.loading(`Scoring ${done}/${targets.length}... (${ok} done, ${failed} failed)`, { id: toastId });
      return success;
    });
    setBulkBusy(false);
    setBulkProgress(null);
    const okCount = results.filter(Boolean).length;
    toast.dismiss(toastId);
    if (okCount === targets.length) toast.success(`Scored ${okCount} leads`);
    else toast.error(`Done: ${okCount} scored, ${targets.length - okCount} failed`);
  };

  // Re-score ALL visible leads with the new scorer. No API cost (deterministic).
  const rescoreAll = async () => {
    if (leads.length === 0) return;
    const total = leads.length;
    if (!confirm(`Re-score all ${total} visible leads with the current scorer? This is free (no API calls).`)) return;
    setBulkBusy(true);
    setBulkProgress({ done: 0, total, ok: 0, failed: 0 });
    const toastId = toast.loading(`Re-scoring 0/${total}...`);
    let done = 0, ok = 0, failed = 0;
    await pMap(leads, 10, async (lead) => {
      const success = await scoreOne(lead);
      done++;
      if (success) ok++; else failed++;
      setBulkProgress({ done, total, ok, failed });
      toast.loading(`Re-scoring ${done}/${total}... (${ok} done, ${failed} failed)`, { id: toastId });
      return success;
    });
    setBulkBusy(false);
    setBulkProgress(null);
    toast.dismiss(toastId);
    toast.success(`Re-scored ${ok}/${total} leads`);
  };

  const bulkQualify = async (qualification: "approved" | "rejected", reason?: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);

    // Snapshot the old qualifications so we can apply the right optimistic delta
    // (each lead may have been at a different qualification — review/approved/rejected).
    const oldQuals = leads.filter((l) => selectedIds.has(l.id)).reduce(
      (acc, l) => { acc[l.qualification ?? "null"] = (acc[l.qualification ?? "null"] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    // Apply the optimistic delta in one pass, grouped by old qualification.
    Object.entries(oldQuals).forEach(([oldQ, count]) => {
      const oldVal = oldQ === "null" ? null : (oldQ as "approved" | "rejected");
      applyQualificationDelta(oldVal, qualification, count);
    });

    try {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        qualification,
        qualified_at: now,
        qualified_by: userEmail,
        rejection_reason: qualification === "rejected" ? (reason || null) : null,
      };
      // Bulk approve = bulk connection-request-sent. Same semantic as single approve.
      if (qualification === "approved") {
        patch.outreach_status = "request_sent";
        patch.request_sent_at = now;
      }
      // Chunk to stay under PostgREST's ~8KB URL limit on `in.(...)` filters
      const CHUNK = 200;
      let anyError: string | null = null;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase.from("leads").update(patch).in("id", slice);
        if (error) { anyError = error.message; break; }
      }
      if (anyError) {
        // Roll back the optimistic delta on failure
        Object.entries(oldQuals).forEach(([oldQ, count]) => {
          const oldVal = oldQ === "null" ? null : (oldQ as "approved" | "rejected");
          applyQualificationDelta(qualification, oldVal, count);
        });
        toast.error(`Qualification failed: ${anyError}`);
        return;
      }

      // Remove from view if tab no longer matches
      setLeads((prev) => prev.filter((l) => {
        if (!selectedIds.has(l.id)) return true;
        if (tab === "review") return false; // qualified leads leave review tab
        if (tab === "approved" && qualification !== "approved") return false;
        if (tab === "rejected" && qualification !== "rejected") return false;
        return true;
      }));
      clearSelection();
      loadTabCounts();
      toast.success(
        qualification === "approved"
          ? `Approved ${ids.length} leads — ready to enrich`
          : `Rejected ${ids.length} leads${reason ? ` (${reason})` : ""}`
      );
    } finally { setBulkBusy(false); }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} leads? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Bulk delete failed: ${data.error ?? res.status}`);
      } else {
        setLeads((prev) => prev.filter((l) => !selectedIds.has(l.id)));
        clearSelection();
        toast.success(`Deleted ${data.deleted} leads`);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <TooltipPrimitive.Provider delay={200} closeDelay={100}>
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
          <Button
            variant="outline"
            size="sm"
            onClick={rescoreAll}
            disabled={bulkBusy || leads.length === 0}
            className="border-border"
            title="Re-score all visible leads with the current scorer (free)"
          >
            <Target className="w-4 h-4 mr-1.5" />
            Re-score all
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLeads} className="border-border">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <Button size="sm" className="bg-[#0A1628] dark:bg-[#00F0F4] text-white dark:text-[#0A1628] hover:bg-[#142238] dark:hover:bg-[#00C4C8]" onClick={() => router.push("/import")}>
            Import leads
          </Button>
        </div>
      </div>

      {/* Pipeline tabs — stage 1: review / approved / rejected / active */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {([
          { id: "review" as const, label: "To review", hint: "Manually qualify before enriching" },
          { id: "approved" as const, label: "Approved", hint: "Ready to enrich" },
          { id: "rejected" as const, label: "Rejected", hint: "Archive + learning data" },
          { id: "active" as const, label: "Active outreach", hint: "Message, sent, connected, replied" },
          { id: "all" as const, label: "All", hint: "Everything in the DB" },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); clearSelection(); }}
            title={t.hint}
            className={[
              "px-4 py-2 text-sm transition-colors relative -mb-px border-b-2 flex items-center gap-2",
              tab === t.id
                ? "border-[#00C4C8] text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
            <span className={[
              "text-[10px] px-1.5 py-0.5 rounded-full tabular-nums font-medium min-w-[20px] text-center",
              tab === t.id ? "bg-[#00C4C8]/20 text-[#00C4C8]" : "bg-secondary/60 text-muted-foreground",
            ].join(" ")}>
              {tabCounts[t.id]}
            </span>
          </button>
        ))}
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

        <LabeledSelect
          label="Status"
          value={statusFilter}
          onValueChange={setStatusFilter}
          width="w-48"
          options={[
            { value: "all", label: "All" },
            { value: "new", label: "New" },
            { value: "enriched", label: "Enriched" },
            { value: "scored", label: "Scored" },
            { value: "message_ready", label: "Message ready" },
            { value: "sent", label: "Sent" },
            { value: "connected", label: "Connected" },
            { value: "replied", label: "Replied" },
          ]}
        />

        <LabeledSelect
          label="Tier"
          value={tierFilter}
          onValueChange={setTierFilter}
          width="w-40"
          options={[
            { value: "all", label: "All" },
            { value: "HOT", label: "HOT" },
            { value: "WARM", label: "WARM" },
            { value: "COLD", label: "COLD" },
            { value: "SKIP", label: "SKIP" },
          ]}
        />

        <LabeledSelect
          label="Category"
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          onOpenChange={(open) => { if (open) ensureCategories(); }}
          width="w-56"
          options={[
            { value: "all", label: "All" },
            { value: "__uncategorized__", label: "Uncategorized" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />

        <LabeledSelect
          label="Industry"
          value={industryFilter}
          onValueChange={setIndustryFilter}
          onOpenChange={(open) => { if (open) ensureIndustries(); }}
          width="w-56"
          options={[
            { value: "all", label: "All" },
            { value: "__unknown__", label: "Unknown" },
            ...industries.map((i) => ({ value: i, label: i })),
          ]}
        />

        <LabeledSelect
          label="Source"
          value={sourceFilter}
          onValueChange={setSourceFilter}
          onOpenChange={(open) => { if (open) ensureSources(); }}
          width="w-48"
          options={[
            { value: "all", label: "All" },
            { value: "__unknown__", label: "Unknown" },
            ...sources.map((s) => ({ value: s, label: sourceLabel(s) })),
          ]}
        />

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center h-9 px-3 text-sm border border-border rounded-md bg-card hover:bg-accent transition-colors">
            <Columns3 className="w-4 h-4 mr-1.5" />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_COLUMNS.map((key) => {
              const shown = visibleColumns.has(key);
              return (
                <DropdownMenuItem
                  key={key}
                  closeOnClick={false}
                  onClick={(e) => {
                    e.preventDefault();
                    toggleColumn(key);
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{COLUMN_LABELS[key]}</span>
                  {shown && <Check className="w-3.5 h-3.5 text-[#00C4C8]" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Workflow hint — only shown on the Review tab when nothing is selected.
          Reflects the connection-first flow: approve → wait for accept → auto-enrich. */}
      {selectedCount === 0 && tab === "review" && leads.length > 0 && (
        <div className="flex items-center gap-2.5 mb-3 px-4 py-2 rounded-lg bg-[#00C4C8]/5 border border-[#00C4C8]/20 text-xs text-foreground">
          <Sparkles className="w-3.5 h-3.5 text-[#00C4C8] shrink-0" />
          <span>
            <b>Flow:</b> approve ICP matches → send the LinkedIn request → mark connected on accept → drawer auto-enriches and drafts a message.
          </span>
        </div>
      )}

      {/* Bulk action toolbar — appears when rows are selected */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg bg-[#0A1628] dark:bg-[#00C4C8]/10 border border-[#00C4C8]/40 dark:border-[#00C4C8]/30 shadow-sm">
          <span className="text-sm font-medium text-white dark:text-[#00F0F4]">
            {selectedCount} selected
          </span>
          {bulkProgress && (
            <span className="text-xs text-[#00F0F4] dark:text-[#00F0F4] tabular-nums">
              {bulkProgress.done}/{bulkProgress.total} · ✓ {bulkProgress.ok} · ✗ {bulkProgress.failed}
            </span>
          )}
          <div className="h-4 w-px bg-white/20 dark:bg-[#00C4C8]/30" />
          {/* Approve + Reject — primary when in "review" tab (Phase 1 of pipeline) */}
          {(tab === "review" || tab === "all") && (
            <>
              <Button
                size="sm"
                onClick={() => bulkQualify("approved")}
                disabled={bulkBusy}
                className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 h-7 px-3 rounded-lg text-sm font-medium shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Approve {selectedCount}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={bulkBusy}
                  className="h-7 px-3 bg-red-500 hover:bg-red-600 text-white border-0 rounded-lg text-sm font-medium inline-flex items-center shadow-sm disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />
                  Reject {selectedCount}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Why reject all {selectedCount}? (for learning)
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {QUICK_REJECT_REASONS.map((r) => (
                    <DropdownMenuItem key={r} onClick={() => bulkQualify("rejected", r)}>
                      {r}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setRejectDialog({ open: true, kind: "bulk" })}>
                    Other (custom reason)…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="h-4 w-px bg-white/20 dark:bg-[#00C4C8]/30" />
            </>
          )}
          {/* Pipeline / metadata actions — identical ghost treatment for visual consistency */}
          <Button
            size="sm"
            variant="outline"
            onClick={bulkEnrich}
            disabled={bulkBusy}
            className="h-7 px-3 text-sm font-medium rounded-lg border-[#00C4C8]/40 text-[#00F0F4] hover:bg-[#00C4C8]/20 hover:text-[#00F0F4]"
            title={tab !== "approved" ? "Tip: enrich only Approved leads to save API credits" : undefined}
          >
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            Enrich {selectedCount}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={bulkScore}
            disabled={bulkBusy}
            className="h-7 px-3 text-sm font-medium rounded-lg border-[#00C4C8]/40 text-[#00F0F4] hover:bg-[#00C4C8]/20 hover:text-[#00F0F4]"
          >
            <Target className="w-3.5 h-3.5 mr-1.5" />
            Score {selectedCount}
          </Button>
          <CategoryPicker
            value={null}
            categories={categories}
            onChange={(next) => bulkAssignCategory(next)}
            variant="button"
            label={`Tag ${selectedCount}`}
            disabled={bulkBusy}
          />
          <div className="h-4 w-px bg-white/20 dark:bg-[#00C4C8]/30" />
          {/* Destructive — icon-only, sits apart from operation buttons */}
          <Button
            size="sm"
            variant="outline"
            onClick={bulkDelete}
            disabled={bulkBusy}
            className="h-7 w-7 p-0 border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-600"
            title={`Delete ${selectedCount} leads`}
            aria-label={`Delete ${selectedCount} leads`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <div className="flex-1" />
          <button
            onClick={clearSelection}
            className="text-xs text-white/70 dark:text-[#00F0F4]/70 hover:text-white dark:hover:text-[#00F0F4] flex items-center gap-1"
            disabled={bulkBusy}
          >
            <X className="w-3 h-3" />
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <Table style={{ tableLayout: "fixed" }}>
          <TableHeader>
            <TableRow className="bg-secondary/50 dark:bg-secondary/30 hover:bg-secondary/50">
              <TableHead className="w-8 pl-4" style={{ width: 32, minWidth: 32 }}>
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <ResizableHead widthPx={widthOf("name")} onResize={(e) => startResize(e, "name")}>
                <button onClick={() => toggleSort("full_name")} className="flex items-center gap-1 font-semibold text-foreground">
                  Name <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </ResizableHead>
              {colVisible("company") && (
                <ResizableHead widthPx={widthOf("company")} onResize={(e) => startResize(e, "company")}>
                  <button onClick={() => toggleSort("company_name_casual")} className="flex items-center gap-1 font-semibold text-foreground">
                    Company <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                </ResizableHead>
              )}
              {colVisible("category") && (
                <ResizableHead widthPx={widthOf("category")} onResize={(e) => startResize(e, "category")}>
                  <span className="font-semibold text-foreground">Category</span>
                </ResizableHead>
              )}
              {colVisible("source") && (
                <ResizableHead widthPx={widthOf("source")} onResize={(e) => startResize(e, "source")}>
                  <span className="font-semibold text-foreground">Source</span>
                </ResizableHead>
              )}
              {colVisible("title") && (
                <ResizableHead widthPx={widthOf("title")} onResize={(e) => startResize(e, "title")}>
                  <span className="font-semibold text-foreground">Title</span>
                </ResizableHead>
              )}
              {colVisible("icp") && (
                <ResizableHead widthPx={widthOf("icp")} onResize={(e) => startResize(e, "icp")}>
                  <button onClick={() => toggleSort("icp_score")} className="flex items-center gap-1 font-semibold text-foreground">
                    ICP <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                </ResizableHead>
              )}
              {colVisible("status") && (
                <ResizableHead widthPx={widthOf("status")} onResize={(e) => startResize(e, "status")}>
                  <span className="font-semibold text-foreground">Pipeline</span>
                </ResizableHead>
              )}
              {colVisible("aging") && (
                <ResizableHead widthPx={widthOf("aging")} onResize={(e) => startResize(e, "aging")}>
                  <span className="font-semibold text-foreground">Aging</span>
                </ResizableHead>
              )}
              {colVisible("location") && (
                <ResizableHead widthPx={widthOf("location")} onResize={(e) => startResize(e, "location")}>
                  <span className="font-semibold text-foreground">Location</span>
                </ResizableHead>
              )}
              {colVisible("notes") && (
                <ResizableHead widthPx={widthOf("notes")} onResize={(e) => startResize(e, "notes")}>
                  <span className="font-semibold text-foreground">Notes</span>
                </ResizableHead>
              )}
              <TableHead className="text-right pr-4 font-semibold text-foreground" style={{ width: widthOf("actions"), minWidth: MIN_COL_WIDTH }}>
                Actions
              </TableHead>
            </TableRow>

          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3 + visibleColumns.size} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-[#00C4C8]" />
                    <span>Loading leads...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3 + visibleColumns.size} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="w-8 h-8 text-muted-foreground/40" />
                    <span className="text-base">No leads in this tab</span>
                    <span className="text-sm">Switch tabs, adjust filters, or import more leads</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => {
                const busy = busyIds.get(lead.id);
                const isSelected = selectedIds.has(lead.id);
                const age = getLeadAge(lead);
                const stuckBorder = age.level === "red" ? "border-l-2 border-l-red-500/60" : "";
                return (
                  <TableRow
                    key={lead.id}
                    className={`transition-colors ${stuckBorder} ${isSelected ? "bg-[#00C4C8]/5 hover:bg-[#00C4C8]/10" : "hover:bg-accent/50"}`}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleOne(lead.id, checked)}
                        aria-label={`Select ${lead.full_name}`}
                      />
                    </TableCell>
                    <TableCell
                      className="cursor-pointer overflow-hidden"
                      onClick={() => setDrawerLeadId(lead.id)}
                      title={leadDisplayName(lead)}
                    >
                      <span className={cn(
                        "font-medium block truncate",
                        lead.full_name ? "text-foreground" : "text-muted-foreground italic",
                      )}>
                        {leadDisplayName(lead)}
                      </span>
                    </TableCell>
                    {colVisible("company") && (
                      <TableCell
                        className="cursor-pointer overflow-hidden"
                        onClick={() => setDrawerLeadId(lead.id)}
                        title={lead.company_name_casual || lead.company_name || ""}
                      >
                        <div className="text-foreground truncate">{lead.company_name_casual || lead.company_name}</div>
                        {lead.company_headcount && (
                          <div className="text-xs text-muted-foreground truncate">{lead.company_headcount} employees</div>
                        )}
                      </TableCell>
                    )}
                    {colVisible("category") && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <CategoryPicker
                          value={lead.category}
                          categories={categories}
                          onChange={async (next) => {
                            const { error } = await supabase
                              .from("leads")
                              .update({ category: next })
                              .eq("id", lead.id);
                            if (error) { toast.error(`Save failed: ${error.message}`); return; }
                            setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, category: next } : l));
                            loadCategories();
                            toast.success(next ? `Tagged "${next}"` : "Category cleared");
                          }}
                          variant="trigger"
                        />
                      </TableCell>
                    )}
                    {colVisible("source") && (
                      <TableCell className="overflow-hidden">
                        <span
                          className={`inline-flex items-center h-6 px-2 rounded-md border text-[11px] font-medium tabular-nums ${sourceColor(lead.source)}`}
                          title={lead.source ? `Source: ${lead.source}` : "Source unknown"}
                        >
                          {sourceLabel(lead.source)}
                        </span>
                      </TableCell>
                    )}
                    {colVisible("title") && (
                      <TableCell
                        className="cursor-pointer overflow-hidden"
                        onClick={() => setDrawerLeadId(lead.id)}
                        title={lead.headline || ""}
                      >
                        <span className="text-sm text-muted-foreground truncate block">{lead.headline}</span>
                      </TableCell>
                    )}
                    {colVisible("icp") && (
                      <TableCell>
                        {lead.icp_score !== null ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono font-bold text-foreground tabular-nums">{lead.icp_score}</span>
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
                    )}
                    {colVisible("status") && (
                      <TableCell>
                        {busy ? (
                          <Badge variant="secondary" className="text-[11px] bg-[#00C4C8]/10 text-[#00C4C8] gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {busy === "enriching" ? "Enriching..." : busy === "generating" ? "Generating..." : "Deleting..."}
                          </Badge>
                        ) : (
                          <StatusTimelineMini
                            status={lead.outreach_status}
                            enrichmentCompleteness={lead.enrichment_completeness}
                            enrichmentError={lead.enrichment_error}
                          />
                        )}
                      </TableCell>
                    )}
                    {colVisible("aging") && (
                      <TableCell className="overflow-hidden">
                        <span
                          className={
                            age.level === "red"
                              ? "text-[11px] font-medium text-red-500 tabular-nums"
                              : age.level === "amber"
                                ? "text-[11px] text-amber-500 tabular-nums"
                                : "text-[11px] text-muted-foreground tabular-nums"
                          }
                          title={`Stage: ${age.stageLabel}${age.slaMs ? ` · SLA ${Math.round(age.slaMs / 3600_000)}h` : ""}`}
                        >
                          {age.level === "red" && "⚠ "}
                          {age.display}
                        </span>
                      </TableCell>
                    )}
                    {colVisible("location") && (
                      <TableCell className="overflow-hidden" title={lead.location || ""}>
                        <span className="text-sm text-muted-foreground truncate block">{lead.location}</span>
                      </TableCell>
                    )}
                    {colVisible("notes") && (
                      <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <InlineNotesCell
                          lead={lead}
                          onSave={(nextNotes) => setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, notes: nextNotes } : l))}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Quick LinkedIn open — always first, one click to verify the profile */}
                        {lead.linkedin_url && (
                          <>
                            <a
                              href={lead.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg border border-transparent text-muted-foreground hover:text-[#00C4C8] hover:bg-[#00C4C8]/10 hover:border-[#00C4C8]/40 transition-colors"
                              title="Open LinkedIn profile"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <div className="h-4 w-px bg-border mx-1.5" />
                          </>
                        )}
                        {/* Qualification state — primary actions surfaced inline.
                            For approved+request_sent leads, show a live "Mark as connected"
                            button so the user can log the acceptance in one click and trigger
                            the auto-enrich cascade. */}
                        {lead.qualification === "approved" && lead.outreach_status === "request_sent" ? (
                          <Button
                            size="sm"
                            onClick={() => markConnected(lead)}
                            disabled={!!busy}
                            className="h-7 px-2.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-sm"
                            title="Mark connection accepted — auto-enriches and generates message"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Mark connected
                          </Button>
                        ) : lead.qualification === "approved" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded bg-emerald-500/10">
                            <CheckCircle2 className="w-3 h-3" /> {lead.outreach_status === "connected" ? "Connected" : "Approved"}
                          </span>
                        ) : lead.qualification === "rejected" ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-red-500 px-2 py-1 rounded bg-red-500/10 max-w-[140px]"
                            title={lead.rejection_reason || "Rejected"}
                          >
                            <XCircle className="w-3 h-3 shrink-0" />
                            <span className="truncate">Rejected</span>
                          </span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-sm"
                              disabled={!!busy}
                              onClick={() => qualify(lead, "approved")}
                              title="Approve — marks request sent on LinkedIn"
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Approve
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                disabled={!!busy}
                                className="h-7 px-2.5 text-xs bg-red-500 hover:bg-red-600 text-white border-0 rounded-md inline-flex items-center shadow-sm disabled:opacity-50"
                                title="Reject with a reason"
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Reject
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Why reject? (for learning)
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {QUICK_REJECT_REASONS.map((r) => (
                                  <DropdownMenuItem key={r} onClick={() => qualify(lead, "rejected", r)}>
                                    {r}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setRejectDialog({ open: true, kind: "single", leadId: lead.id })}>
                                  Other (custom reason)…
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {lead.qualification && (
                              <>
                                <DropdownMenuItem onClick={() => qualify(lead, null)}>
                                  <RotateCcw className="w-3.5 h-3.5 mr-2" /> Move back to Review
                                </DropdownMenuItem>
                                {lead.qualification === "approved" && (
                                  <DropdownMenuItem onClick={() => setRejectDialog({ open: true, kind: "single", leadId: lead.id })} className="text-red-600 focus:text-red-600">
                                    <XCircle className="w-3.5 h-3.5 mr-2" /> Reject instead
                                  </DropdownMenuItem>
                                )}
                                {lead.qualification === "rejected" && (
                                  <DropdownMenuItem onClick={() => qualify(lead, "approved")} className="text-emerald-600 focus:text-emerald-600">
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Approve instead
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem onClick={() => setDrawerLeadId(lead.id)}>
                              <Eye className="w-3.5 h-3.5 mr-2" /> Open lead
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => enrichOne(lead)}
                              disabled={!!busy || !lead.linkedin_url}
                            >
                              {busy === "enriching"
                                ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                : <Sparkles className="w-3.5 h-3.5 mr-2" />
                              }
                              {lead.outreach_status === "new" ? "Enrich" : "Re-run enrichment"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => scoreOne(lead)}
                              disabled={!!busy}
                            >
                              <Target className="w-3.5 h-3.5 mr-2" /> Score only
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => generateOne(lead)}
                              disabled={!!busy}
                            >
                              <MessageSquare className="w-3.5 h-3.5 mr-2" /> Generate messages
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                if (confirm(`Delete ${lead.full_name}?`)) deleteOne(lead);
                              }}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer: pagination + page-size + count */}
      {!loading && leads.length > 0 && (() => {
        const effectivePageSize = pageSize === "all" ? 10000 : pageSize;
        const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / effectivePageSize)) : 1;
        const fromIdx = (page - 1) * effectivePageSize + 1;
        const toIdx = Math.min(page * effectivePageSize, totalCount ?? leads.length);
        return (
          <div className="flex flex-wrap justify-between items-center gap-3 mt-3 px-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                {totalCount === 0 ? "0 leads" : `${fromIdx}–${toIdx} of ${totalCount}`}
              </span>
              <div className="flex items-center gap-1.5">
                <span>Page size:</span>
                <select
                  value={String(pageSize)}
                  onChange={(e) => { const v = e.target.value; setPageSize(v === "all" ? "all" : (parseInt(v) as PageSize)); }}
                  className="h-7 px-2 bg-card border border-border rounded outline-none text-foreground"
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="250">250</option>
                  <option value="all">All</option>
                </select>
              </div>
            </div>

            {pageSize !== "all" && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(1)} className="h-7 px-2 text-xs">« First</Button>
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7 px-2 text-xs">‹ Prev</Button>
                <span className="px-3 text-foreground tabular-nums">Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-7 px-2 text-xs">Next ›</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-7 px-2 text-xs">Last »</Button>
              </div>
            )}

            {selectedCount > 0 && <span>{selectedCount} selected</span>}
          </div>
        );
      })()}

      {/* Reject dialog — captures a reason so we can learn from it later */}
      {rejectDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setRejectDialog({ open: false, kind: rejectDialog.kind })}>
          <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-foreground mb-1">
              Reject {rejectDialog.kind === "bulk" ? `${selectedIds.size} leads` : "this lead"}
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Pick a reason. We'll track these to improve auto-qualification later.
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRejectReason(r)}
                  className={[
                    "text-xs text-left px-3 py-2 rounded border transition-colors min-h-8",
                    rejectReason === r
                      ? "border-[#00C4C8] bg-[#00C4C8]/10 text-foreground font-medium"
                      : "border-border hover:border-[#00C4C8]/50 text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Optional: extra context (e.g. 'wrong region - based in UAE, not EU')"
              rows={2}
              className="w-full px-3 py-2 text-xs bg-background border border-border rounded outline-none focus:border-[#00C4C8] text-foreground resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setRejectDialog({ open: false, kind: rejectDialog.kind }); setRejectReason(""); setRejectNotes(""); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!rejectReason || bulkBusy}
                onClick={async () => {
                  const fullReason = [rejectReason, rejectNotes.trim()].filter(Boolean).join(" · ");
                  if (rejectDialog.kind === "bulk") {
                    await bulkQualify("rejected", fullReason);
                  } else if (rejectDialog.leadId) {
                    const lead = leads.find((l) => l.id === rejectDialog.leadId);
                    if (lead) await qualify(lead, "rejected", fullReason);
                  }
                  setRejectDialog({ open: false, kind: rejectDialog.kind });
                  setRejectReason("");
                  setRejectNotes("");
                }}
                className="bg-red-500 hover:bg-red-600 text-white border-0"
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Side drawer — single canonical lead view. Prev/next walks the current
          filtered/sorted `leads[]` array (respects tab, filters, sort, pagination). */}
      <LeadDrawer
        leadId={drawerLeadId}
        onClose={() => setDrawerLeadId(null)}
        onUpdate={(updated) => {
          // Detect cross-tab transitions (qualification or outreach_status change)
          // and apply optimistic tabCounts delta + reconcile. Without this, drawer
          // mutations (Approve / Mark connected from drawer) leave the badges stale.
          const prev = leads.find((l) => l.id === updated.id);
          if (prev && prev.qualification !== updated.qualification) {
            applyQualificationDelta(prev.qualification, updated.qualification);
            loadTabCounts();
          } else if (prev && prev.outreach_status !== updated.outreach_status) {
            // Status crossed the qualified→active boundary? Reconcile via server.
            loadTabCounts();
          }
          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
          loadCategories();
        }}
        onDelete={(id) => {
          setLeads((prev) => prev.filter((l) => l.id !== id));
          setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        }}
        onPrev={() => {
          const i = leads.findIndex((l) => l.id === drawerLeadId);
          if (i > 0) setDrawerLeadId(leads[i - 1].id);
        }}
        onNext={() => {
          const i = leads.findIndex((l) => l.id === drawerLeadId);
          if (i >= 0 && i < leads.length - 1) setDrawerLeadId(leads[i + 1].id);
        }}
        canPrev={(() => { const i = leads.findIndex((l) => l.id === drawerLeadId); return i > 0; })()}
        canNext={(() => { const i = leads.findIndex((l) => l.id === drawerLeadId); return i >= 0 && i < leads.length - 1; })()}
      />
    </div>
    </TooltipPrimitive.Provider>
  );
}

// Filter trigger that always shows "Label: Value" (e.g. "Tier: HOT") so the
// active filter is readable without opening the dropdown.
function LabeledSelect({
  label,
  value,
  onValueChange,
  options,
  width = "w-48",
  onOpenChange,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "All";
  return (
    <Select value={value} onValueChange={(v) => v && onValueChange(v)} onOpenChange={onOpenChange}>
      <SelectTrigger className={cn(width, "bg-card")}>
        <span className="truncate text-sm">
          <span className="text-muted-foreground">{label}:</span>{" "}
          <span className="text-foreground font-medium">{current}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
