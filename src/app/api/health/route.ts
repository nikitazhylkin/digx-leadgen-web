import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Account-health endpoint for the Chrome extension. Returns the recommended
// daily scrape cap + reason given current acceptance rate and day-of-week.
//
// The extension polls this on each scrape session. Output:
//   { cap: number, base: number, reason: string, acceptanceRate14d: number | null,
//     requestsSent14d: number, accepted14d: number, weekend: boolean }
//
// Auth: same shared-secret pattern as /api/ingest-leads — extension presents the
// public anon key as `apikey`. We don't expose any private data in the response,
// so even if a third party hits this it's just public stats — but we still gate
// it to keep the surface area honest.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

const BASE_CAP = 100;
const REDUCED_CAP = 50;        // when acceptance rate is poor → tighten the belt
const WEEKEND_CAP = 30;        // organic users don't grind on weekends
const ACCEPTANCE_FLOOR = 0.15; // below this we throttle

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const header = (req.headers.get("apikey")
    || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || "").trim();
  if (!anonKey || header !== anonKey) {
    return NextResponse.json({ error: "Invalid apikey" }, { status: 401, headers: CORS_HEADERS });
  }

  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  const { count: requestsSent } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("request_sent_at", since14);
  const { count: accepted } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("request_sent_at", since14)
    .not("connection_accepted_at", "is", null);

  const sentN = requestsSent ?? 0;
  const acceptedN = accepted ?? 0;
  const acceptanceRate = sentN > 0 ? acceptedN / sentN : null;

  const dow = new Date().getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dow === 0 || dow === 6;

  // Decide the cap. Order: weekend < acceptance throttle < base.
  let cap = BASE_CAP;
  let reason = "default cap";
  if (isWeekend) {
    cap = Math.min(cap, WEEKEND_CAP);
    reason = "weekend pacing";
  }
  // Only throttle on low acceptance once we have meaningful sample size (>=10 sent)
  if (sentN >= 10 && acceptanceRate !== null && acceptanceRate < ACCEPTANCE_FLOOR) {
    cap = Math.min(cap, REDUCED_CAP);
    reason = `low acceptance (${Math.round(acceptanceRate * 100)}% over 14d)`;
  }

  return NextResponse.json({
    cap,
    base: BASE_CAP,
    reason,
    acceptanceRate14d: acceptanceRate,
    requestsSent14d: sentN,
    accepted14d: acceptedN,
    weekend: isWeekend,
  }, { status: 200, headers: CORS_HEADERS });
}
