// Backwards-compat shim for client components that import { supabase } from here.
// Uses the SSR browser client so auth cookies are shared with middleware + API routes.
import { createClient } from "./supabase-browser";

export const supabase = createClient();
