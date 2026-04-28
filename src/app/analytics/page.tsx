"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, TrendingUp, Flame, Target, UserCheck, AlertTriangle, PieChart as PieIcon } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell,
  LineChart, Line, Tooltip,
  PieChart, Pie,
} from "recharts";

// Analytics page — metrics that matter for the connection-first outreach flow.
// Pulls everything directly from Supabase with RLS-protected authenticated reads.

type FunnelRow = { stage: string; count: number };
type PerUserRow = { actor: string; approve: number; reject: number };
type ReasonRow = { reason: string; count: number };
type TierRow = { tier: string; count: number; color: string };
type Sparkline = { day: string; value: number }[];

const TIER_COLORS: Record<string, string> = {
  HOT: "#EF4444",
  WARM: "#F59E0B",
  COLD: "#38BDF8",
  SKIP: "#6B7280",
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);

  // Metrics
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [acceptanceRate, setAcceptanceRate] = useState<{ pct: number; numerator: number; denominator: number } | null>(null);
  const [replyRate, setReplyRate] = useState<{ pct: number; numerator: number; denominator: number } | null>(null);
  const [acceptSparkline, setAcceptSparkline] = useState<Sparkline>([]);
  const [replySparkline, setReplySparkline] = useState<Sparkline>([]);
  const [perUser, setPerUser] = useState<PerUserRow[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<ReasonRow[]>([]);
  const [tierDist, setTierDist] = useState<TierRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // 1. Funnel — stage counts over last 14d
      const since14 = daysAgo(14);
      const { data: funnelLeads } = await supabase
        .from("leads")
        .select("outreach_status")
        .gte("created_at", since14);

      const statusCounts: Record<string, number> = {};
      (funnelLeads ?? []).forEach((l) => {
        const s = (l as { outreach_status: string }).outreach_status;
        statusCounts[s] = (statusCounts[s] ?? 0) + 1;
      });
      // Cumulative funnel: each stage counts itself + everything downstream
      const stagesOrder = ["scored", "request_sent", "connected", "enriched", "messaged", "sent", "replied", "converted"];
      const cumulative: FunnelRow[] = [];
      let running = 0;
      for (let i = stagesOrder.length - 1; i >= 0; i--) {
        running += statusCounts[stagesOrder[i]] ?? 0;
        cumulative.unshift({ stage: stagesOrder[i], count: running });
      }
      // Collapse legacy 'sent' into 'messaged' for display
      const collapsed: FunnelRow[] = [
        { stage: "Scored", count: cumulative.find((r) => r.stage === "scored")?.count ?? 0 },
        { stage: "Request sent", count: cumulative.find((r) => r.stage === "request_sent")?.count ?? 0 },
        { stage: "Connected", count: cumulative.find((r) => r.stage === "connected")?.count ?? 0 },
        { stage: "Enriched", count: cumulative.find((r) => r.stage === "enriched")?.count ?? 0 },
        { stage: "Messaged", count: Math.max(cumulative.find((r) => r.stage === "messaged")?.count ?? 0, cumulative.find((r) => r.stage === "sent")?.count ?? 0) },
        { stage: "Replied", count: cumulative.find((r) => r.stage === "replied")?.count ?? 0 },
      ];
      setFunnel(collapsed);

      // 2. Acceptance rate (14d) — connections accepted / requests sent
      const { count: sentCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("request_sent_at", since14);
      const { count: acceptedCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("request_sent_at", since14)
        .not("connection_accepted_at", "is", null);
      const denom = sentCount ?? 0;
      const num = acceptedCount ?? 0;
      setAcceptanceRate({
        pct: denom > 0 ? Math.round((num / denom) * 100) : 0,
        numerator: num,
        denominator: denom,
      });

      // 3. Reply rate (14d)
      const { count: msgSentCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", since14);
      const { count: repliedCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", since14)
        .not("replied_at", "is", null);
      const rDenom = msgSentCount ?? 0;
      const rNum = repliedCount ?? 0;
      setReplyRate({
        pct: rDenom > 0 ? Math.round((rNum / rDenom) * 100) : 0,
        numerator: rNum,
        denominator: rDenom,
      });

      // 4. 7-day sparklines for acceptance + reply rate
      // Fetch all timestamps once, bucket client-side — avoids 14+ round trips.
      const { data: acceptTimeline } = await supabase
        .from("leads")
        .select("request_sent_at, connection_accepted_at")
        .gte("request_sent_at", daysAgo(14))
        .not("request_sent_at", "is", null);
      const { data: replyTimeline } = await supabase
        .from("leads")
        .select("sent_at, replied_at")
        .gte("sent_at", daysAgo(14))
        .not("sent_at", "is", null);

      const bucketByDay = (rows: { [key: string]: string | null }[], keyA: string, keyB: string): Sparkline => {
        const buckets: Record<string, { a: number; b: number }> = {};
        for (let i = 13; i >= 0; i--) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - i);
          const key = d.toISOString().slice(0, 10);
          buckets[key] = { a: 0, b: 0 };
        }
        rows.forEach((r) => {
          const tA = r[keyA];
          if (!tA) return;
          const day = tA.slice(0, 10);
          if (!buckets[day]) return;
          buckets[day].a += 1;
          if (r[keyB]) buckets[day].b += 1;
        });
        return Object.entries(buckets).map(([day, v]) => ({
          day: day.slice(5),  // MM-DD
          value: v.a > 0 ? Math.round((v.b / v.a) * 100) : 0,
        }));
      };
      setAcceptSparkline(bucketByDay(acceptTimeline ?? [], "request_sent_at", "connection_accepted_at"));
      setReplySparkline(bucketByDay(replyTimeline ?? [], "sent_at", "replied_at"));

      // 5. Per-user approvals vs rejections (14d) — from audit_log
      const { data: auditRows } = await supabase
        .from("audit_log")
        .select("actor, action")
        .gte("occurred_at", since14)
        .in("action", ["approve", "reject"]);
      const perUserMap: Record<string, { approve: number; reject: number }> = {};
      (auditRows ?? []).forEach((r) => {
        const { actor, action } = r as { actor: string; action: string };
        const a = actor || "unknown";
        if (!perUserMap[a]) perUserMap[a] = { approve: 0, reject: 0 };
        if (action === "approve") perUserMap[a].approve += 1;
        else if (action === "reject") perUserMap[a].reject += 1;
      });
      setPerUser(Object.entries(perUserMap).map(([actor, v]) => ({
        actor: actor.split("@")[0],  // short-form "nikita" / "kira"
        ...v,
      })));

      // 6. Rejection reasons (30d), top 5
      const { data: rejections } = await supabase
        .from("leads")
        .select("rejection_reason")
        .eq("qualification", "rejected")
        .gte("qualified_at", daysAgo(30))
        .not("rejection_reason", "is", null);
      const reasonMap: Record<string, number> = {};
      (rejections ?? []).forEach((r) => {
        const reason = ((r as { rejection_reason: string }).rejection_reason || "(none)").split(" · ")[0]; // strip custom-reason suffix
        reasonMap[reason] = (reasonMap[reason] ?? 0) + 1;
      });
      const topReasons = Object.entries(reasonMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }));
      setRejectionReasons(topReasons);

      // 7. ICP tier distribution (all time)
      const { data: tierRows } = await supabase
        .from("leads")
        .select("icp_tier")
        .not("icp_tier", "is", null);
      const tierCounts: Record<string, number> = { HOT: 0, WARM: 0, COLD: 0, SKIP: 0 };
      (tierRows ?? []).forEach((r) => {
        const t = (r as { icp_tier: string }).icp_tier;
        if (tierCounts[t] != null) tierCounts[t] += 1;
      });
      setTierDist(
        Object.entries(tierCounts).map(([tier, count]) => ({
          tier, count, color: TIER_COLORS[tier] ?? "#6B7280",
        }))
      );

      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div>
        <Header />
        <div className="grid lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-48 rounded-lg bg-card border border-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const totalPerUser = perUser.reduce((a, b) => a + b.approve + b.reject, 0);

  return (
    <div>
      <Header />
      <div className="grid lg:grid-cols-3 gap-4">
        {/* 1 — Pipeline funnel */}
        <Card className="lg:col-span-3">
          <CardHeader icon={<Target />} title="Pipeline funnel" subtitle="Last 14 days · conversion between stages" />
          {funnel.every((r) => r.count === 0) ? (
            <EmptyNote>No activity in the last 14 days.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {funnel.map((row, i) => {
                const max = funnel[0].count || 1;
                const pct = Math.round((row.count / max) * 100);
                const prev = i > 0 ? funnel[i - 1].count : null;
                const stepConv = prev !== null && prev > 0 ? Math.round((row.count / prev) * 100) : null;
                return (
                  <div key={row.stage}>
                    <div className="flex items-center justify-between mb-0.5 text-xs">
                      <span className="font-medium text-foreground">{row.stage}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {row.count}
                        {stepConv !== null && <span className="ml-2 text-[10px]">({stepConv}% from prev)</span>}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary/40 overflow-hidden">
                      <div className="h-full bg-[#00C4C8]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 2 — Acceptance rate */}
        <Card>
          <CardHeader icon={<UserCheck />} title="Acceptance rate" subtitle="Last 14 days" />
          {acceptanceRate && acceptanceRate.denominator > 0 ? (
            <>
              <BigNumber value={`${acceptanceRate.pct}%`} sub={`${acceptanceRate.numerator} / ${acceptanceRate.denominator} requests accepted`} />
              <Sparkline data={acceptSparkline} />
            </>
          ) : (
            <EmptyNote>No connection requests sent yet.</EmptyNote>
          )}
        </Card>

        {/* 3 — Reply rate */}
        <Card>
          <CardHeader icon={<TrendingUp />} title="Reply rate" subtitle="Last 14 days" />
          {replyRate && replyRate.denominator > 0 ? (
            <>
              <BigNumber value={`${replyRate.pct}%`} sub={`${replyRate.numerator} / ${replyRate.denominator} messages replied`} />
              <Sparkline data={replySparkline} />
            </>
          ) : (
            <EmptyNote>No messages sent yet.</EmptyNote>
          )}
        </Card>

        {/* 4 — Approvals vs rejections per user */}
        <Card>
          <CardHeader icon={<UserCheck />} title="Approvals vs rejections" subtitle="Last 14 days · per user" />
          {totalPerUser === 0 ? (
            <EmptyNote>No qualifications yet.</EmptyNote>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={perUser} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <XAxis dataKey="actor" tick={{ fill: "rgb(107,114,128)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgb(107,114,128)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "rgba(0,196,200,0.08)" }}
                />
                <Bar dataKey="approve" fill="#10B981" radius={[4, 4, 0, 0]} name="Approved" />
                <Bar dataKey="reject" fill="#EF4444" radius={[4, 4, 0, 0]} name="Rejected" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* 5 — Rejection reasons */}
        <Card className="lg:col-span-2">
          <CardHeader icon={<AlertTriangle />} title="Why rejected" subtitle="Last 30 days · top 5" />
          {rejectionReasons.length === 0 ? (
            <EmptyNote>No rejections logged yet.</EmptyNote>
          ) : (
            <div className="space-y-1.5">
              {rejectionReasons.map((r) => {
                const max = rejectionReasons[0].count;
                const pct = Math.round((r.count / max) * 100);
                return (
                  <div key={r.reason}>
                    <div className="flex items-center justify-between mb-0.5 text-xs">
                      <span className="text-foreground">{r.reason}</span>
                      <span className="tabular-nums text-muted-foreground">{r.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                      <div className="h-full bg-red-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 6 — ICP tier distribution */}
        <Card>
          <CardHeader icon={<PieIcon />} title="ICP tier mix" subtitle="All leads" />
          {tierDist.every((t) => t.count === 0) ? (
            <EmptyNote>No scored leads.</EmptyNote>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={tierDist} dataKey="count" nameKey="tier" innerRadius={40} outerRadius={60} paddingAngle={2}>
                    {tierDist.map((t) => <Cell key={t.tier} fill={t.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs mt-2">
                {tierDist.map((t) => (
                  <span key={t.tier} className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                    <span className="font-medium text-foreground">{t.tier}</span>
                    <span className="tabular-nums">{t.count}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-foreground tracking-tight">Analytics</h1>
      <p className="text-sm text-muted-foreground mt-1">
        How the pipeline is performing. Data refreshes on page load.
      </p>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-card border border-border p-5 ${className}`}>{children}</div>;
}

function CardHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2 mb-4">
      <span className="w-7 h-7 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function BigNumber({ value, sub }: { value: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-3xl font-bold text-foreground tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function Sparkline({ data }: { data: Sparkline }) {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={50}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <Line type="monotone" dataKey="value" stroke="#00C4C8" strokeWidth={2} dot={false} />
        <Tooltip
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, padding: 6 }}
          labelFormatter={(l) => `Day ${l}`}
          formatter={(v) => [`${v}%`, "rate"]}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic py-6 text-center">{children}</p>;
}
