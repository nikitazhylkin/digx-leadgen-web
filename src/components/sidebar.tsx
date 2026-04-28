"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Users, Search, Settings, BarChart3, Moon, Sun, LogOut,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

const nav = [
  { href: "/", label: "Pipeline", icon: Users },
  { href: "/import", label: "Import", icon: Search },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const isDark = mounted && theme === "dark";

  useEffect(() => {
    try {
      const stored = localStorage.getItem("digx.sidebarCollapsed");
      if (stored === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("digx.sidebarCollapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  if (pathname === "/login") return null;

  return (
    <aside
      className={cn(
        "border-r border-border bg-card flex flex-col h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("border-b border-border", collapsed ? "px-2 py-4" : "px-5 py-5")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {collapsed ? (
            <div
              className="w-8 h-8 rounded-lg bg-[#0A1628] dark:bg-[#00F0F4] flex items-center justify-center cursor-pointer"
              onClick={toggleCollapsed}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <span className="text-[#00F0F4] dark:text-[#0A1628] font-bold text-sm">D</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#0A1628] dark:bg-[#00F0F4] flex items-center justify-center shrink-0">
                  <span className="text-[#00F0F4] dark:text-[#0A1628] font-bold text-sm">D</span>
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-foreground tracking-tight">DigX Leads</h1>
                  <p className="text-xs text-muted-foreground leading-tight truncate">Lead enrichment pipeline</p>
                </div>
              </div>
              <button
                onClick={toggleCollapsed}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-2" : "px-3")}>
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-all duration-150",
                collapsed ? "justify-center h-10 w-10" : "gap-2.5 px-3 py-2.5",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-border", collapsed ? "px-2 py-3 space-y-2" : "px-4 py-4 space-y-3")}>
        {/* Expand button when collapsed — give it dedicated space */}
        {collapsed && (
          <button
            onClick={toggleCollapsed}
            className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle — render inert placeholder until mounted to avoid hydration flash */}
        <button
          onClick={() => mounted && setTheme(isDark ? "light" : "dark")}
          title={collapsed && mounted ? (isDark ? "Light mode" : "Dark mode") : undefined}
          aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
          className={cn(
            "flex items-center rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
            collapsed ? "justify-center w-10 h-10" : "gap-2 w-full px-3 py-2",
          )}
        >
          {mounted ? (
            isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
          ) : (
            <span className="w-4 h-4" aria-hidden="true" />
          )}
          {!collapsed && (mounted ? (isDark ? "Light mode" : "Dark mode") : "")}
        </button>

        {/* Cost indicator — hidden when collapsed, it's non-essential */}
        {!collapsed && (
          <div className="px-3 py-2 rounded-lg bg-accent/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Cost per lead</span>
              <span className="text-xs font-mono font-semibold text-digx-cyan-dark dark:text-digx-cyan">~$0.06</span>
            </div>
          </div>
        )}

        {/* Account */}
        {email && (
          collapsed ? (
            <button
              onClick={signOut}
              aria-label={`Sign out (${email})`}
              title={`${email} — sign out`}
              className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <div className="px-3 py-2 rounded-lg bg-accent/30 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Signed in</p>
                <p className="text-xs text-foreground truncate" title={email}>{email}</p>
              </div>
              <button
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
