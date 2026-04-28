"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Popover } from "@base-ui/react/popover";
import { Tag, Check, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CategoryPicker — Clay/Linear-style combobox.
 * - Trigger = button showing current value (or placeholder)
 * - Dropdown = search input + list of existing categories + "Create new: X" when
 *   query doesn't exactly match an existing one
 * - Enter creates/selects, Escape closes, arrow keys navigate
 *
 * Wiki rules applied:
 *  - 32pt min tap target on each list item
 *  - grey popover bg (bg-popover), ring-1 border shadow (≤40% opacity)
 *  - max-w-sm on content — keeps lines ≤9 words
 *  - Hick's Law: single search input, not multiple filters
 */
export interface CategoryPickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  categories: string[];
  /** "trigger" style: a chip-like button; "inline" style: a subtle pencil/plus affordance */
  variant?: "trigger" | "inline" | "button";
  placeholder?: string;
  /** Custom button label — overrides value display when provided. Useful for bulk toolbar. */
  label?: string;
  disabled?: boolean;
}

export function CategoryPicker({
  value,
  onChange,
  categories,
  variant = "trigger",
  placeholder = "Add category",
  label,
  disabled,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // autofocus on open
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.toLowerCase().includes(q));
  }, [categories, query]);

  const exactMatch = useMemo(
    () => categories.some((c) => c.toLowerCase() === query.trim().toLowerCase()),
    [categories, query]
  );
  const canCreate = query.trim().length > 0 && !exactMatch;

  // Combined list: filtered + "Create new" option at the end
  const items: Array<{ kind: "existing" | "create" | "clear"; value: string; label: string }> = [
    ...(value ? [{ kind: "clear" as const, value: "", label: "Clear category" }] : []),
    ...filtered.map((c) => ({ kind: "existing" as const, value: c, label: c })),
    ...(canCreate ? [{ kind: "create" as const, value: query.trim(), label: `Create "${query.trim()}"` }] : []),
  ];

  const pick = (item: { kind: "existing" | "create" | "clear"; value: string }) => {
    if (item.kind === "clear") onChange(null);
    else onChange(item.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlight];
      if (item) pick(item);
    } else if (e.key === "Escape") setOpen(false);
  };

  // Keep highlight in bounds when list changes
  useEffect(() => {
    if (highlight >= items.length) setHighlight(Math.max(0, items.length - 1));
  }, [items.length, highlight]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 transition-colors",
          variant === "trigger" && (value
            ? "px-2 py-1 text-[11px] font-medium bg-[#00C4C8]/10 text-[#00C4C8] hover:bg-[#00C4C8]/20 max-w-[140px] min-h-8 rounded"
            : "px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground opacity-60 hover:opacity-100 min-h-8 rounded"),
          variant === "inline" && "px-2 py-1 text-xs border border-dashed border-border hover:border-[#00C4C8] hover:bg-[#00C4C8]/5 min-h-8 rounded",
          variant === "button" && "h-7 px-3 text-sm font-medium rounded-lg border border-[#00C4C8]/40 text-[#00F0F4] hover:bg-[#00C4C8]/20",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        aria-label={value ? `Category: ${value}` : placeholder}
      >
        {variant === "button" ? (
          <>
            <Tag className="w-3.5 h-3.5" />
            {label || "Tag category"}
          </>
        ) : value ? (
          <>
            <Tag className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{value}</span>
          </>
        ) : (
          <>
            <Plus className="w-3 h-3" />
            <span>{placeholder}</span>
          </>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={4} className="z-50">
          <Popover.Popup
            onKeyDown={onKeyDown}
            className={cn(
              "w-64 max-w-sm rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-border outline-none overflow-hidden",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                placeholder="Search or create…"
                className="flex-1 min-w-0 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
              />
              {query && (
                <button onClick={() => setQuery("")}
                  className="w-5 h-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Items */}
            <div className="max-h-60 overflow-y-auto py-1">
              {items.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No categories yet. Type to create one.</div>
              )}
              {items.map((item, i) => {
                const isActive = i === highlight;
                const isCurrent = item.kind === "existing" && item.value === value;
                return (
                  <button
                    key={`${item.kind}-${item.value}-${i}`}
                    onClick={() => pick(item)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "w-full text-left flex items-center gap-2 px-3 py-2 text-sm min-h-8 transition-colors",
                      isActive && "bg-accent",
                      item.kind === "clear" && "text-red-500 border-b border-border",
                    )}
                  >
                    {item.kind === "create" ? (
                      <Plus className="w-3.5 h-3.5 text-[#00C4C8] shrink-0" />
                    ) : item.kind === "clear" ? (
                      <X className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Tag className="w-3.5 h-3.5 text-[#00C4C8] shrink-0" />
                    )}
                    <span className="flex-1 truncate">{item.label}</span>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-[#00C4C8] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
