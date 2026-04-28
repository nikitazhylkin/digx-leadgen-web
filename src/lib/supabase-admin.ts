import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Service-role client. Bypasses RLS. ONLY import from server code
// (route handlers, Server Components). Never from `"use client"` files.
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing. Set it in .env.local and Vercel env vars.",
    );
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
