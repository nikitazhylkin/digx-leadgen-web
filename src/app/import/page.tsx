"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Link2, Upload, Loader2, CheckCircle, XCircle, Sparkles, Users,
} from "lucide-react";

interface EnrichResult {
  url: string;
  status: "pending" | "enriching" | "success" | "error";
  lead?: Record<string, unknown>;
  error?: string;
}

export default function ImportPage() {
  const router = useRouter();
  const [singleUrl, setSingleUrl] = useState("");
  const [bulkUrls, setBulkUrls] = useState("");
  const [results, setResults] = useState<EnrichResult[]>([]);
  const [loading, setLoading] = useState(false);

  const enrichSingle = async () => {
    if (!singleUrl.trim()) return;
    setLoading(true);
    setResults([{ url: singleUrl.trim(), status: "enriching" }]);

    try {
      const resp = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: singleUrl.trim() }),
      });
      const data = await resp.json();

      if (resp.ok) {
        setResults([{ url: singleUrl.trim(), status: "success", lead: data.lead }]);
        toast.success(`Enriched ${data.lead?.full_name || "lead"} — ICP: ${data.scoring?.tier} (${data.scoring?.total})`);
      } else {
        setResults([{ url: singleUrl.trim(), status: "error", error: data.error }]);
        toast.error(data.error || "Enrichment failed");
      }
    } catch (err) {
      setResults([{ url: singleUrl.trim(), status: "error", error: String(err) }]);
      toast.error("Network error");
    }
    setLoading(false);
  };

  const enrichBulk = async () => {
    const urls = bulkUrls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http") && u.includes("linkedin"));

    if (urls.length === 0) {
      toast.error("No valid LinkedIn URLs found");
      return;
    }

    setLoading(true);
    const initialResults: EnrichResult[] = urls.map((url) => ({ url, status: "pending" }));
    setResults(initialResults);

    // Process sequentially to avoid rate limits
    for (let i = 0; i < urls.length; i++) {
      setResults((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "enriching" } : r))
      );

      try {
        const resp = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linkedin_url: urls[i] }),
        });
        const data = await resp.json();

        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? resp.ok
                ? { ...r, status: "success", lead: data.lead }
                : { ...r, status: "error", error: data.error }
              : r
          )
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "error", error: String(err) } : r))
        );
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    toast.success(`Enriched ${successCount}/${urls.length} leads`);
    setLoading(false);
  };

  const successResults = results.filter((r) => r.status === "success");
  const errorResults = results.filter((r) => r.status === "error");

  return (
    <div>
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to pipeline
      </button>

      <h1 className="text-3xl font-bold text-foreground tracking-tight mb-2">Import Leads</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Add LinkedIn URLs to enrich, score, and generate outreach messages
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Single URL — test quality */}
        <Card className="border-l-[3px] border-l-[#00F0F4]">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[#00C4C8] dark:text-[#00F0F4]" />
              Single Lead (test quality)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Paste one LinkedIn URL to enrich and immediately see the result.
              Use this to test enrichment quality before running bulk.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://linkedin.com/in/..."
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enrichSingle()}
                className="bg-background"
              />
              <Button
                onClick={enrichSingle}
                disabled={loading || !singleUrl.trim()}
                className="bg-[#0A1628] dark:bg-[#00F0F4] text-white dark:text-[#0A1628] hover:bg-[#142238] dark:hover:bg-[#00C4C8] shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
                Enrich
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Bulk URLs */}
        <Card className="border-l-[3px] border-l-[#E560DF]">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-[#E560DF]" />
              Bulk Import (multiple URLs)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Paste multiple LinkedIn URLs, one per line. Each will be enriched
              and scored sequentially.
            </p>
            <textarea
              placeholder={"https://linkedin.com/in/person1\nhttps://linkedin.com/in/person2\nhttps://linkedin.com/in/person3"}
              value={bulkUrls}
              onChange={(e) => setBulkUrls(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring mb-3"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {bulkUrls.split("\n").filter((u) => u.trim().includes("linkedin")).length} URLs detected
              </span>
              <Button
                onClick={enrichBulk}
                disabled={loading || !bulkUrls.trim()}
                variant="outline"
                className="hover:border-[#E560DF] hover:text-[#E560DF]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />}
                Enrich All
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Enrichment Results
              </CardTitle>
              <div className="flex gap-2">
                {successResults.length > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    {successResults.length} enriched
                  </Badge>
                )}
                {errorResults.length > 0 && (
                  <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
                    {errorResults.length} failed
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                    r.status === "success"
                      ? "border-emerald-500/20 bg-emerald-500/5 cursor-pointer hover:bg-emerald-500/10"
                      : r.status === "error"
                      ? "border-red-500/20 bg-red-500/5"
                      : r.status === "enriching"
                      ? "border-[#00F0F4]/20 bg-[#00F0F4]/5"
                      : "border-border"
                  }`}
                  onClick={() => {
                    if (r.status === "success" && r.lead) {
                      router.push(`/lead/${(r.lead as Record<string, string>).id}`);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    {r.status === "enriching" && <Loader2 className="w-4 h-4 animate-spin text-[#00C4C8]" />}
                    {r.status === "success" && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                    {r.status === "error" && <XCircle className="w-4 h-4 text-red-500" />}
                    {r.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {r.status === "success" && r.lead
                          ? `${(r.lead as Record<string, string>).full_name} — ${(r.lead as Record<string, string>).company_name_casual}`
                          : r.url.replace("https://linkedin.com/in/", "").replace("https://www.linkedin.com/in/", "")}
                      </p>
                      {r.error && <p className="text-xs text-red-500">{r.error}</p>}
                    </div>
                  </div>
                  {r.status === "success" && r.lead && (
                    <Badge variant="outline" className="text-xs">
                      ICP {String((r.lead as Record<string, unknown>).icp_score)} — {String((r.lead as Record<string, unknown>).icp_tier)}
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            {successResults.length > 0 && (
              <Button
                className="mt-4 bg-[#0A1628] dark:bg-[#00F0F4] text-white dark:text-[#0A1628]"
                onClick={() => router.push("/")}
              >
                View in Pipeline →
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
