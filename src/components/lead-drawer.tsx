"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  SheetBody, SheetFooter, SheetCloseButton,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { cn, leadDisplayName } from "@/lib/utils";
import { STATUS_STEPS, STATUS_LABELS, normalizeStatus } from "@/components/inline-cells";
import type { Lead, OutreachStatus, IcpTier } from "@/types/leads";
import {
  ExternalLink, Sparkles, MessageSquare, Loader2, Trash2,
  Check, Pencil, Building2, MapPin, Briefcase, Tag,
  Code2, Users2, BookMarked, Globe, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, RotateCcw, Copy, Send,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Collapsible section — default collapsed for long blocks of text
function Collapsible({ children, preview, className }: {
  children: React.ReactNode;
  preview?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      {!open && preview && <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">{preview}</div>}
      {open && <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{children}</div>}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#00C4C8] hover:underline"
      >
        {open ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show more</>}
      </button>
    </div>
  );
}

// STATUS_STEPS + STATUS_LABELS + normalizeStatus live in inline-cells.tsx (single source of truth).

const TIER_CONFIG: Record<string, string> = {
  HOT: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  WARM: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  COLD: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  SKIP: "bg-secondary text-muted-foreground border-border",
};

interface LeadDrawerProps {
  leadId: string | null;
  onClose: () => void;
  onUpdate: (lead: Lead) => void;
  onDelete: (id: string) => void;
  onPrev?: () => void;   // Clay-style prev/next navigation over the currently-filtered table
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}

/**
 * Single-view lead drawer (post 2026-04-23 redesign — /lead/[id]/page.tsx deleted).
 * Layout (top → bottom):
 *   Header with prev/next + close
 *   Summary row (company, location, industry) + score/tier
 *   Next Action panel (state-driven CTA)
 *   Pipeline widget
 *   Message variants (only when generated)
 *   Category + Notes + Message Readiness
 *   Research sections (collapsed by default once enriched)
 *   Footer: Change decision ▾ | Delete
 * Keyboard: j/↓ next, k/↑ prev, a primary action, r reject, Esc close.
 */
export function LeadDrawer({ leadId, onClose, onUpdate, onDelete, onPrev, onNext, canPrev, canNext }: LeadDrawerProps) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Inline edit state
  const [editingCategory, setEditingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaveState, setNotesSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const notesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!leadId) { setLead(null); return; }
    setLoading(true);
    supabase
      .from("leads").select("*").eq("id", leadId).single()
      .then(({ data, error }) => {
        if (error) { toast.error(`Load failed: ${error.message}`); setLead(null); }
        else {
          setLead(data as Lead);
          setCategoryDraft((data as Lead).category || "");
          setNotesDraft((data as Lead).notes || "");
        }
        setLoading(false);
      });
  }, [leadId]);

  // Auto-save notes 800ms after typing stops
  useEffect(() => {
    if (!lead) return;
    if (notesDraft === (lead.notes || "")) { setNotesSaveState("idle"); return; }
    setNotesSaveState("saving");
    if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
    notesTimeoutRef.current = setTimeout(async () => {
      const { error } = await supabase.from("leads").update({ notes: notesDraft || null }).eq("id", lead.id);
      if (error) { toast.error(`Notes save failed: ${error.message}`); setNotesSaveState("idle"); }
      else {
        const updated = { ...lead, notes: notesDraft || null };
        setLead(updated); onUpdate(updated);
        setNotesSaveState("saved");
        setTimeout(() => setNotesSaveState("idle"), 1500);
      }
    }, 800);
    return () => { if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesDraft]);

  const saveCategory = async () => {
    if (!lead) return;
    const value = categoryDraft.trim() || null;
    if (value === (lead.category || null)) { setEditingCategory(false); return; }
    const { error } = await supabase.from("leads").update({ category: value }).eq("id", lead.id);
    if (error) { toast.error(`Category save failed: ${error.message}`); return; }
    const updated = { ...lead, category: value };
    setLead(updated); onUpdate(updated);
    setEditingCategory(false);
    toast.success(value ? `Tagged as "${value}"` : "Category cleared");
  };

  const enrich = async () => {
    if (!lead) return;
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: lead.linkedin_url }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(`Enrich failed: ${data.error ?? res.status}`); return; }
      setLead(data.lead as Lead); onUpdate(data.lead as Lead);
      toast.success("Enriched");
    } finally { setEnriching(false); }
  };

  // "Mark as connected" — fires when Nikita sees the acceptance on LinkedIn.
  // Flips outreach_status to 'connected' + stamps connection_accepted_at, then
  // cascades into auto-generate so the personal message draft is ready within
  // seconds of the accept. Kira's rule: "Тебе нужно в моменте кетчить его...
  // реально в течение часа". Enrichment already ran at Approve time, so this
  // step skips straight to message generation.
  const markConnected = async () => {
    if (!lead) return;
    try {
      // Step 1: update status to 'connected' immediately for UI feedback
      const { data: upd, error } = await supabase.from("leads").update({
        outreach_status: "connected",
        connection_accepted_at: new Date().toISOString(),
      }).eq("id", lead.id).select().single();
      if (error) { toast.error(`Failed: ${error.message}`); return; }
      setLead(upd as Lead); onUpdate(upd as Lead);
      toast.success("Marked connected — generating message…");

      // Step 2: auto-generate message. Fire-and-forget with a setState on completion.
      setGenerating(true);
      fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      }).then(async (r) => {
        const d = await r.json();
        if (r.ok && d.lead) {
          setLead(d.lead as Lead); onUpdate(d.lead as Lead);
          toast.success("Message draft ready — review and send");
        } else {
          toast.error(`Auto-generate failed: ${d.error ?? r.status}`);
        }
      }).finally(() => setGenerating(false));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = async () => {
    if (!lead) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(`Generate failed: ${data.error ?? res.status}`); return; }
      setLead(data.lead as Lead); onUpdate(data.lead as Lead);
      toast.success("Messages generated");
    } finally { setGenerating(false); }
  };

  const del = async () => {
    if (!lead) return;
    if (!confirm(`Delete ${leadDisplayName(lead)}?`)) return;
    const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Delete failed"); return; }
    onDelete(lead.id); onClose(); toast.success("Deleted");
  };

  // Quick qualification from drawer. Passes null to reset to "To review".
  // Approve POSTs to /api/qualify which writes the qualification AND fires
  // the full enrichment pipeline (Apify + Perplexity + TheirStack + scoring)
  // server-side, so by the time we get a response back the lead has email,
  // skills, photo, and an ICP score. Reject/null skip the enrichment path.
  const setQualification = async (qualification: "approved" | "rejected" | null, reason?: string) => {
    if (!lead) return;
    if (qualification === "approved") setEnriching(true);
    try {
      const res = await fetch("/api/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, qualification, rejection_reason: reason ?? null }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(`Save failed: ${data.error ?? res.status}`); return; }
      const updated = data.lead as Lead;
      setLead(updated); onUpdate(updated);
      toast.success(
        qualification === "approved"
          ? (updated.icp_score != null ? `Approved — enriched (ICP ${updated.icp_score})` : "Approved")
          : qualification === "rejected" ? `Rejected${reason ? ` (${reason})` : ""}`
          : "Moved back to review"
      );
    } finally {
      if (qualification === "approved") setEnriching(false);
    }
  };

  const [rejectInDrawer, setRejectInDrawer] = useState(false);
  const [rejectReasonDraft, setRejectReasonDraft] = useState("");
  const [selectedVariantIdx, setSelectedVariantIdx] = useState<number | null>(null);
  const [sendingMark, setSendingMark] = useState(false);

  // When a lead loads, seed selectedVariantIdx from selected_message if it matches one
  useEffect(() => {
    if (!lead?.message_variants || !lead.selected_message) { setSelectedVariantIdx(null); return; }
    const idx = lead.message_variants.findIndex((v) => v.message === lead.selected_message);
    setSelectedVariantIdx(idx >= 0 ? idx : null);
  }, [lead?.id, lead?.selected_message, lead?.message_variants]);

  // Pick a variant — persists to selected_message (the copy-to-clipboard source)
  const selectVariant = async (idx: number) => {
    if (!lead?.message_variants || !lead.message_variants[idx]) return;
    const msg = lead.message_variants[idx].message;
    setSelectedVariantIdx(idx);
    const { error } = await supabase.from("leads").update({ selected_message: msg }).eq("id", lead.id);
    if (error) { toast.error(`Select failed: ${error.message}`); return; }
    const updated = { ...lead, selected_message: msg };
    setLead(updated); onUpdate(updated);
  };

  const copySelected = async () => {
    if (!lead?.selected_message) { toast.error("Pick a variant first"); return; }
    await navigator.clipboard.writeText(lead.selected_message);
    toast.success("Copied — paste into LinkedIn");
  };

  // Mark the selected message as sent (advances outreach_status → 'messaged')
  const markAsSent = async () => {
    if (!lead?.selected_message) { toast.error("Pick a variant first"); return; }
    setSendingMark(true);
    try {
      const { error } = await supabase.from("leads").update({
        outreach_status: "messaged",
        sent_at: new Date().toISOString(),
      }).eq("id", lead.id);
      if (error) { toast.error(`Failed: ${error.message}`); return; }
      const updated = { ...lead, outreach_status: "messaged" as const, sent_at: new Date().toISOString() };
      setLead(updated); onUpdate(updated);
      toast.success("Marked as sent");
    } finally { setSendingMark(false); }
  };

  const markAsReplied = async () => {
    if (!lead) return;
    setSendingMark(true);
    try {
      const { error } = await supabase.from("leads").update({
        outreach_status: "replied",
        replied_at: new Date().toISOString(),
      }).eq("id", lead.id);
      if (error) { toast.error(`Failed: ${error.message}`); return; }
      const updated = { ...lead, outreach_status: "replied" as const, replied_at: new Date().toISOString() };
      setLead(updated); onUpdate(updated);
      toast.success("Marked as replied — export to ClickUp next");
    } finally { setSendingMark(false); }
  };

  // Push the lead to ClickUp. Server-side: creates a task in the configured
  // Pipeline list with full context, stamps clickup_task_id, flips status to
  // 'converted'. Idempotent — clicking twice returns the existing task.
  const [pushingClickUp, setPushingClickUp] = useState(false);
  const pushToClickUp = async () => {
    if (!lead) return;
    setPushingClickUp(true);
    try {
      const res = await fetch("/api/clickup/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        toast.error(data.error || `Push failed: ${res.status}`);
        return;
      }
      if (data.alreadyPushed) {
        toast.info("Already in ClickUp");
      } else {
        toast.success("Pushed to ClickUp");
      }
      const updated = { ...lead, clickup_task_id: data.taskId, outreach_status: "converted" as const };
      setLead(updated); onUpdate(updated);
      // Open the new ClickUp task in a new tab if we have the URL.
      if (data.taskUrl) window.open(data.taskUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPushingClickUp(false);
    }
  };

  // Keyboard shortcuts. j/↓ next, k/↑ prev, a primary, r reject, Esc close.
  // Deliberately ignored when an input/textarea is focused so typing in notes works.
  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); onNext?.(); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); onPrev?.(); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leadId, onNext, onPrev, onClose]);

  const open = Boolean(leadId);

  // Relative-time formatter — avoids date-fns dep for one use
  const timeAgo = (iso?: string | null): string => {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent widthClass="w-[960px] max-w-[95vw]">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[#00C4C8]" />
          </div>
        )}
        {lead && !loading && (
          <>
            <SheetHeader>
              {/* Prev/next chevrons frame the name — Clay-style lead-by-lead navigation */}
              <button
                onClick={() => onPrev?.()}
                disabled={!canPrev}
                title="Previous lead (k / ↑)"
                className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <SheetTitle className="truncate">{leadDisplayName(lead)}</SheetTitle>
                <SheetDescription className="truncate">{lead.headline}</SheetDescription>
              </div>
              <button
                onClick={() => onNext?.()}
                disabled={!canNext}
                title="Next lead (j / ↓)"
                className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <SheetCloseButton />
            </SheetHeader>

            <SheetBody className="space-y-5">
              {/* Summary row: company, location, industry */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {lead.company_name && (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    {lead.company_name_casual || lead.company_name}
                  </span>
                )}
                {lead.location && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" /> {lead.location}
                    </span>
                  </>
                )}
                {lead.company_industry && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Briefcase className="w-3.5 h-3.5" /> {lead.company_industry}
                    </span>
                  </>
                )}
                {lead.icp_score !== null && (
                  <span className="ml-auto inline-flex items-center gap-2">
                    <span className="text-sm tabular-nums font-semibold">{lead.icp_score}</span>
                    <span className="text-xs text-muted-foreground">/100</span>
                    {lead.icp_tier && (
                      <Badge variant="outline" className={TIER_CONFIG[lead.icp_tier as IcpTier] || ""}>
                        {lead.icp_tier}
                      </Badge>
                    )}
                  </span>
                )}
              </div>

              {/* ── NEXT ACTION PANEL ── (state-driven primary CTA) */}
              <NextActionPanel
                lead={lead}
                enriching={enriching}
                generating={generating}
                sendingMark={sendingMark}
                pushingClickUp={pushingClickUp}
                onApprove={() => setQualification("approved")}
                onMarkConnected={markConnected}
                onGenerate={generate}
                onEnrich={enrich}
                onCopySelected={copySelected}
                onMarkAsSent={markAsSent}
                onMarkReplied={markAsReplied}
                onPushToClickUp={pushToClickUp}
                timeAgo={timeAgo}
              />

              {/* Pipeline widget */}
              <StatusTimeline
                status={lead.outreach_status}
                enrichmentCompleteness={lead.enrichment_completeness}
                enrichmentError={lead.enrichment_error}
              />

              {/* ── MESSAGE VARIANTS BLOCK ── (only when generated) */}
              {lead.message_variants && Array.isArray(lead.message_variants) && lead.message_variants.length > 0 && (() => {
                // Tabbed layout — one variant at a time gets the full drawer width.
                // Tab is the angle label + principles score; selected tab shows the message
                // body with a prominent Copy button. Less cramped than the 3-col grid.
                const variants = lead.message_variants;
                const angleLabels: Record<string, string> = {
                  cold_reading: "Cold reading",
                  observation: "Observation",
                  value_first: "Value-first",
                };
                // Default the active tab to the selected variant, or the first one.
                const activeIdx = selectedVariantIdx ?? 0;
                const active = variants[activeIdx];
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3" /> Message variants ({variants.length})
                      </div>
                      {selectedVariantIdx !== null && (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Variant {selectedVariantIdx + 1} selected
                        </span>
                      )}
                    </div>

                    {/* Tab bar */}
                    <div className="flex items-stretch gap-1 border-b border-border" role="tablist">
                      {variants.map((v, i) => {
                        const isActive = i === activeIdx;
                        const isSelected = selectedVariantIdx === i;
                        return (
                          <button
                            key={i}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => selectVariant(i)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                              isActive
                                ? "border-[#00C4C8] text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <span>{angleLabels[v.angle] || v.angle}</span>
                            <span className={cn(
                              "text-[10px] tabular-nums px-1.5 py-0.5 rounded",
                              v.principles_score >= 5 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                              v.principles_score >= 4 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                              "bg-secondary text-muted-foreground",
                            )}>
                              {v.principles_score}/7
                            </span>
                            {isSelected && <Check className="w-3 h-3 text-emerald-500" />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Active variant body */}
                    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3" role="tabpanel">
                      <div className="flex items-start gap-3">
                        <p className="flex-1 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                          {active.message}
                        </p>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(active.message);
                            await selectVariant(activeIdx);
                            toast.success(`${angleLabels[active.angle] || active.angle} copied — paste into LinkedIn`);
                          }}
                          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] transition-colors"
                          title="Copy this variant + mark it as selected"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </button>
                      </div>
                      {active.principles_hit && active.principles_hit.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-2 border-t border-border/60">
                          {/* Principles hit by this variant. Cyan-tinted for high contrast — */}
                          {/* the previous bg-secondary/60 + muted-foreground combo failed WCAG AA. */}
                          {active.principles_hit.slice(0, 7).map((p, pi) => (
                            <span key={pi} className="text-[10px] font-medium px-2 py-0.5 rounded bg-[#00C4C8]/10 text-[#00C4C8] border border-[#00C4C8]/20">
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Category (inline editable) */}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Category</div>
                {editingCategory ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={categoryDraft}
                      onChange={(e) => setCategoryDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveCategory();
                        if (e.key === "Escape") { setCategoryDraft(lead.category || ""); setEditingCategory(false); }
                      }}
                      onBlur={saveCategory}
                      placeholder="e.g. DigX Wholesale"
                      className="flex-1 px-3 py-1.5 text-sm bg-card border border-[#00C4C8] rounded-md outline-none text-foreground"
                    />
                    <Button size="sm" onClick={saveCategory} className="h-8 px-2 bg-[#00C4C8] text-[#0A1628] border-0">
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingCategory(true)}
                    className="group inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm border border-dashed border-border hover:border-[#00C4C8] hover:bg-[#00C4C8]/5 transition-colors"
                  >
                    {lead.category ? (
                      <>
                        <Tag className="w-3 h-3 text-[#00C4C8]" />
                        <span className="text-foreground">{lead.category}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">No category</span>
                    )}
                    <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                  </button>
                )}
              </div>

              {/* Notes (inline editable, auto-save) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</div>
                  {notesSaveState === "saving" && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                    </span>
                  )}
                  {notesSaveState === "saved" && (
                    <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Saved
                    </span>
                  )}
                </div>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Add notes about this lead — reply status, insights, next steps..."
                  rows={4}
                  className="w-full px-3 py-2 text-sm bg-card border border-border rounded-md outline-none focus:border-[#00C4C8] text-foreground resize-none"
                />
              </div>

              {/* About / summary */}
              {lead.summary && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">About</div>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{lead.summary}</p>
                </div>
              )}

              {/* Message Readiness checklist — tells the user at a glance whether
                  a Saraev-grade message can be generated from available data */}
              <MessageReadiness lead={lead} />

              {/* Research & enrichment data — collapsed by default once enriched,
                  so the drawer stays focused on the message. Expand when context needed. */}
              {(lead.person_research || lead.company_research || lead.tech_stack || lead.hiring_signals
                || lead.proof_points) && (
                <details className="group" open={lead.enrichment_completeness == null}>
                  <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 py-1 hover:text-foreground transition-colors">
                    <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                    Research & enrichment data
                  </summary>
                  <div className="space-y-4 pt-3 pl-4 border-l-2 border-border/50">
                    {lead.person_research && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Person research</div>
                        <Collapsible preview={lead.person_research}>{lead.person_research}</Collapsible>
                      </div>
                    )}
                    {lead.company_research && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Company research</div>
                        <Collapsible preview={lead.company_research}>{lead.company_research}</Collapsible>
                      </div>
                    )}
                    {lead.tech_stack && Array.isArray(lead.tech_stack) && lead.tech_stack.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                          <Code2 className="w-3 h-3" />
                          Tech stack ({lead.tech_stack.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {lead.tech_stack.slice(0, 30).map((t, i) => {
                            const name = (t as Record<string, string>)?.name || String(t);
                            return (
                              <Badge key={`${name}-${i}`} variant="secondary" className="text-[11px] bg-secondary text-foreground">
                                {name}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <HiringSignals signals={lead.hiring_signals} />
                    {lead.proof_points && Array.isArray(lead.proof_points) && lead.proof_points.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                          <BookMarked className="w-3 h-3" />
                          Proof points ({lead.proof_points.length})
                        </div>
                        <div className="space-y-1.5">
                          {lead.proof_points.slice(0, 8).map((p, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#00C4C8]/10 text-[#00C4C8]">
                                {p.type}
                              </span>
                              <span className="text-foreground">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Website-text raw dump removed 2026-04-24 — it was mostly navigation
                        junk ("CERRAR", "BORRAR", "Skip to main content"). The scraper still
                        feeds the raw text into Perplexity's company_research prompt, so the
                        value is captured in the company_research block above — no need to
                        display 4KB of nav markup. */}
                  </div>
                </details>
              )}

              {/* External links */}
              <div className="flex flex-wrap gap-2">
                {lead.linkedin_url && (
                  <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#00C4C8] hover:underline">
                    <ExternalLink className="w-3 h-3" /> LinkedIn
                  </a>
                )}
                {lead.company_url && !lead.company_url.toLowerCase().includes("linkedin.com") ? (
                  <a href={lead.company_url.startsWith("http") ? lead.company_url : `https://${lead.company_url}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#00C4C8] hover:underline">
                    <ExternalLink className="w-3 h-3" /> Company site
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic">
                    No company website on file
                  </span>
                )}
                {lead.company_linkedin_url && (
                  <a href={lead.company_linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#00C4C8] hover:underline">
                    <ExternalLink className="w-3 h-3" /> Company LinkedIn
                  </a>
                )}
              </div>
            </SheetBody>

            <SheetFooter>
              {/* Change decision — buries the now-secondary approve/reject/reset actions.
                  Primary CTAs live in the Next Action panel above. */}
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-8 px-3 text-sm border border-border rounded-md bg-card hover:bg-accent transition-colors">
                  Change decision
                  <ChevronDown className="w-3.5 h-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {lead.qualification !== "approved" && (
                    <DropdownMenuItem onClick={() => setQualification("approved")}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-500" /> Approve (send request)
                    </DropdownMenuItem>
                  )}
                  {lead.qualification !== "rejected" && (
                    <DropdownMenuItem onClick={() => setRejectInDrawer(true)} className="text-red-600 focus:text-red-600">
                      <XCircle className="w-3.5 h-3.5 mr-2" /> Reject with reason…
                    </DropdownMenuItem>
                  )}
                  {lead.qualification !== null && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setQualification(null)}>
                        <RotateCcw className="w-3.5 h-3.5 mr-2" /> Move back to Review
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={generate} disabled={generating || enriching}>
                    <MessageSquare className="w-3.5 h-3.5 mr-2" /> {lead.message_variants ? "Regenerate message" : "Generate message"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={enrich} disabled={enriching || generating}>
                    <Sparkles className="w-3.5 h-3.5 mr-2" /> {lead.enrichment_completeness == null ? "Run enrichment" : "Re-run enrichment"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Inline reject reason picker, shown when reject flow is active */}
              {rejectInDrawer && (
                <div className="w-full mt-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
                  <div className="text-xs font-medium text-foreground">Why reject this lead?</div>
                  <div className="flex flex-wrap gap-1">
                    {["Wrong industry", "Wrong role", "Wrong size", "Wrong geography", "Wrong stage (too early)", "Not ICP", "Other"].map((r) => (
                      <button
                        key={r}
                        onClick={() => setRejectReasonDraft(r)}
                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                          rejectReasonDraft === r
                            ? "border-[#00C4C8] bg-[#00C4C8]/10 text-foreground font-medium"
                            : "border-border hover:border-[#00C4C8]/50 text-muted-foreground"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => { setRejectInDrawer(false); setRejectReasonDraft(""); }}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={!rejectReasonDraft}
                      onClick={async () => {
                        await setQualification("rejected", rejectReasonDraft);
                        setRejectInDrawer(false);
                        setRejectReasonDraft("");
                      }}
                      className="bg-red-500 hover:bg-red-600 text-white border-0"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              <Button size="sm" variant="outline" onClick={del} className="ml-auto text-red-500 border-red-500/40 hover:bg-red-500/10 hover:text-red-600">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Next Action panel ──────────────────────────────────────────────
// State-driven CTA banner that lives above the pipeline widget. Its job is
// to answer "what do I do next?" in one glance. Primary button + secondary
// label vary by outreach_status + qualification + enrichment_completeness.
function NextActionPanel({
  lead, enriching, generating, sendingMark, pushingClickUp,
  onApprove, onMarkConnected, onGenerate, onEnrich,
  onCopySelected, onMarkAsSent, onMarkReplied, onPushToClickUp, timeAgo,
}: {
  lead: Lead;
  enriching: boolean;
  generating: boolean;
  sendingMark: boolean;
  pushingClickUp: boolean;
  onApprove: () => void;
  onMarkConnected: () => void;
  onGenerate: () => void;
  onEnrich: () => void;
  onCopySelected: () => void;
  onMarkAsSent: () => void;
  onMarkReplied: () => void;
  onPushToClickUp: () => void;
  timeAgo: (iso?: string | null) => string;
}) {
  const status = normalizeStatus(lead.outreach_status);
  const hasMessages = Boolean(lead.message_variants && Array.isArray(lead.message_variants) && lead.message_variants.length > 0);
  const hasSelected = Boolean(lead.selected_message);

  // Variant of the panel: primary cyan ring for actionable, muted for info-only states.
  const wrap = (children: React.ReactNode, tone: "primary" | "muted" | "success" | "warn" = "primary") => {
    const toneClass =
      tone === "muted" ? "bg-muted/30 border-border"
      : tone === "success" ? "bg-emerald-500/5 border-emerald-500/30"
      : tone === "warn" ? "bg-amber-500/5 border-amber-500/30"
      : "bg-[#00C4C8]/5 border-[#00C4C8]/30";
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border", toneClass)}>
        {children}
      </div>
    );
  };

  // Rejected short-circuit — just show the reason, no actions (user can Change decision in footer)
  if (lead.qualification === "rejected") {
    return wrap(
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-red-500 flex items-center gap-1.5">
          <XCircle className="w-4 h-4" /> Rejected
        </div>
        {lead.rejection_reason && (
          <div className="text-xs text-muted-foreground mt-0.5">{lead.rejection_reason}</div>
        )}
      </div>,
      "warn",
    );
  }

  if (status === "scored") {
    return wrap(
      <>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {lead.icp_tier === "HOT" ? "HOT match" : lead.icp_tier === "WARM" ? "WARM match" : "Scored"} · approve to send a LinkedIn request
          </div>
          <div className="text-xs text-muted-foreground">One click sends the connection invite and starts the timer.</div>
        </div>
        <Button size="sm" onClick={onApprove} className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 shrink-0">
          <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve & send request
        </Button>
      </>,
    );
  }

  if (status === "request_sent") {
    const age = timeAgo(lead.request_sent_at);
    return wrap(
      <>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">Request sent{age ? ` · ${age}` : ""}</div>
          <div className="text-xs text-muted-foreground">When they accept, mark them connected to auto-enrich + draft a message.</div>
        </div>
        <Button size="sm" onClick={onMarkConnected} disabled={enriching || sendingMark}
          className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 shrink-0">
          {enriching ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
          Mark connected
        </Button>
      </>,
    );
  }

  if (status === "connected" && !hasMessages) {
    // Still enriching, or enrichment failed completely
    if (lead.enrichment_completeness == null && lead.enrichment_error) {
      return wrap(
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">Connected · enrichment failed</div>
            <div className="text-xs text-red-500 truncate">{lead.enrichment_error}</div>
          </div>
          <Button size="sm" onClick={onEnrich} disabled={enriching} className="shrink-0" variant="outline">
            {enriching ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            Retry enrich
          </Button>
        </>,
        "warn",
      );
    }
    return wrap(
      <>
        <Loader2 className="w-4 h-4 text-[#00C4C8] animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">Connected · auto-enriching…</div>
          <div className="text-xs text-muted-foreground">Research + message draft will be ready in ~10–30 seconds.</div>
        </div>
      </>,
    );
  }

  if (status === "enriched" || (status === "connected" && hasMessages)) {
    if (!hasMessages) {
      return wrap(
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">Enriched · ready to generate outreach</div>
            <div className="text-xs text-muted-foreground">Claude will produce 3 Saraev-style variants from the research.</div>
          </div>
          <Button size="sm" onClick={onGenerate} disabled={generating}
            className="bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 shrink-0">
            {generating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-1.5" />}
            Generate messages
          </Button>
        </>,
      );
    }
    return wrap(
      <>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            Message ready · send within the hour {hasSelected ? "" : "(pick a variant below)"}
          </div>
          <div className="text-xs text-muted-foreground">Fresh acceptance = highest reply rate. Copy, paste into LinkedIn, then Mark as sent.</div>
        </div>
        <Button size="sm" onClick={onCopySelected} disabled={!hasSelected}
          className="bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 shrink-0">
          <Copy className="w-4 h-4 mr-1.5" /> Copy selected
        </Button>
        <Button size="sm" onClick={onMarkAsSent} disabled={!hasSelected || sendingMark}
          variant="outline" className="shrink-0">
          {sendingMark ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Mark as sent
        </Button>
      </>,
    );
  }

  if (status === "messaged") {
    const age = timeAgo(lead.sent_at);
    return wrap(
      <>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">Sent{age ? ` · ${age}` : ""} · waiting for reply</div>
          <div className="text-xs text-muted-foreground">Flip to Replied when they respond — exits this app into ClickUp.</div>
        </div>
        <Button size="sm" onClick={onMarkReplied} disabled={sendingMark} variant="outline" className="shrink-0">
          {sendingMark ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-1.5" />}
          Mark replied
        </Button>
      </>,
    );
  }

  if (status === "replied" || status === "converted") {
    const alreadyPushed = Boolean(lead.clickup_task_id);
    return wrap(
      <>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {alreadyPushed ? "In ClickUp · managed there from here" : "Replied · push to ClickUp"}
          </div>
          <div className="text-xs text-muted-foreground">
            {alreadyPushed
              ? `Task #${lead.clickup_task_id} — opens in a new tab on click.`
              : "Hands off the lead with full context. This dashboard handles only pre-conversation."}
          </div>
        </div>
        {alreadyPushed ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              // We don't store the URL — but the task ID alone gets us to the right place.
              // ClickUp: https://app.clickup.com/t/<taskId>
              window.open(`https://app.clickup.com/t/${lead.clickup_task_id}`, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Open in ClickUp
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onPushToClickUp}
            disabled={pushingClickUp}
            className="shrink-0 bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0"
          >
            {pushingClickUp ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-1.5" />}
            Push to ClickUp
          </Button>
        )}
      </>,
      "success",
    );
  }

  // Fallback — shouldn't happen
  return null;
}

function StatusTimeline({
  status,
  enrichmentCompleteness,
  enrichmentError,
}: {
  status: OutreachStatus;
  enrichmentCompleteness?: "partial" | "full" | null;
  enrichmentError?: string | null;
}) {
  const effectiveStatus = normalizeStatus(status);
  const currentIndex = STATUS_STEPS.indexOf(effectiveStatus);
  const isConverted = status === "converted";
  const enrichedIdx = STATUS_STEPS.indexOf("enriched");
  const enrichFailed = enrichmentError && effectiveStatus === "scored";

  // The state banner used to live here, but it duplicates the Next Action panel above.
  // We keep only the partial/error signals (warning-colored) since those convey enrichment
  // health info that the Next Action panel doesn't. Happy-path text is owned by Next Action.
  const warning =
    enrichFailed ? { color: "text-red-500", text: `Enrichment failed — ${enrichmentError}` }
    : enrichmentCompleteness === "partial" ? { color: "text-amber-500", text: `Partial enrichment${enrichmentError ? ` — ${enrichmentError}` : ""}` }
    : null;

  return (
    <div className="flex flex-col gap-2">
      {warning && (
        <div className={`text-[11px] ${warning.color}`}>{warning.text}</div>
      )}
      <div className="flex items-start gap-1">
        {STATUS_STEPS.map((step, i) => {
          const active = i <= currentIndex || isConverted;
          const current = i === currentIndex && !isConverted;
          const isEnrichedBar = i === enrichedIdx;
          const halfLit = isEnrichedBar && active && enrichmentCompleteness === "partial";
          const showRedDot = isEnrichedBar && enrichFailed;
          return (
            <div key={step} className="flex items-center gap-1 flex-1 min-w-0">
              <div className="flex flex-col items-start min-w-0 w-full">
                <div
                  className={cn(
                    "relative h-1.5 w-full rounded-full transition-colors",
                    halfLit
                      ? "bg-gradient-to-r from-[#00C4C8] from-50% to-border to-50%"
                      : active ? "bg-[#00C4C8]" : "bg-border",
                    current && "ring-2 ring-[#00C4C8]/30",
                  )}
                  title={
                    isEnrichedBar && halfLit ? `${STATUS_LABELS[step]} (partial)`
                    : isEnrichedBar && enrichFailed ? `${STATUS_LABELS[step]} — failed: ${enrichmentError}`
                    : STATUS_LABELS[step]
                  }
                >
                  {showRedDot && (
                    <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </div>
                <span className={`text-[9px] mt-1 truncate ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {STATUS_LABELS[step]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hiring Signals — shows velocity + top 3 recent postings with date + seniority.
 * Accepts either the new rich shape { jobs: [...], velocity_30d: N } or the legacy
 * flat array for backward compat with leads enriched before the schema change.
 */
function HiringSignals({ signals }: { signals: Lead["hiring_signals"] }) {
  if (!signals) return null;
  type Job = { title?: string; location?: string; posted_at?: string; seniority?: string; department?: string };
  let jobs: Job[] = [];
  let velocity = 0;
  if (Array.isArray(signals)) {
    jobs = signals as Job[];
    velocity = jobs.length;
  } else if (typeof signals === "object") {
    const s = signals as { jobs?: Job[]; velocity_30d?: number };
    jobs = s.jobs || [];
    velocity = s.velocity_30d ?? jobs.length;
  }
  if (jobs.length === 0) return null;
  const fmtDate = (d?: string) => { if (!d) return ""; try { return new Date(d).toLocaleDateString(); } catch { return d; } };
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
        <Users2 className="w-3 h-3" />
        Hiring signals · {velocity} posting{velocity === 1 ? "" : "s"} in last 30 days
      </div>
      <div className="space-y-2">
        {jobs.slice(0, 5).map((j, i) => (
          <div key={i} className="flex items-start justify-between gap-2 text-xs border-l-2 border-[#00C4C8]/40 pl-3 py-0.5">
            <div className="min-w-0">
              <div className="text-foreground font-medium truncate">{j.title || "Untitled role"}</div>
              <div className="text-muted-foreground">
                {[j.seniority, j.department, j.location].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {j.posted_at && <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{fmtDate(j.posted_at)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Message Readiness checklist — at-a-glance summary of which Saraev-grade
 * signals are present. Green check = ready. Red X = re-enrich to fix.
 */
function MessageReadiness({ lead }: { lead: Lead }) {
  const hasText = (s: string | null | undefined, min = 200) => !!s && s.length >= min;
  const hasArray = (a: unknown) => Array.isArray(a) && a.length > 0;
  const hiring = lead.hiring_signals as { jobs?: unknown[] } | unknown[] | null;
  const hiringCount = Array.isArray(hiring)
    ? hiring.length
    : (hiring && typeof hiring === "object" && Array.isArray((hiring as { jobs?: unknown[] }).jobs))
      ? ((hiring as { jobs: unknown[] }).jobs).length
      : 0;
  const techCount = hasArray(lead.tech_stack) ? (lead.tech_stack as unknown[]).length : 0;
  const proofCount = hasArray(lead.proof_points) ? (lead.proof_points as unknown[]).length : 0;
  const urlOk = !!lead.company_url && !lead.company_url.toLowerCase().includes("linkedin.com");

  const checks = [
    { label: "Role detected", ok: !!lead.headline && lead.headline.length > 3 },
    { label: "Company URL valid", ok: urlOk, hint: urlOk ? undefined : "re-enrich to fetch" },
    { label: "Person research", ok: hasText(lead.person_research) },
    { label: "Company research", ok: hasText(lead.company_research) },
    { label: `Tech stack (${techCount})`, ok: techCount > 0 },
    { label: `Hiring signals (${hiringCount})`, ok: hiringCount > 0 },
    { label: `Proof points (${proofCount})`, ok: proofCount > 0 },
    { label: "Website content", ok: hasText(lead.company_website_text, 2000) },
  ];
  const readyCount = checks.filter((c) => c.ok).length;
  const pct = Math.round((readyCount / checks.length) * 100);

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message readiness</div>
        <span className={`text-xs font-semibold tabular-nums ${pct >= 75 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-red-500"}`}>
          {readyCount}/{checks.length} · {pct}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
            {c.ok
              ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              : <XCircle className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
            <span className={c.ok ? "text-foreground" : "text-muted-foreground"}>
              {c.label}
              {c.hint && <span className="text-muted-foreground/70"> · {c.hint}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
