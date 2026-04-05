"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Users, Search, Settings, BarChart3, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Pipeline", icon: Users },
  { href: "/import", label: "Import", icon: Search },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#0A1628] dark:bg-[#00F0F4] flex items-center justify-center">
            <span className="text-[#00F0F4] dark:text-[#0A1628] font-bold text-sm">D</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground tracking-tight">DigX Leads</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">Lead enrichment pipeline</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border space-y-3">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        {/* Cost indicator */}
        <div className="px-3 py-2 rounded-lg bg-accent/50">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Cost per lead</span>
            <span className="text-[11px] font-mono font-semibold text-digx-cyan-dark dark:text-digx-cyan">~$0.06</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
