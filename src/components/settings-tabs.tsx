"use client";

// Settings vertical sub-nav.
//
// Why vertical: horizontal tabs waste 4K real estate and break Hick's Law on
// scanning patterns (eyes scan vertically by default). The 240px side nav
// matches the macOS / GitHub / Linear settings convention and frees the full
// remaining width for content — no max-w hacks needed for big screens.
//
// At md breakpoint and below, collapses to a native `<select>` since the
// 240px column would be too narrow to read alongside content on phones.

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional badge text (e.g. "Configured", "3 set") */
  badge?: string;
  badgeTone?: "ok" | "warn" | "muted";
}

export function SettingsTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <>
      {/* lg+ vertical nav — primary surface */}
      <nav className="hidden lg:flex flex-col gap-1 w-60 shrink-0">
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "group flex items-center gap-3 h-10 px-3 rounded-md text-sm transition-colors text-left",
                "border-l-2",
                isActive
                  ? "bg-accent/40 border-l-[#00C4C8] text-foreground font-medium"
                  : "border-l-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground",
              )}
            >
              <t.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#00C4C8]" : "")} />
              <span className="flex-1 min-w-0">{t.label}</span>
              {t.badge && (
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    t.badgeTone === "ok" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    t.badgeTone === "warn" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                    (t.badgeTone === "muted" || !t.badgeTone) && "bg-secondary/70 text-muted-foreground",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* md and below — collapse to dropdown */}
      <div className="lg:hidden mb-6">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm text-foreground"
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.badge ? `  (${t.badge})` : ""}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
