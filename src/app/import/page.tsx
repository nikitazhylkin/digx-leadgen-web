"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Link2, Upload, Loader2, CheckCircle, XCircle, Sparkles, Users, Sheet, Search,
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

  // Google Sheet import state
  const [sheetCsv, setSheetCsv] = useState("");
  const [sheetImporting, setSheetImporting] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);

  const enrichSingle = async () => {
    const url = singleUrl.trim();
    if (!url) return;
    setLoading(true);
    setResults([{ url, status: "enriching" }]);

    try {
      // POST URL to /api/leads. Creates a URL-only row in Review queue;
      // enrichment fires later when a human approves the lead via /api/qualify.
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: url }),
      });
      const data = await resp.json();
      if (resp.ok) {
        const created = (data.leads as Record<string, unknown>[])?.[0];
        setResults([{ url, status: "success", lead: created }]);
        toast.success(
          data.created > 0
            ? "Added to Review queue"
            : "Already in Review queue"
        );
      } else {
        setResults([{ url, status: "error", error: data.error }]);
        toast.error(data.error || "Add failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults([{ url, status: "error", error: msg }]);
      toast.error(msg);
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

    // Single batch insert — /api/leads accepts an array and dedupes server-side.
    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_urls: urls }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setResults(urls.map((url) => ({ url, status: "error", error: data.error })));
        toast.error(data.error || "Bulk add failed");
        setLoading(false);
        return;
      }
      const leadsByUrl = new Map<string, Record<string, unknown>>(
        ((data.leads as Record<string, unknown>[]) || []).map((l) => [String(l.linkedin_url), l]),
      );
      setResults(
        urls.map((url) => ({
          url,
          status: "success",
          lead: leadsByUrl.get(url),
        })),
      );
      toast.success(`Added ${data.created} new, ${data.skipped} already in queue`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults(urls.map((url) => ({ url, status: "error", error: msg })));
      toast.error(msg);
    }
    setLoading(false);
  };

  const importFromSheet = async () => {
    if (!sheetCsv.trim()) return;
    setSheetImporting(true);
    setSheetResult(null);

    try {
      // Parse CSV/TSV into row objects
      const lines = sheetCsv.trim().split("\n");
      const headers = lines[0].split("\t").length > 1
        ? lines[0].split("\t")
        : lines[0].split(",");

      const rows = lines.slice(1).map((line) => {
        const values = line.split("\t").length > 1 ? line.split("\t") : line.split(",");
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h.trim()] = (values[i] || "").trim(); });
        return row;
      }).filter((r) => Object.values(r).some((v) => v.length > 0));

      const resp = await fetch("/api/import-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await resp.json();

      if (resp.ok) {
        setSheetResult(data);
        toast.success(`Imported ${data.imported} companies. Use "Find People" in Pipeline to discover contacts.`);
      } else {
        toast.error(data.error || "Import failed");
      }
    } catch (err) {
      toast.error("Failed to parse sheet data");
    }
    setSheetImporting(false);
  };

  const successResults = results.filter((r) => r.status === "success");
  const errorResults = results.filter((r) => r.status === "error");

  return (
    <div>
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to pipeline
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Import Leads</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Three ways in: paste one LinkedIn URL, paste a list, or start from a Google Sheet of companies.
          URL imports add to the Review queue — Approve a lead in Pipeline to fire enrichment (Apify + Perplexity + TheirStack).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {/* Single URL */}
        <ImportCard
          icon={<Link2 className="w-4 h-4" />}
          title="Single LinkedIn URL"
          help="Add one profile to the Review queue. Enrichment runs after you Approve it in the pipeline."
        >
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
              className="bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0 shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
              Add
            </Button>
          </div>
        </ImportCard>

        {/* Bulk URLs */}
        <ImportCard
          icon={<Users className="w-4 h-4" />}
          title="Bulk LinkedIn URLs"
          help="Paste a list, one URL per line. All land in Review awaiting approval."
        >
          <textarea
            placeholder={"https://linkedin.com/in/person1\nhttps://linkedin.com/in/person2\nhttps://linkedin.com/in/person3"}
            value={bulkUrls}
            onChange={(e) => setBulkUrls(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none focus:outline-none focus:border-[#00C4C8] mb-3"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground tabular-nums">
              {bulkUrls.split("\n").filter((u) => u.trim().includes("linkedin")).length} URLs detected
            </span>
            <Button
              onClick={enrichBulk}
              disabled={loading || !bulkUrls.trim()}
              variant="outline"
              className="border-[#00C4C8]/40 text-[#00F0F4] hover:bg-[#00C4C8]/20 hover:text-[#00F0F4]"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />}
              Add all
            </Button>
          </div>
        </ImportCard>

        {/* Google Sheet / Trade Show Import */}
        <ImportCard
          icon={<Sheet className="w-4 h-4" />}
          title="Google Sheet (companies)"
          help="Paste a tab-separated table from Sheets. Imports company-only rows; people get found later in Pipeline."
        >
          <textarea
            placeholder={"Company\tBrands\tEvent\tStand\tICP Score\tOwn Distribution\tYoung Leadership\tDescription\tICP Fit Reasons"}
            value={sheetCsv}
            onChange={(e) => setSheetCsv(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-xs font-mono resize-none focus:outline-none focus:border-[#00C4C8] mb-3"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground tabular-nums">
              {sheetCsv.trim() ? `${sheetCsv.trim().split("\n").length - 1} rows` : "Paste with header row"}
            </span>
            <Button
              onClick={importFromSheet}
              disabled={sheetImporting || !sheetCsv.trim()}
              variant="outline"
              className="border-[#00C4C8]/40 text-[#00F0F4] hover:bg-[#00C4C8]/20 hover:text-[#00F0F4]"
            >
              {sheetImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />}
              Import companies
            </Button>
          </div>
          {sheetResult && (
            <div className="mt-3 p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                {sheetResult.imported} companies imported
              </p>
              {sheetResult.skipped > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{sheetResult.skipped} skipped (no company name)</p>
              )}
              <Button
                size="sm"
                className="mt-2 bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0"
                onClick={() => router.push("/")}
              >
                <Search className="w-3.5 h-3.5 mr-1.5" /> Find people in Pipeline
              </Button>
            </div>
          )}
        </ImportCard>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="rounded-lg bg-card border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Enrichment results</h3>
            <div className="flex gap-2">
              {successResults.length > 0 && (
                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  {successResults.length} added
                </Badge>
              )}
              {errorResults.length > 0 && (
                <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                  {errorResults.length} failed
                </Badge>
              )}
            </div>
          </div>
          <div>
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
                    // Send the user to the Review tab where the URL-only lead awaits approval.
                    if (r.status === "success") {
                      router.push("/?tab=review");
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
                        {r.url.replace("https://linkedin.com/in/", "").replace("https://www.linkedin.com/in/", "").replace(/\/$/, "")}
                      </p>
                      {r.error && <p className="text-xs text-red-500">{r.error}</p>}
                    </div>
                  </div>
                  {r.status === "success" && (
                    <Badge variant="outline" className="text-xs">
                      In Review queue
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            {successResults.length > 0 && (
              <Button
                className="mt-4 bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] border-0"
                onClick={() => router.push("/?tab=review")}
              >
                Review &amp; approve →
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportCard({ icon, title, help, children }: {
  icon: React.ReactNode;
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card border border-border p-5 flex flex-col">
      <div className="flex items-start gap-2 mb-1.5">
        <span className="w-7 h-7 rounded-md bg-[#00C4C8]/10 text-[#00C4C8] inline-flex items-center justify-center shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-foreground leading-tight pt-1">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4">{help}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}
