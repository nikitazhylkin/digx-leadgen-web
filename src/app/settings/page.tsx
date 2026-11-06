"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import {
  Loader2, Check, Eye, EyeOff, KeyRound, CheckCircle2, Info,
  Activity, DollarSign, ExternalLink, Workflow, ListChecks,
  Target, Clock, Bell, UserCircle, Plug,
} from "lucide-react";
import { SettingsTabs, type TabDef } from "@/components/settings-tabs";
import { IcpEditor } from "@/components/icp-editor";
import { DEFAULT_ICP_RULES, type IcpRules } from "@/lib/icp-rules";

interface KeyStatus { set: boolean; last4: string | null; updated_at: string | null }
interface ConfigResponse {
  config: Record<string, KeyStatus>;
  envPresent: Record<string, boolean>;
}

const KEYS: Array<{
  key: string;
  label: string;
  helpText: string;
  url?: string;
  urlLabel?: string;
}> = [
  {
    key: "perplexity_api_key",
    label: "Perplexity API key",
    helpText: "Core to enrichment. Runs three research queries per lead: structured person profile, company offering/growth/pain signals, and named proof points (customers, partnerships). Without this, enrichment is basically just raw extension data.",
    url: "https://www.perplexity.ai/settings/api",
    urlLabel: "Get a key at perplexity.ai",
  },
  {
    key: "theirstack_api_key",
    label: "TheirStack API key",
    helpText: "Detects the target company's tech stack and hiring signals (with dates, seniority, velocity). Optional but high-value for Saraev-grade messages.",
    url: "https://app.theirstack.com",
    urlLabel: "Get a key at theirstack.com",
  },
  {
    key: "anthropic_api_key",
    label: "Anthropic API key (Claude)",
    helpText: "Generates the 3 Saraev-style message variants. Required for the 'Generate messages' action.",
    url: "https://console.anthropic.com/settings/keys",
    urlLabel: "Get a key at console.anthropic.com",
  },
];

// Per-lead cost approximation. Used to render the estimated-spend card.
// These are rough averages — actual cost varies with cache hits + payload size.
const COST_PER_ENRICHED_LEAD_USD = 0.042;   // Perplexity ($0.015) + TheirStack ($0.017) + Claude (~$0.01)
const COST_PER_GENERATED_MESSAGE_USD = 0.01; // Claude generation only (re-runs for "Regenerate")

interface HealthSnapshot {
  cap: number;
  base: number;
  reason: string;
  acceptanceRate14d: number | null;
  requestsSent14d: number;
  accepted14d: number;
  weekend: boolean;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "idle" | "saving" | "saved">>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [spend30d, setSpend30d] = useState<{ enriched: number; messaged: number; total: number } | null>(null);

  // ClickUp test-connection state. Distinct from save state because the test
  // is its own RPC against the ClickUp API.
  const [clickupTestState, setClickupTestState] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [clickupTestMsg, setClickupTestMsg] = useState<string>("");

  // Tabbed layout. Persisted in localStorage so reload returns the user to
  // their last view (matches the Pipeline page persistence pattern).
  const [activeTab, setActiveTab] = useState<string>("overview");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("digx.settingsTab");
      if (stored) setActiveTab(stored);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("digx.settingsTab", activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // ICP rules — loaded from /api/settings GET (which already returns app_config),
  // parsed from the icp_rules JSON blob. We need the raw value here, but the
  // existing endpoint redacts to last4. Workaround: fetch the raw blob via a
  // separate query keyed on session — for now read via supabase direct since
  // app_config is already served to authenticated users via RLS for non-secret keys.
  const [icpRules, setIcpRules] = useState<IcpRules>(DEFAULT_ICP_RULES);
  useEffect(() => {
    if (activeTab !== "icp") return;
    (async () => {
      const res = await fetch("/api/icp-rules", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.rules) setIcpRules(data.rules);
    })();
  }, [activeTab]);
  const saveIcpRules = async (next: IcpRules) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "icp_rules", value: JSON.stringify(next) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    setIcpRules(next);
  };

  const testClickup = async () => {
    setClickupTestState("testing");
    setClickupTestMsg("");
    try {
      const res = await fetch("/api/clickup/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setClickupTestState("ok");
        const space = data.list?.space?.name ? ` in "${data.list.space.name}"` : "";
        setClickupTestMsg(`Connected to "${data.list?.name ?? "list"}"${space}`);
      } else {
        setClickupTestState("err");
        setClickupTestMsg(data.error || "Test failed");
      }
    } catch (e) {
      setClickupTestState("err");
      setClickupTestMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const load = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setLoadError(errBody.error || `HTTP ${res.status}`);
        return;
      }
      const data: ConfigResponse = await res.json();
      setStatus(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { load(); }, []);

  // Pull the live extension cap signals from /api/health + estimate 30-day spend
  // from `enrichment_completeness` and `message_variants` counts. Both are fast
  // count-only Supabase queries — refresh on every Settings load.
  useEffect(() => {
    const loadOps = async () => {
      // Health (extension cap state)
      try {
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
        const r = await fetch("/api/health", { headers: { apikey: anonKey } });
        if (r.ok) setHealth(await r.json());
      } catch { /* leave null */ }

      // Estimated spend (30 days)
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [enrichedRes, messagedRes] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("updated_at", since)
          .not("enrichment_completeness", "is", null),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("updated_at", since)
          .not("message_variants", "is", null),
      ]);
      const enriched = enrichedRes.count ?? 0;
      const messaged = messagedRes.count ?? 0;
      setSpend30d({
        enriched,
        messaged,
        total: enriched * COST_PER_ENRICHED_LEAD_USD + messaged * COST_PER_GENERATED_MESSAGE_USD,
      });
    };
    loadOps();
  }, []);

  const save = async (key: string) => {
    const value = drafts[key] ?? "";
    if (value.length > 0 && value.length < 10) {
      setErrors((prev) => ({ ...prev, [key]: "That's too short to be a valid API key." }));
      return;
    }
    setErrors((prev) => ({ ...prev, [key]: "" }));
    setSaveState((s) => ({ ...s, [key]: "saving" }));
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveState((s) => ({ ...s, [key]: "idle" }));
      toast.error(`Save failed: ${data.error ?? res.status}`);
      return;
    }
    setSaveState((s) => ({ ...s, [key]: "saved" }));
    setDrafts((d) => ({ ...d, [key]: "" })); // clear input after save
    toast.success(value ? "API key saved" : "API key cleared");
    load();
    setTimeout(() => setSaveState((s) => ({ ...s, [key]: "idle" })), 2000);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Settings</h1>
        <p className="text-base text-muted-foreground mt-2 max-w-3xl">
          API keys, system status, and operational signals. Keys are stored in Supabase and rotate live — no redeploy.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        {/* Vertical sub-nav (240px) */}
        <SettingsTabs
          active={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "overview", label: "Overview", icon: Activity },
            {
              id: "integrations",
              label: "Integrations",
              icon: Plug,
              badge: status?.config.clickup_api_token?.set && status?.config.clickup_list_id?.set ? "Connected" : undefined,
              badgeTone: "ok",
            },
            {
              id: "apikeys",
              label: "API keys",
              icon: KeyRound,
              badge: status ? `${[
                status.config.perplexity_api_key,
                status.config.theirstack_api_key,
                status.config.anthropic_api_key,
              ].filter((k) => k?.set).length}/3` : undefined,
              badgeTone: "muted",
            },
            { id: "icp", label: "ICP rules", icon: Target },
            { id: "outreach", label: "Outreach", icon: Clock, badge: "Soon", badgeTone: "muted" },
            { id: "notifications", label: "Notifications", icon: Bell, badge: "Soon", badgeTone: "muted" },
            { id: "account", label: "Account", icon: UserCircle, badge: "Soon", badgeTone: "muted" },
          ] satisfies TabDef[]}
        />

        {/* Active section */}
        <div className="flex-1 min-w-0">

      {/* OVERVIEW TAB — ops cards + enrichment info */}
      {activeTab === "overview" && (
      <>
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Extension daily cap */}
        <div className="rounded-lg bg-card border border-border p-5">
          <div className="flex items-start gap-2 mb-3">
            <span className="w-7 h-7 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0">
              <Activity className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Extension daily cap</h3>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">Adaptive — adjusts to acceptance rate + day-of-week</p>
            </div>
          </div>
          {health ? (
            <>
              <p className="text-3xl font-bold text-foreground tabular-nums leading-none">
                {health.cap}
                <span className="text-sm text-muted-foreground font-normal"> / day</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {health.reason}
              </p>
              <div className="mt-3 pt-3 border-t border-border space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Base cap</span>
                  <span className="tabular-nums text-foreground">{health.base}/day</span>
                </div>
                <div className="flex justify-between">
                  <span>14d acceptance rate</span>
                  <span className="tabular-nums text-foreground">
                    {health.acceptanceRate14d != null
                      ? `${Math.round(health.acceptanceRate14d * 100)}% (${health.accepted14d}/${health.requestsSent14d})`
                      : "no data"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Today is a weekend</span>
                  <span className="tabular-nums text-foreground">{health.weekend ? "yes" : "no"}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic py-6 text-center">Loading…</p>
          )}
        </div>

        {/* Estimated spend */}
        <div className="rounded-lg bg-card border border-border p-5">
          <div className="flex items-start gap-2 mb-3">
            <span className="w-7 h-7 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0">
              <DollarSign className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Est. enrichment spend</h3>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">Last 30 days · approximate</p>
            </div>
          </div>
          {spend30d ? (
            <>
              <p className="text-3xl font-bold text-foreground tabular-nums leading-none">
                ${spend30d.total.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {spend30d.enriched} enriched · {spend30d.messaged} messaged
              </p>
              <div className="mt-3 pt-3 border-t border-border space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Per enriched lead</span>
                  <span className="tabular-nums text-foreground">~${COST_PER_ENRICHED_LEAD_USD.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Per generated message</span>
                  <span className="tabular-nums text-foreground">~${COST_PER_GENERATED_MESSAGE_USD.toFixed(3)}</span>
                </div>
                <div className="text-xs italic mt-2">
                  Rough avg of Perplexity + TheirStack + Claude. Actual cost varies.
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic py-6 text-center">Loading…</p>
          )}
        </div>

        {/* Quick links */}
        <div className="rounded-lg bg-card border border-border p-5">
          <div className="flex items-start gap-2 mb-3">
            <span className="w-7 h-7 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Quick links</h3>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">Jump to ops dashboards</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <a href={process.env.NEXT_PUBLIC_SUPABASE_DASHBOARD_URL ?? "https://supabase.com/dashboard"}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-accent text-foreground transition-colors">
              <span>Supabase dashboard</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a href={process.env.NEXT_PUBLIC_VERCEL_DASHBOARD_URL ?? "https://vercel.com/dashboard"}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-accent text-foreground transition-colors">
              <span>Vercel deployments</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a href="https://console.anthropic.com/usage"
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-accent text-foreground transition-colors">
              <span>Anthropic usage</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a href="https://www.perplexity.ai/settings/api"
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-accent text-foreground transition-colors">
              <span>Perplexity API console</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-secondary/50 border border-border text-sm">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-[#00C4C8] mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-foreground font-semibold">What enrichment runs:</p>
            <ul className="text-foreground/80 space-y-1.5 ml-4 list-disc">
              <li><b className="text-foreground">Extension</b> seeds name + title + company + industry + location at scrape time</li>
              <li><b className="text-foreground">Perplexity</b> writes the person + company research and surfaces proof points</li>
              <li><b className="text-foreground">TheirStack</b> pulls tech stack + last-30-days hiring signals from the company domain</li>
              <li><b className="text-foreground">Claude</b> turns it all into 3 Saraev-style message variants</li>
            </ul>
          </div>
        </div>
      </div>
      </>
      )}

      {/* INTEGRATIONS — ClickUp (Sales handoff) */}
      {activeTab === "integrations" && (
      <>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Integrations</h2>
        <p className="text-xs text-muted-foreground mt-0.5">External systems the dashboard hands off to.</p>
      </div>

      {status && (
        <section className="p-6 rounded-lg border border-border bg-card mb-8">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Workflow className="w-4 h-4 text-[#00C4C8]" />
              <h3 className="text-base font-semibold">ClickUp — Sales pipeline</h3>
            </div>
            {status.config.clickup_api_token?.set && status.config.clickup_list_id?.set && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Configured
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground mb-6 leading-relaxed max-w-3xl">
            When a lead replies, push them to ClickUp with full context (LinkedIn, ICP, message used) and a click in the drawer.
            From there the conversation lives in ClickUp — this dashboard handles everything <em>before</em> the conversation.
          </p>

          <div className="grid lg:grid-cols-5 gap-6">
            {/* Left column — form (3/5 width on lg, full on smaller) */}
            <div className="lg:col-span-3 space-y-3">
            {(["clickup_api_token", "clickup_list_id"] as const).map((key) => {
              const s = status.config[key] || { set: false, last4: null, updated_at: null };
              const sv = saveState[key] ?? "idle";
              const isRevealed = reveal[key];
              const labels: Record<string, { label: string; placeholder: string; isSecret: boolean }> = {
                clickup_api_token: { label: "API token", placeholder: s.set ? `Replace existing (ends in ${s.last4})` : "pk_…", isSecret: true },
                clickup_list_id:   { label: "Pipeline List ID", placeholder: s.set ? `Replace existing (${s.last4})` : "e.g. 901234567890", isSecret: false },
              };
              const meta = labels[key];
              return (
                <div key={key}>
                  <Label htmlFor={key} className="text-xs font-medium text-foreground mb-1.5 block">{meta.label}</Label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input
                        id={key}
                        type={meta.isSecret && !isRevealed ? "password" : "text"}
                        placeholder={meta.placeholder}
                        value={drafts[key] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") save(key); }}
                        disabled={sv === "saving"}
                        className={`${meta.isSecret ? "pr-10 font-mono" : ""} text-sm`}
                      />
                      {meta.isSecret && (
                        <button
                          type="button"
                          onClick={() => setReveal((r) => ({ ...r, [key]: !r[key] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                          aria-label={isRevealed ? "Hide" : "Reveal"}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    <Button
                      onClick={() => save(key)}
                      disabled={sv === "saving" || (drafts[key] ?? "").length === 0}
                      className="shrink-0 bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 min-w-[88px]"
                    >
                      {sv === "saving" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</> :
                       sv === "saved" ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved</> :
                       "Save"}
                    </Button>
                  </div>
                </div>
              );
            })}

              {/* Test connection */}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testClickup}
                  disabled={
                    clickupTestState === "testing" ||
                    !status.config.clickup_api_token?.set ||
                    !status.config.clickup_list_id?.set
                  }
                  className="border-border"
                >
                  {clickupTestState === "testing" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</> :
                   <><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Test connection</>}
                </Button>
                {clickupTestState === "ok" && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {clickupTestMsg}
                  </span>
                )}
                {clickupTestState === "err" && (
                  <span className="inline-flex items-center gap-1 text-xs text-red-500" title={clickupTestMsg}>
                    <Info className="w-3.5 h-3.5" />
                    {clickupTestMsg.length > 80 ? clickupTestMsg.slice(0, 80) + "…" : clickupTestMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Right column — setup checklist (2/5 width on lg, full on smaller) */}
            <div className="lg:col-span-2">
              <div className="p-4 rounded-lg bg-secondary/50 border border-border h-full">
                <div className="flex items-start gap-2.5 mb-3">
                  <ListChecks className="w-4 h-4 text-[#00C4C8] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Recommended ClickUp setup</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Create this once, then paste the List ID below.</p>
                  </div>
                </div>
                <ol className="text-xs text-muted-foreground space-y-2 ml-6 list-decimal">
                  <li>In ClickUp, create a <b className="text-foreground">Space</b> called <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded">DigX Sales</code>.</li>
                  <li>Inside it, create a <b className="text-foreground">List</b> called <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded">Pipeline</code>.</li>
                  <li>Statuses: <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded">Replied → Qualified → Proposal → Won → Lost</code>.</li>
                  <li>(Optional) Custom fields: <span className="text-foreground">ICP tier</span>, <span className="text-foreground">Source</span>, <span className="text-foreground">LinkedIn URL</span>.</li>
                  <li>Open the list → <b className="text-foreground">⋯</b> menu → Copy link. The number after <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded">/li/</code> is the List ID.</li>
                  <li>Personal API token: ClickUp → avatar → <a href="https://app.clickup.com/settings/apps" target="_blank" rel="noopener noreferrer" className="text-[#00C4C8] hover:underline">Apps</a> → Generate.</li>
                </ol>
              </div>
            </div>
          </div>
        </section>
      )}

      </>
      )}

      {/* API KEYS */}
      {activeTab === "apikeys" && (
      <>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">API keys</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Server-side only. Stored in Supabase, never exposed to the browser.</p>
      </div>

      {!status && !loadError && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin text-[#00C4C8]" />
        </div>
      )}

      {loadError && (
        <div className="p-5 rounded-lg border border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground mb-1">Could not load settings</h3>
              <p className="text-sm text-muted-foreground mb-2">
                The <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded">app_config</code> table may be missing or the
                <code className="font-mono text-xs bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded ml-1">SUPABASE_SERVICE_ROLE_KEY</code> env var is unset.
                Check the deployment logs.
              </p>
              <p className="text-xs text-muted-foreground mt-2">Error: <span className="font-mono">{loadError}</span></p>
            </div>
          </div>
        </div>
      )}

      {status && (
        <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {KEYS.map(({ key, label, helpText, url, urlLabel }) => {
            const s = status.config[key] || { set: false, last4: null, updated_at: null };
            const envTakesOver = status.envPresent[key];
            const sv = saveState[key] ?? "idle";
            const err = errors[key];
            const isRevealed = reveal[key];

            return (
              <section key={key} className="p-5 rounded-lg border border-border bg-card">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#00C4C8]" />
                    <Label htmlFor={key} className="text-base font-semibold">{label}</Label>
                  </div>
                  {s.set && !envTakesOver && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Configured · ending in {s.last4}
                    </span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{helpText}</p>

                {envTakesOver && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      An env-var is currently set, which takes precedence over any value you save here.
                      Unset <code className="font-mono bg-black/10 dark:bg-white/10 px-1 rounded">{key.toUpperCase()}</code> in <code className="font-mono bg-black/10 dark:bg-white/10 px-1 rounded">.env.local</code> to use this UI.
                    </span>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      id={key}
                      type={isRevealed ? "text" : "password"}
                      placeholder={s.set ? `Paste a new key to replace the existing one (ends in ${s.last4})` : "Paste API key here"}
                      value={drafts[key] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") save(key); }}
                      disabled={sv === "saving"}
                      className={`pr-10 font-mono text-sm ${err ? "border-red-500" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((r) => ({ ...r, [key]: !r[key] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={isRevealed ? "Hide" : "Reveal"}
                    >
                      {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button
                    onClick={() => save(key)}
                    disabled={sv === "saving" || (drafts[key] ?? "").length === 0}
                    className="shrink-0 bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 min-w-[100px]"
                  >
                    {sv === "saving" ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</> :
                     sv === "saved" ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved</> :
                     "Save key"}
                  </Button>
                </div>

                {err && <p className="mt-1.5 text-xs text-red-500">{err}</p>}

                {s.set && !envTakesOver && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Last updated {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Clear ${label}?`)) {
                          setDrafts((d) => ({ ...d, [key]: "" }));
                          fetch("/api/settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ key, value: null }),
                          }).then(() => { toast.success("Key cleared"); load(); });
                        }
                      }}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      Clear key
                    </button>
                  </div>
                )}

                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-block text-xs text-[#00C4C8] hover:underline">
                    {urlLabel}
                  </a>
                )}
              </section>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* ICP RULES */}
      {activeTab === "icp" && (
        <div>
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">ICP rules</h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">
              Tier thresholds + extra hard-exclude keywords. Built-in excludes (alcohol, construction, heavy industry, etc.) stay in effect — these <em>add</em> to them. Saves apply to the very next score on incoming leads.
            </p>
          </div>
          <IcpEditor initial={icpRules} onSave={saveIcpRules} />
        </div>
      )}

      {/* OUTREACH (Task 4 — placeholder for now) */}
      {activeTab === "outreach" && <ComingSoon section="Outreach config" detail="Manual override of the adaptive daily cap, working hours window, weekend toggle, per-user cap." />}

      {/* NOTIFICATIONS (Task 5) */}
      {activeTab === "notifications" && <ComingSoon section="Notifications" detail="Telegram alerts on reply, acceptance-rate dip, enrichment errors. Optional email digest." />}

      {/* ACCOUNT (Task 6) */}
      {activeTab === "account" && <ComingSoon section="Account" detail="Change password, sign out everywhere, future teammate invites." />}

        </div>
      </div>
    </div>
  );
}

function ComingSoon({ section, detail }: { section: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-8">
      <div className="flex items-start gap-4 max-w-3xl">
        <span className="w-10 h-10 rounded-md bg-secondary/50 text-muted-foreground inline-flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{section}</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{detail}</p>
          <p className="text-xs text-muted-foreground/70 mt-4">Queued for the next pass — not yet implemented.</p>
        </div>
      </div>
    </div>
  );
}
