/**
 * Runtime config loader. Reads from process.env first, then Supabase app_config.
 * Used by server-side routes (enrichment, generation) so users can rotate API
 * keys via the /settings page without redeploying.
 *
 * Uses the service-role client because after migration 007 app_config is RLS-locked
 * to service_role only. Importing this module from client code will throw at runtime
 * (the admin client refuses to initialize without SUPABASE_SERVICE_ROLE_KEY, which
 * is server-only).
 */

import { createAdminClient } from "@/lib/supabase-admin";

// Small TTL cache so we don't re-query Supabase on every enrichment call
const cache = new Map<string, { value: string | null; at: number }>();
const TTL_MS = 30_000;

export async function getConfig(key: string, envVar?: string): Promise<string | null> {
  // env wins
  if (envVar && process.env[envVar]) return process.env[envVar]!;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) return cached.value;

  const admin = createAdminClient();
  const { data } = await admin
    .from("app_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const value = data?.value ?? null;
  cache.set(key, { value, at: now });
  return value as string | null;
}

export function clearConfigCache() { cache.clear(); }
