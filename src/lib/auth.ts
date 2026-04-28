import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Auth guard for API routes. Returns the authenticated user + server Supabase
// client, or a 401 response if no valid session. Usage:
//
//   const auth = await requireUser();
//   if (!auth.ok) return auth.response;
//   const { user, supabase } = auth;
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const, user, supabase };
}
