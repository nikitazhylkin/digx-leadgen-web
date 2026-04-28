"use client";

// ICP rules editor — tier thresholds + additional hard-exclude keywords.
//
// Layout: 2-column grid on lg breakpoints, single column below md.
//   Left: tier thresholds (3 numeric inputs with descriptive context)
//   Right: additional excludes (chip multi-input list, one row per group)
//
// Save semantics: the whole rules object is written to app_config.icp_rules
// as a JSON blob in a single POST. The /api/settings route invalidates the
// in-process icp-rules cache on save so the next score call picks it up.

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X, Check, RotateCcw, Target, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IcpRules, AdditionalExclude } from "@/lib/icp-rules";
import { DEFAULT_ICP_RULES } from "@/lib/icp-rules";

interface IcpEditorProps {
  initial: IcpRules;
  onSave: (rules: IcpRules) => Promise<void>;
}

export function IcpEditor({ initial, onSave }: IcpEditorProps) {
  const [rules, setRules] = useState<IcpRules>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => { setRules(initial); }, [initial]);

  const dirty =
    rules.tiers.hot !== initial.tiers.hot ||
    rules.tiers.warm !== initial.tiers.warm ||
    rules.tiers.cold !== initial.tiers.cold ||
    JSON.stringify(rules.additionalExcludes) !== JSON.stringify(initial.additionalExcludes);

  const validation = (() => {
    const { hot, warm, cold } = rules.tiers;
    if (hot <= warm) return "HOT threshold must be greater than WARM.";
    if (warm <= cold) return "WARM threshold must be greater than COLD.";
    if (cold < 0 || hot > 100) return "Thresholds must be between 0 and 100.";
    return null;
  })();

  const save = async () => {
    if (validation) { toast.error(validation); return; }
    setSaveState("saving");
    try {
      await onSave(rules);
      setSaveState("saved");
      toast.success("ICP rules saved — applies to next score");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) {
      setSaveState("idle");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const reset = () => {
    if (!confirm("Reset to defaults? Your custom rules will be cleared.")) return;
    setRules(DEFAULT_ICP_RULES);
  };

  return (
    <div>
      {/* Two-column grid on lg: tier thresholds (compact) + excludes (expansive) */}
      <div className="grid lg:grid-cols-5 gap-6 mb-8">
        {/* Tier thresholds — col-span 2 (compact, three small inputs) */}
        <section className="lg:col-span-2 rounded-lg border border-border bg-card p-6">
          <header className="flex items-start gap-3 mb-4">
            <span className="w-8 h-8 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0">
              <Target className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">Tier thresholds</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Minimum score for each tier. Below COLD = SKIP. Score range 0–100.
              </p>
            </div>
          </header>
          <div className="grid grid-cols-3 gap-3">
            {(["hot", "warm", "cold"] as const).map((tierKey) => (
              <label key={tierKey} className="block">
                <span className="text-xs uppercase tracking-wide font-semibold text-muted-foreground block mb-2">
                  {tierKey}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={rules.tiers[tierKey]}
                  onChange={(e) =>
                    setRules({
                      ...rules,
                      tiers: { ...rules.tiers, [tierKey]: Number(e.target.value) || 0 },
                    })
                  }
                  className="text-base font-semibold tabular-nums h-12 text-center"
                />
                <span className="text-xs text-muted-foreground mt-2 block leading-tight">
                  {tierKey === "hot" && "≥ becomes HOT"}
                  {tierKey === "warm" && "≥ becomes WARM"}
                  {tierKey === "cold" && "≥ becomes COLD"}
                </span>
              </label>
            ))}
          </div>
          {validation && (
            <p className="text-xs text-red-500 mt-4">{validation}</p>
          )}
        </section>

        {/* Additional hard excludes — col-span 3 (the big editor) */}
        <section className="lg:col-span-3 rounded-lg border border-border bg-card p-6">
          <header className="flex items-start gap-3 mb-4">
            <span className="w-8 h-8 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 inline-flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">Additional hard excludes</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Force any lead matching these keywords to SKIP. Adds on top of the
                built-in calibrated list (alcohol, construction, heavy industry, etc).
                Case-insensitive match on industry, description, specialties, headline.
              </p>
            </div>
          </header>
          <ExcludeListEditor
            value={rules.additionalExcludes}
            onChange={(additionalExcludes) => setRules({ ...rules, additionalExcludes })}
          />
        </section>
      </div>

      {/* Save / Reset bar — sticky-ish, full-width */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={saveState === "saving"}
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Reset to defaults
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={saveState === "saving" || !dirty || Boolean(validation)}
          className="bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 min-w-[112px]"
        >
          {saveState === "saving" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</> :
           saveState === "saved" ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved</> :
           "Save rules"}
        </Button>
      </div>
    </div>
  );
}

// ─── ExcludeListEditor ────────────────────────────────────────────────
// Renders a stack of exclude rows. Each row has a reason input + a chip
// list of keywords. Last row is "Add new" (+ button).

function ExcludeListEditor({
  value,
  onChange,
}: {
  value: AdditionalExclude[];
  onChange: (next: AdditionalExclude[]) => void;
}) {
  const updateRow = useCallback(
    (idx: number, patch: Partial<AdditionalExclude>) => {
      const next = [...value];
      next[idx] = { ...next[idx], ...patch };
      onChange(next);
    },
    [value, onChange],
  );
  const removeRow = useCallback(
    (idx: number) => onChange(value.filter((_, i) => i !== idx)),
    [value, onChange],
  );
  const addRow = useCallback(
    () => onChange([...value, { keywords: [], reason: "" }]),
    [value, onChange],
  );

  return (
    <div className="space-y-4">
      {value.length === 0 && (
        <div className="text-xs text-muted-foreground italic px-4 py-8 text-center border border-dashed border-border rounded-md">
          No additional excludes yet. Click <b>Add exclude rule</b> below to start.
        </div>
      )}
      {value.map((rule, idx) => (
        <div key={idx} className="rounded-md border border-border bg-secondary/50 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <label className="flex-1 min-w-0">
              <span className="text-xs uppercase tracking-wide font-semibold text-muted-foreground block mb-1.5">
                Reason
              </span>
              <Input
                placeholder="e.g. Crypto-only — outside DigX scope"
                value={rule.reason}
                onChange={(e) => updateRow(idx, { reason: e.target.value })}
                className="text-sm"
              />
            </label>
            <button
              onClick={() => removeRow(idx)}
              className="mt-6 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
              aria-label="Remove exclude rule"
              title="Remove rule"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide font-semibold text-muted-foreground block mb-1.5">
              Match keywords
            </span>
            <ChipMultiInput
              values={rule.keywords}
              onChange={(keywords) => updateRow(idx, { keywords })}
              placeholder="Type a keyword and press Enter"
            />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Add exclude rule
      </Button>
    </div>
  );
}

// ─── ChipMultiInput ───────────────────────────────────────────────────
// Renders an array of strings as cyan chips. Type + Enter to add. Click chip
// to remove. Backspace on empty input also removes the last chip.

function ChipMultiInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const addCurrent = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) { setDraft(""); return; }
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-border bg-card min-h-[44px]">
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-[#00C4C8]/15 text-[#00C4C8] border border-[#00C4C8]/30 text-xs font-medium"
        >
          {v}
          <button
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="text-[#00C4C8]/70 hover:text-[#00C4C8]"
            aria-label={`Remove ${v}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addCurrent();
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={addCurrent}
        className="flex-1 min-w-[140px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
