"use client";

import { useState, useRef, useEffect } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Tag, Pencil, Plus, FileText, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Lead, OutreachStatus } from "@/types/leads";
import { cn } from "@/lib/utils";

// ── Status timeline (compact, inline) ────────────────────────────────
//
// 2026-04-23: reduced 7 stages → 6 by dropping 'new'. Every ingested lead is
// auto-scored server-side in /api/ingest-leads, so nothing lingers at 'new'.
// Partial/failed enrichment now renders honestly:
//  - completeness='partial' → Enriched bar is half-cyan / half-muted
//  - enrichment_error set + status still 'scored' → red dot on the Enriched slot
// Readout moved from below-the-bars to inline-right to free vertical space.

// 2026-04-23 reorder — connection-first flow. Enrichment moves AFTER 'connected'
// (= target accepted). Approve button now means "request sent", matching Kira's
// actual workflow: approve = send LinkedIn connection request, only enrich the
// people who actually connect back.
export const STATUS_STEPS: OutreachStatus[] = [
  "scored", "request_sent", "connected", "enriched", "messaged", "replied",
];
export const STATUS_LABELS: Record<OutreachStatus, string> = {
  new: "New",                    // legacy — never rendered as a step
  scored: "Scored",
  request_sent: "Request sent",
  connected: "Connected",
  enriched: "Enriched",
  messaged: "Messaged",
  message_ready: "Messaged",     // legacy alias
  sent: "Messaged",              // legacy alias
  replied: "Replied",
  converted: "Converted",
};

interface StatusTimelineProps {
  status: OutreachStatus;
  enrichmentCompleteness?: "partial" | "full" | null;
  enrichmentError?: string | null;
}

// Map legacy outreach_status values to their new pipeline slot.
// - 'new' → 'scored' (auto-score on ingest removed the 'new' stage)
// - 'message_ready' / 'sent' → 'messaged' (collapsed in the new 6-stage flow)
export function normalizeStatus(s: OutreachStatus): OutreachStatus {
  if (s === "new") return "scored";
  if (s === "message_ready" || s === "sent") return "messaged";
  return s;
}

export function StatusTimelineMini({ status, enrichmentCompleteness, enrichmentError }: StatusTimelineProps) {
  const effectiveStatus = normalizeStatus(status);
  const currentIdx = STATUS_STEPS.indexOf(effectiveStatus);
  const isConverted = status === "converted";
  const currentLabel = STATUS_LABELS[status] || "Unknown";
  const stepIndex = isConverted ? STATUS_STEPS.length : currentIdx + 1;
  const enrichedIdx = STATUS_STEPS.indexOf("enriched");
  const enrichFailed = enrichmentError && effectiveStatus === "scored";

  return (
    <div
      className="flex items-center gap-2 min-w-0"
      title={`${currentLabel} (${stepIndex}/${STATUS_STEPS.length})${enrichFailed ? ` — enrichment failed: ${enrichmentError}` : ""}`}
    >
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        {STATUS_STEPS.map((step, i) => {
          const active = i <= currentIdx || isConverted;
          const current = i === currentIdx && !isConverted;
          const isEnrichedBar = i === enrichedIdx;
          // Half-lit Enriched bar when enrichment was partial
          const halfLit = isEnrichedBar && active && enrichmentCompleteness === "partial";
          // Red indicator overlay on the Enriched slot when enrichment hard-failed
          const showRedDot = isEnrichedBar && enrichFailed;

          return (
            <div
              key={step}
              title={
                isEnrichedBar && enrichmentCompleteness === "partial" ? `${STATUS_LABELS[step]} (partial)`
                : isEnrichedBar && enrichFailed ? `${STATUS_LABELS[step]} — failed: ${enrichmentError}`
                : STATUS_LABELS[step]
              }
              className={cn(
                "relative h-1.5 flex-1 rounded-full transition-colors",
                halfLit
                  ? "bg-gradient-to-r from-[#00C4C8] from-50% to-border to-50%"
                  : active ? "bg-[#00C4C8]" : "bg-border",
                current && "ring-2 ring-[#00C4C8]/30 ring-offset-0"
              )}
            >
              {showRedDot && (
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
            </div>
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground leading-none tabular-nums shrink-0">
        {currentLabel} · {stepIndex}/{STATUS_STEPS.length}
      </span>
    </div>
  );
}

// ── Editable category cell ──────────────────────────────────────────
//
// Wiki rules followed:
//  - Tap target ≥32pt desktop (button is min-h-6 with hover pad → 32px touch area)
//  - Focused input: 5.33:1 contrast border (cyan on card)
//  - Esc cancels, Enter saves, blur saves (Nielsen: undo/redo + user control)
//  - Pencil affordance appears on hover (doesn't compete in default state)
//  - Primary click (on tag, not pencil) = filter — most common action wins

export function EditableCategoryCell({
  lead,
  onFilter,
  onUpdate,
}: {
  lead: Lead;
  onFilter: (category: string) => void;
  onUpdate: (updatedLead: Lead) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.category ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const value = draft.trim() || null;
    if (value === (lead.category || null)) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase.from("leads").update({ category: value }).eq("id", lead.id);
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    onUpdate({ ...lead, category: value });
    setEditing(false);
  };

  const cancel = () => { setDraft(lead.category ?? ""); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          onBlur={save}
          placeholder="Category…"
          disabled={saving}
          className="flex-1 min-w-0 px-2 py-1 text-xs bg-card border border-[#00C4C8] rounded outline-none focus:ring-2 focus:ring-[#00C4C8]/20 text-foreground font-medium"
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-[#00C4C8] shrink-0" />}
      </div>
    );
  }

  if (lead.category) {
    return (
      <div className="group flex items-center gap-1 max-w-full">
        <button
          onClick={() => onFilter(lead.category!)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#00C4C8]/10 text-[#00C4C8] hover:bg-[#00C4C8]/20 transition-colors max-w-[110px] truncate"
          title={`Filter by "${lead.category}"`}
        >
          <Tag className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{lead.category}</span>
        </button>
        <button
          onClick={() => setEditing(true)}
          className="min-w-8 min-h-8 -mr-2 inline-flex items-center justify-center rounded text-muted-foreground hover:text-[#00C4C8] hover:bg-[#00C4C8]/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit category"
          aria-label="Edit category"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // No category — show "+ add" affordance on hover
  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors opacity-60 hover:opacity-100"
      title="Add category"
    >
      <Plus className="w-3 h-3" />
      <span>Add</span>
    </button>
  );
}

// ── Inline-editable notes cell ───────────────────────────────────────
//
// Click the preview (or "+ add") to edit in place. Blur = save, Escape = cancel.
// Width follows the column (truncate on preview). Full text shown in drawer + popover.
// Wiki-compliant: 32pt tap target via parent cell height; cyan focus border.

export function InlineNotesCell({ lead, onSave }: { lead: Lead; onSave: (notes: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) taRef.current?.focus(); }, [editing]);

  const save = async () => {
    const next = draft.trim() || null;
    if (next === (lead.notes || null)) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase.from("leads").update({ notes: next }).eq("id", lead.id);
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    onSave(next);
    setEditing(false);
  };

  const cancel = () => { setDraft(lead.notes || ""); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-start gap-1">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
          onBlur={save}
          placeholder="Notes…"
          disabled={saving}
          rows={2}
          className="flex-1 min-w-0 w-full px-2 py-1 text-xs bg-card border border-[#00C4C8] rounded outline-none focus:ring-2 focus:ring-[#00C4C8]/20 text-foreground resize-none"
        />
        {saving && <Loader2 className="w-3 h-3 animate-spin text-[#00C4C8] shrink-0 mt-1" />}
      </div>
    );
  }

  if (lead.notes) {
    return (
      <button
        onClick={() => setEditing(true)}
        title={lead.notes}
        className="w-full text-left min-h-8 px-1.5 py-1 rounded flex items-center gap-1.5 hover:bg-[#00C4C8]/5 transition-colors group/note"
      >
        <FileText className="w-3 h-3 shrink-0 text-[#00C4C8]" />
        <span className="truncate text-xs text-foreground/80 group-hover/note:text-foreground">{lead.notes}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-xs text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors min-h-8 opacity-60 hover:opacity-100"
      title="Add notes"
    >
      <Plus className="w-3 h-3" />
      <span>Add note</span>
    </button>
  );
}

// ── Notes cell with hover popover ────────────────────────────────────
//
// Wiki rules followed:
//  - Popover bg: grey (bg-popover), not color-tinted
//  - Shadow: primary-tinted (shadow-lg ring-1), ≤40% opacity
//  - Max width: keeps lines under ~9 words equivalent (max-w-md ≈ 448px)
//  - Preview: 1-2 lines truncated with ellipsis
//  - Click target: 24×24 icon button with pad (effective 32×32pt) — meets desktop min

export function NotesCell({ lead }: { lead: Lead }) {
  if (!lead.notes) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className="inline-flex items-center gap-1.5 px-2 py-1.5 min-h-8 rounded text-xs text-[#00C4C8] hover:bg-[#00C4C8]/10 transition-colors max-w-[130px]"
        aria-label="Show notes"
      >
        <FileText className="w-3 h-3 shrink-0" />
        <span className="truncate text-foreground/70">{lead.notes}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} align="start" className="z-50">
          <Tooltip.Popup
            className="max-w-md bg-popover text-popover-foreground rounded-lg shadow-lg ring-1 ring-border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            {lead.notes}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Wrap your page in <Tooltip.Provider> so multiple tooltips share a single
 * delay group (Nielsen: consistency in interaction timing).
 */
export { Tooltip as TooltipPrimitive };
